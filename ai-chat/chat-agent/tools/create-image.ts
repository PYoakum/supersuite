import { writeFile, stat } from "fs/promises";
import { existsSync } from "fs";
import { createHash } from "crypto";
import { extname } from "path";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Constants ───────────────────────────────────────────────

const SUPPORTED_FORMATS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "tiff",
];

const DEFAULT_MAX_IMAGE_SIZE = 50 * 1024 * 1024; // 50MB

// ── Helpers ──────────────────────────────────────────────────

function processBase64(data: unknown): Buffer {
  if (typeof data !== "string") {
    throw new Error('Data must be a base64 string for inputType "base64"');
  }
  // Remove any whitespace
  const cleaned = data.replace(/\s/g, "");
  // Validate base64 format
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(cleaned)) {
    throw new Error("Invalid base64 encoding");
  }
  return Buffer.from(cleaned, "base64");
}

function processSvg(data: unknown): Buffer {
  if (typeof data !== "string") {
    throw new Error('Data must be an SVG string for inputType "svg"');
  }
  // Basic SVG validation - check for svg tag
  if (!data.includes("<svg") || !data.includes("</svg>")) {
    throw new Error("Invalid SVG: must contain <svg> element");
  }
  return Buffer.from(data, "utf-8");
}

function processRawBytes(data: unknown): Buffer {
  if (!Array.isArray(data)) {
    throw new Error('Data must be an array of bytes for inputType "raw_bytes"');
  }
  // Validate each byte is 0-255
  for (let i = 0; i < data.length; i++) {
    if (
      typeof data[i] !== "number" ||
      data[i] < 0 ||
      data[i] > 255 ||
      !Number.isInteger(data[i])
    ) {
      throw new Error(
        `Invalid byte value at index ${i}: ${data[i]}. Must be integer 0-255.`
      );
    }
  }
  return Buffer.from(data);
}

function processDataUrl(data: unknown): Buffer {
  if (typeof data !== "string") {
    throw new Error('Data must be a data URL string for inputType "data_url"');
  }
  // Parse data URL
  const match = data.match(/^data:([^;,]+)?(?:;([^,]+))?,(.*)$/);
  if (!match) {
    throw new Error(
      "Invalid data URL format. Expected: data:[<mediatype>][;base64],<data>"
    );
  }

  const [, _mimeType, encoding, payload] = match;

  if (encoding === "base64") {
    return Buffer.from(payload, "base64");
  } else {
    // URL-encoded or plain text
    return Buffer.from(decodeURIComponent(payload), "utf-8");
  }
}

function calculateChecksum(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// ── Execute ──────────────────────────────────────────────────

async function execute(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const sessionId = args.sessionId as string | undefined;
  const path = args.path as string;
  const inputType = (args.inputType as string) ?? "base64";
  const data = args.data as string | number[] | undefined;
  const options = (args.options as { overwrite?: boolean; createDirectories?: boolean }) ?? {};

  const maxImageSize =
    (ctx.config.maxImageSize as number) ?? DEFAULT_MAX_IMAGE_SIZE;

  if (!path) {
    return formatError("path is required");
  }
  if (data === undefined || data === null) {
    return formatError("data is required");
  }

  // Validate format from path extension
  const ext = extname(path).slice(1).toLowerCase();
  if (ext && !SUPPORTED_FORMATS.includes(ext)) {
    return formatError(
      `Unsupported image format: ${ext}. Supported formats: ${SUPPORTED_FORMATS.join(", ")}`
    );
  }

  // Resolve path within sandbox
  const absPath = await ctx.sandbox.resolvePath(sessionId, path);

  // Check if file exists
  const fileExists = existsSync(absPath);
  if (fileExists && !options.overwrite) {
    return formatError(
      `File already exists: ${path}. Set options.overwrite=true to replace.`
    );
  }

  // Process input based on type
  let buffer: Buffer;
  try {
    switch (inputType) {
      case "base64":
        buffer = processBase64(data);
        break;
      case "svg":
        buffer = processSvg(data);
        break;
      case "raw_bytes":
        buffer = processRawBytes(data);
        break;
      case "data_url":
        buffer = processDataUrl(data);
        break;
      default:
        return formatError(
          `Unknown input type: ${inputType}. Valid types: base64, svg, raw_bytes, data_url`
        );
    }
  } catch (err: any) {
    return formatError(`Failed to process image data: ${err.message}`);
  }

  // Validate size
  if (buffer.length > maxImageSize) {
    return formatError(
      `Image size ${buffer.length} bytes exceeds maximum ${maxImageSize} bytes`
    );
  }

  try {
    ctx.sandbox.validateFileSize(buffer.length, sessionId);
  } catch (err: any) {
    return formatError(`Sandbox size limit exceeded: ${err.message}`);
  }

  // Ensure parent directory exists
  if (options.createDirectories !== false) {
    await ctx.sandbox.ensureParentDir(absPath);
  }

  // Write the image file
  await writeFile(absPath, buffer);

  // Update size tracking
  const existingSize = fileExists
    ? (await stat(absPath).catch(() => ({ size: 0 }))).size
    : 0;
  ctx.sandbox.updateSandboxSize(sessionId, buffer.length - existingSize);

  // Calculate checksum
  const checksum = calculateChecksum(buffer);

  const stats = await stat(absPath);

  return formatResponse({
    success: true,
    path,
    size: stats.size,
    checksum: `sha256:${checksum}`,
    format: ext || "unknown",
    inputType,
    created: stats.birthtime.toISOString(),
  });
}

// ── Tool Definition ─────────────────────────────────────────

const createImageTool: Tool = {
  name: "create_image",
  description:
    "Create an image file in the sandbox from various input types (base64, SVG markup, raw bytes, or data URL). Supports PNG, JPG, GIF, WebP, SVG, BMP, ICO, and TIFF formats.",
  needsSandbox: true,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description:
          'Session ID for sandbox isolation (optional, uses "default" if not provided)',
      },
      path: {
        type: "string",
        description:
          'Output path for the image file within the sandbox (e.g., "images/logo.png")',
      },
      inputType: {
        type: "string",
        enum: ["base64", "svg", "raw_bytes", "data_url"],
        default: "base64",
        description:
          "Type of input data: base64 (encoded image), svg (SVG markup), raw_bytes (byte array), data_url (data: URL)",
      },
      data: {
        oneOf: [
          { type: "string" },
          {
            type: "array",
            items: { type: "integer", minimum: 0, maximum: 255 },
          },
        ],
        description:
          "The image data: base64 string, SVG markup, data URL, or array of bytes (0-255)",
      },
      options: {
        type: "object",
        description: "Image creation options",
        properties: {
          overwrite: {
            type: "boolean",
            default: false,
            description: "Overwrite if file already exists",
          },
          createDirectories: {
            type: "boolean",
            default: true,
            description: "Create parent directories if needed",
          },
        },
      },
    },
    required: ["path", "data"],
  },
  execute,
};

export default createImageTool;
