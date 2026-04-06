import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Helpers ──────────────────────────────────────────────────

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

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const url = args.url as string | undefined;
  const method = ((args.method as string) ?? "GET").toUpperCase();
  const headers = (args.headers as Record<string, string>) ?? {};
  const body = args.body as string | Record<string, unknown> | undefined;
  const responseType = (args.responseType as string) ?? "json";
  const followRedirects = (args.followRedirects as boolean) ?? true;

  const allowedHosts = (ctx.config.httpAllowedHosts as string[]) ?? [];
  const defaultTimeout = (ctx.config.httpTimeout as number) ?? 30_000;
  const maxResponseSize = (ctx.config.httpMaxResponseSize as number) ?? 10 * 1024 * 1024;
  const timeoutMs = (args.timeout as number) ?? defaultTimeout;

  if (!url) return formatError("url is required");

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return formatError(`Invalid URL: ${url}`);
  }

  if (!isHostAllowed(parsedUrl.hostname, allowedHosts)) {
    return formatError(
      `Host not allowed: ${parsedUrl.hostname}. Configure allowedHosts to enable access.`
    );
  }

  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchOptions: RequestInit = {
      method,
      headers: { ...headers },
      signal: controller.signal,
      redirect: followRedirects ? "follow" : "manual",
    };

    if (body && !["GET", "HEAD"].includes(method)) {
      if (typeof body === "object") {
        fetchOptions.body = JSON.stringify(body);
        const h = fetchOptions.headers as Record<string, string>;
        if (!h["Content-Type"] && !h["content-type"]) {
          h["Content-Type"] = "application/json";
        }
      } else {
        fetchOptions.body = body;
      }
    }

    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > maxResponseSize) {
      return formatError(
        `Response too large: ${contentLength} bytes exceeds max ${maxResponseSize} bytes`
      );
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    let responseBody: unknown;
    switch (responseType) {
      case "json": {
        const text = await response.text();
        if (text.length > maxResponseSize) return formatError(`Response too large: ${text.length} bytes`);
        try { responseBody = JSON.parse(text); } catch { responseBody = text; }
        break;
      }
      case "text": {
        const text = await response.text();
        if (text.length > maxResponseSize) return formatError(`Response too large: ${text.length} bytes`);
        responseBody = text;
        break;
      }
      case "base64": {
        const buf = await response.arrayBuffer();
        if (buf.byteLength > maxResponseSize) return formatError(`Response too large: ${buf.byteLength} bytes`);
        responseBody = Buffer.from(buf).toString("base64");
        break;
      }
      default:
        return formatError(`Invalid responseType: ${responseType}`);
    }

    return formatResponse({
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
      timing: { durationMs: Date.now() - startTime },
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") return formatError(`Request timeout after ${timeoutMs}ms`);
    return formatError(`Request failed: ${err.message}`);
  }
}

// ── Tool Definition ─────────────────────────────────────────

const httpRequestTool: Tool = {
  name: "http_request",
  description:
    "Make HTTP API requests to allowed hosts. Supports GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS methods with JSON, text, or base64 response parsing.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to request" },
      method: {
        type: "string",
        enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
        default: "GET",
        description: "HTTP method",
      },
      headers: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Request headers",
      },
      body: {
        description:
          "Request body (string or JSON object). Objects are auto-serialized with Content-Type: application/json",
      },
      timeout: {
        type: "integer",
        minimum: 1000,
        maximum: 300000,
        default: 30000,
        description: "Request timeout in milliseconds",
      },
      responseType: {
        type: "string",
        enum: ["json", "text", "base64"],
        default: "json",
        description: "How to parse the response body",
      },
      followRedirects: { type: "boolean", default: true, description: "Follow HTTP redirects" },
    },
    required: ["url"],
  },
  execute,
};

export default httpRequestTool;
