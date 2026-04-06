import { Socket } from "net";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// -- Helpers ------------------------------------------------------------------

function isHostAllowed(hostname: string, allowedHosts: string[]): boolean {
  if (allowedHosts.length === 0) return false;
  if (allowedHosts.includes("*")) return true;
  return allowedHosts.some((allowed) => {
    if (allowed.startsWith("*.")) {
      const domain = allowed.slice(2);
      return hostname === domain || hostname.endsWith("." + domain);
    }
    return hostname === allowed;
  });
}

function isPortAllowed(port: number, allowedPorts: number[]): boolean {
  if (allowedPorts.length === 0) return false;
  if (allowedPorts.includes(0)) return true; // 0 means all ports
  return allowedPorts.includes(port);
}

function assembleResponse(chunks: Buffer[], encoding: string): string {
  const buffer = Buffer.concat(chunks);
  if (encoding === "hex") return buffer.toString("hex");
  if (encoding === "base64") return buffer.toString("base64");
  return buffer.toString("utf8");
}

function getByteLength(data: string, encoding: string): number {
  const enc = encoding === "hex" ? "hex" : encoding === "base64" ? "base64" : "utf8";
  return Buffer.byteLength(data, enc as BufferEncoding);
}

// -- Actions ------------------------------------------------------------------

function probe(host: string, port: number, timeout: number): Promise<ToolResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new Socket();

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(
        formatResponse({
          open: false,
          host,
          port,
          timing: { probeMs: Date.now() - startTime },
          reason: "timeout",
        })
      );
    }, timeout);

    socket.once("connect", () => {
      clearTimeout(timeoutId);
      const probeMs = Date.now() - startTime;
      cleanup();
      resolve(formatResponse({ open: true, host, port, timing: { probeMs } }));
    });

    socket.once("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timeoutId);
      const probeMs = Date.now() - startTime;
      cleanup();
      resolve(
        formatResponse({
          open: false,
          host,
          port,
          timing: { probeMs },
          reason: err.code || err.message,
        })
      );
    });

    socket.connect(port, host);
  });
}

function connect(host: string, port: number, timeout: number): Promise<ToolResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new Socket();

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(formatError(`Connection timeout after ${timeout}ms`));
    }, timeout);

    socket.once("connect", () => {
      clearTimeout(timeoutId);
      const connectMs = Date.now() - startTime;
      const localAddress = socket.localAddress;
      const localPort = socket.localPort;
      const remoteAddress = socket.remoteAddress;
      cleanup();
      resolve(
        formatResponse({
          connected: true,
          host,
          port,
          localAddress,
          localPort,
          remoteAddress,
          timing: { connectMs },
        })
      );
    });

    socket.once("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timeoutId);
      cleanup();
      resolve(formatError(`Connection failed: ${err.code || err.message}`));
    });

    socket.connect(port, host);
  });
}

function send(
  host: string,
  port: number,
  data: string,
  encoding: string,
  connectTimeout: number,
  readTimeout: number,
  maxSize: number
): Promise<ToolResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new Socket();
    const chunks: Buffer[] = [];
    let totalSize = 0;
    let connected = false;
    let dataSent = false;

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    // Connection timeout
    const connectTimeoutId = setTimeout(() => {
      if (!connected) {
        cleanup();
        resolve(formatError(`Connection timeout after ${connectTimeout}ms`));
      }
    }, connectTimeout);

    // Read timeout (starts after data is sent)
    let readTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const startReadTimeout = () => {
      readTimeoutId = setTimeout(() => {
        const response = assembleResponse(chunks, encoding);
        cleanup();
        resolve(
          formatResponse({
            sent: getByteLength(data, encoding),
            received: totalSize,
            response,
            encoding,
            timing: {
              connectMs: connected ? Date.now() - startTime : null,
              totalMs: Date.now() - startTime,
            },
            note: "Read timeout reached",
          })
        );
      }, readTimeout);
    };

    socket.once("connect", () => {
      clearTimeout(connectTimeoutId);
      connected = true;

      // Encode and send data
      let sendBuffer: Buffer;
      try {
        if (encoding === "hex") {
          sendBuffer = Buffer.from(data, "hex");
        } else if (encoding === "base64") {
          sendBuffer = Buffer.from(data, "base64");
        } else {
          sendBuffer = Buffer.from(data, "utf8");
        }
      } catch (err: any) {
        cleanup();
        resolve(formatError(`Invalid data encoding: ${err.message}`));
        return;
      }

      socket.write(sendBuffer, () => {
        dataSent = true;
        startReadTimeout();
      });
    });

    socket.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > maxSize) {
        if (readTimeoutId) clearTimeout(readTimeoutId);
        const response = assembleResponse(chunks, encoding);
        cleanup();
        resolve(
          formatResponse({
            sent: getByteLength(data, encoding),
            received: totalSize,
            response,
            encoding,
            truncated: true,
            timing: { totalMs: Date.now() - startTime },
          })
        );
        return;
      }
      chunks.push(chunk);
    });

    socket.once("end", () => {
      if (readTimeoutId) clearTimeout(readTimeoutId);
      const response = assembleResponse(chunks, encoding);
      cleanup();
      resolve(
        formatResponse({
          sent: getByteLength(data, encoding),
          received: totalSize,
          response,
          encoding,
          timing: { totalMs: Date.now() - startTime },
        })
      );
    });

    socket.once("close", () => {
      if (readTimeoutId) clearTimeout(readTimeoutId);
      if (dataSent && chunks.length > 0) {
        const response = assembleResponse(chunks, encoding);
        cleanup();
        resolve(
          formatResponse({
            sent: getByteLength(data, encoding),
            received: totalSize,
            response,
            encoding,
            timing: { totalMs: Date.now() - startTime },
          })
        );
      }
    });

    socket.once("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(connectTimeoutId);
      if (readTimeoutId) clearTimeout(readTimeoutId);
      cleanup();
      if (connected && chunks.length > 0) {
        // Return partial data if we got some
        const response = assembleResponse(chunks, encoding);
        resolve(
          formatResponse({
            sent: getByteLength(data, encoding),
            received: totalSize,
            response,
            encoding,
            error: err.code || err.message,
            timing: { totalMs: Date.now() - startTime },
          })
        );
      } else {
        resolve(formatError(`Connection error: ${err.code || err.message}`));
      }
    });

    socket.connect(port, host);
  });
}

