import { readFile as fsReadFile, stat } from "fs/promises";
import { existsSync } from "fs";
import { resolve, basename, extname } from "path";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Constants ────────────────────────────────────────────────

const DEFAULT_MAX_FILE_SIZE = 1024 * 1024; // 1MB
const DEFAULT_MAX_LINE_COUNT = 50_000;

// ── Execute ──────────────────────────────────────────────────

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const filePath = args.path as string | undefined;
  const encoding = (args.encoding as BufferEncoding) ?? "utf-8";
  const lineRange = args.lineRange as { start?: number; end?: number } | undefined;
  const sessionId = args.sessionId as string | undefined;

  const maxFileSize = (ctx.config.readFileMaxSize as number) ?? DEFAULT_MAX_FILE_SIZE;

  if (!filePath) return formatError("path is required");
  if (!sessionId) return formatError("sessionId is required for sandbox isolation");

  // All paths must resolve within the sandbox
  let resolvedPath: string;
  try {
    resolvedPath = await ctx.sandbox.resolvePath(sessionId, filePath);
  } catch (err: any) {
    return formatError(`Path not allowed: ${err.message}`);
  }

  if (!existsSync(resolvedPath)) return formatError(`File not found: ${filePath}`);

  try {
    const stats = await stat(resolvedPath);

    if (stats.isDirectory()) return formatError(`Cannot read directory: ${filePath}. Use code_editor explore instead.`);

    if (stats.size > maxFileSize) {
      return formatError(`File too large: ${stats.size} bytes (max: ${maxFileSize} bytes)`);
    }

    let content: string;
    if (encoding === "base64") {
      const buffer = await fsReadFile(resolvedPath);
      content = buffer.toString("base64");
    } else {
      content = await fsReadFile(resolvedPath, encoding);
    }

    // Apply line range if specified
    if (lineRange && encoding !== "base64") {
      const lines = content.split("\n");
      const start = Math.max(0, (lineRange.start ?? 1) - 1);
      const end = Math.min(lines.length, lineRange.end ?? lines.length);
      content = lines.slice(start, end).join("\n");
    }

    // Truncate extremely long files
    const lineCount = content.split("\n").length;
    if (lineCount > DEFAULT_MAX_LINE_COUNT && encoding !== "base64") {
      const lines = content.split("\n");
      content = lines.slice(0, DEFAULT_MAX_LINE_COUNT).join("\n") + `\n[...truncated ${lineCount - DEFAULT_MAX_LINE_COUNT} lines]`;
    }

    const fileName = basename(resolvedPath);
    const extension = extname(resolvedPath).slice(1) || "txt";

    return formatResponse({
      success: true,
      file: {
        name: fileName,
        path: filePath,
        extension,
        size: stats.size,
        modified: stats.mtime.toISOString(),
        encoding,
      },
      content,
      lineCount: content.split("\n").length,
    });
  } catch (err: any) {
    return formatError(`Failed to read file: ${err.message}`);
  }
}

// ── Tool Definition ─────────────────────────────────────────

const readFileTool: Tool = {
  name: "read_file",
  description:
    "Read files from the sandbox filesystem. Supports text and base64 encoding, line ranges, and size limits. Paths are resolved within the sandbox only.",
  needsSandbox: true,
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to read (relative to sandbox root)",
      },
      encoding: {
        type: "string",
        enum: ["utf-8", "ascii", "latin1", "base64"],
        default: "utf-8",
        description: "File encoding (use base64 for binary files)",
      },
      lineRange: {
        type: "object",
        description: "Read only specific lines (1-indexed)",
        properties: {
          start: { type: "integer", description: "Start line (inclusive, 1-indexed)" },
          end: { type: "integer", description: "End line (inclusive)" },
        },
      },
      sessionId: {
        type: "string",
        description: "Session ID for sandbox isolation",
      },
    },
    required: ["path"],
  },
  execute,
};

export default readFileTool;
