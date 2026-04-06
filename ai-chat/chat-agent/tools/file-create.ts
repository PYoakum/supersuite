import { writeFile, stat, chmod } from "fs/promises";
import { existsSync } from "fs";
import { createHash } from "crypto";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse } from "./types";

// ── Helpers ──────────────────────────────────────────────────

function isHostAllowed(hostname: string, allowedHosts: string[]): boolean {
  if (allowedHosts.includes("*")) return true;
  return allowedHosts.some((allowed) => {
    if (allowed.startsWith("*.")) {
      const domain = allowed.slice(2);
      return hostname === domain || hostname.endsWith("." + domain);
    }
    return hostname === allowed;
  });
}

async function processStream(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  maxSize: number,
  allowedHosts: string[]
): Promise<Buffer> {
  let parsedUrl: URL;
  try { parsedUrl = new URL(url); } catch { throw new Error(`Invalid URL: ${url}`); }

  if (!isHostAllowed(parsedUrl.hostname, allowedHosts)) {
    throw Object.assign(new Error(`Host not allowed: ${parsedUrl.hostname}`), { code: "STREAM_HOST_NOT_ALLOWED" });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`HTTP error: ${response.status} ${response.statusText}`);

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxSize) {
      throw new Error(`Content too large: ${arrayBuffer.byteLength} bytes exceeds max ${maxSize} bytes`);
    }
    return Buffer.from(arrayBuffer);
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") throw Object.assign(new Error(`Stream timeout after ${timeoutMs}ms`), { code: "STREAM_TIMEOUT" });
    throw Object.assign(new Error(`Stream error: ${err.message}`), { code: "STREAM_ERROR" });
  }
}

// ── Execute ──────────────────────────────────────────────────

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const sessionId = args.sessionId as string | undefined;
  const path = args.path as string;
  const inputType = (args.inputType as string) ?? "string";
  const data = args.data as string | number[] | Record<string, unknown> | undefined;
  const options = (args.options as { overwrite?: boolean; createDirectories?: boolean; mode?: string; jsonIndent?: number }) ?? {};
  const streamOptions = args.streamOptions as { url: string; headers?: Record<string, string>; maxSize?: number; timeout?: number } | undefined;

  const allowedStreamHosts = (ctx.config.streamAllowedHosts as string[]) ?? ["*"];
  const defaultStreamTimeout = (ctx.config.streamTimeout as number) ?? 30_000;
  const maxStreamSize = (ctx.config.streamMaxSize as number) ?? 10 * 1024 * 1024;

  if (!path) throw new Error("path is required");
  if (data === undefined && inputType !== "stream") throw new Error("data is required");
  if (inputType === "stream" && !streamOptions?.url) throw new Error("streamOptions.url is required for stream input type");

  const absPath = await ctx.sandbox.resolvePath(sessionId, path);
  const fileExists = existsSync(absPath);
  if (fileExists && !options.overwrite) {
    throw Object.assign(new Error(`File already exists: ${path}`), { code: "FILE_EXISTS" });
  }

  let buffer: Buffer;
  switch (inputType) {
    case "string":
      if (typeof data !== "string") throw new Error('Data must be a string for inputType "string"');
      buffer = Buffer.from(data, "utf-8");
      break;
    case "buffer":
      if (!Array.isArray(data)) throw new Error('Data must be an array for inputType "buffer"');
      buffer = Buffer.from(data as number[]);
      break;
    case "base64":
      if (typeof data !== "string") throw new Error('Data must be a base64 string for inputType "base64"');
      buffer = Buffer.from(data, "base64");
      break;
    case "json":
      if (typeof data !== "object" || data === null) throw new Error('Data must be an object for inputType "json"');
      buffer = Buffer.from(JSON.stringify(data, null, options.jsonIndent ?? 2), "utf-8");
      break;
    case "stream":
      buffer = await processStream(
        streamOptions!.url,
        streamOptions!.headers ?? {},
        streamOptions!.timeout ?? defaultStreamTimeout,
        streamOptions!.maxSize ?? maxStreamSize,
        allowedStreamHosts
      );
      break;
    default:
      throw new Error(`Unknown input type: ${inputType}`);
  }

  ctx.sandbox.validateFileSize(buffer.length, sessionId);

  if (options.createDirectories !== false) {
    await ctx.sandbox.ensureParentDir(absPath);
  }

  await writeFile(absPath, buffer);

  if (options.mode) {
    await chmod(absPath, parseInt(options.mode, 8));
  }

  const existingSize = fileExists ? (await stat(absPath).catch(() => ({ size: 0 }))).size : 0;
  ctx.sandbox.updateSandboxSize(sessionId, buffer.length - existingSize);

  const checksum = createHash("sha256").update(buffer).digest("hex");
  const stats = await stat(absPath);

  return formatResponse({
    success: true,
    path,
    size: stats.size,
    checksum: `sha256:${checksum}`,
    created: stats.birthtime.toISOString(),
    inputType,
  });
}

// ── Tool Definition ─────────────────────────────────────────

const fileCreateTool: Tool = {
  name: "file_create",
  description:
    "Create files from various input types (string, buffer, base64, json, stream/URL) in the sandbox.",
  needsSandbox: true,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "Session ID for sandbox isolation" },
      path: { type: "string", description: "Relative path for the new file within the sandbox" },
      inputType: {
        type: "string",
        enum: ["string", "buffer", "base64", "json", "stream"],
        default: "string",
        description: "Type of input data",
      },
      data: { description: "The content to write (type depends on inputType)" },
      options: {
        type: "object",
        properties: {
          overwrite: { type: "boolean", default: false },
          createDirectories: { type: "boolean", default: true },
          mode: { type: "string", default: "0644" },
          jsonIndent: { type: "integer", default: 2 },
        },
      },
      streamOptions: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to fetch content from" },
          headers: { type: "object", additionalProperties: { type: "string" } },
          maxSize: { type: "integer" },
          timeout: { type: "integer", default: 30000 },
        },
      },
    },
    required: ["path"],
  },
  execute,
};

export default fileCreateTool;