// -- Execute ------------------------------------------------------------------

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const host = args.host as string | undefined;
  const port = args.port as number | undefined;
  const action = (args.action as string) ?? "connect";
  const data = args.data as string | undefined;
  const encoding = (args.encoding as string) ?? "utf8";
  const timeout = args.timeout as number | undefined;
  const readTimeoutArg = args.readTimeout as number | undefined;
  const maxResponseSize = args.maxResponseSize as number | undefined;

  const allowedHosts = (ctx.config.tcpAllowedHosts as string[]) ?? [];
  const allowedPorts = (ctx.config.tcpAllowedPorts as number[]) ?? [];
  const defaultTimeout = (ctx.config.tcpDefaultTimeout as number) ?? 10_000;
  const defaultReadTimeout = (ctx.config.tcpDefaultReadTimeout as number) ?? 5_000;
  const defaultMaxResponseSize = (ctx.config.tcpMaxResponseSize as number) ?? 65_536;

  if (!host) return formatError("host is required");
  if (!port) return formatError("port is required");
  if (port < 1 || port > 65535) return formatError("port must be between 1 and 65535");

  if (!isHostAllowed(host, allowedHosts)) {
    return formatError(`Host not allowed: ${host}. Configure allowedHosts to enable access.`);
  }
  if (!isPortAllowed(port, allowedPorts)) {
    return formatError(`Port not allowed: ${port}. Configure allowedPorts to enable access.`);
  }

  const connectTimeout = timeout ?? defaultTimeout;
  const dataReadTimeout = readTimeoutArg ?? defaultReadTimeout;
  const maxSize = maxResponseSize ?? defaultMaxResponseSize;

  switch (action) {
    case "probe":
      return probe(host, port, connectTimeout);
    case "connect":
      return connect(host, port, connectTimeout);
    case "send":
      if (!data) return formatError("data is required for send action");
      return send(host, port, data, encoding, connectTimeout, dataReadTimeout, maxSize);
    default:
      return formatError(`Invalid action: ${action}. Use 'probe', 'connect', or 'send'.`);
  }
}

// -- Tool Definition ----------------------------------------------------------

const tcpConnectTool: Tool = {
  name: "tcp_connect",
  description:
    "Establish TCP connections to allowed hosts/ports. Supports probing (port check), connecting (test connection), and sending data.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      host: {
        type: "string",
        description: "Target hostname or IP address",
      },
      port: {
        type: "integer",
        minimum: 1,
        maximum: 65535,
        description: "Target port number",
      },
      action: {
        type: "string",
        enum: ["probe", "connect", "send"],
        default: "connect",
        description:
          "Action to perform: probe (quick port check), connect (test connection), send (send data and receive response)",
      },
      data: {
        type: "string",
        description: "Data to send (required for send action)",
      },
      encoding: {
        type: "string",
        enum: ["utf8", "hex", "base64"],
        default: "utf8",
        description: "Encoding for data and response",
      },
      timeout: {
        type: "integer",
        minimum: 100,
        maximum: 60000,
        default: 10000,
        description: "Connection timeout in milliseconds",
      },
      readTimeout: {
        type: "integer",
        minimum: 100,
        maximum: 60000,
        default: 5000,
        description: "Read timeout in milliseconds (for send action)",
      },
      maxResponseSize: {
        type: "integer",
        minimum: 1,
        maximum: 1048576,
        default: 65536,
        description: "Maximum response size in bytes",
      },
    },
    required: ["host", "port"],
  },
  execute,
};

export default tcpConnectTool;
