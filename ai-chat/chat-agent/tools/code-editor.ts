import { readFile, writeFile, unlink, readdir, stat } from "fs/promises";
import { existsSync } from "fs";
import { join, relative } from "path";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse } from "./types";

// ── Types ────────────────────────────────────────────────────

type Operation = "create" | "read" | "write" | "patch" | "delete" | "list" | "stat" | "explore";

interface PatchSpec {
  type: "line_range" | "search_replace";
  startLine?: number;
  endLine?: number;
  replacement?: string;
  search?: string;
  replaceAll?: boolean;
}

// ── Operations ───────────────────────────────────────────────

async function create(sandbox: ToolContext["sandbox"], sessionId: string | undefined, path: string, content: string, encoding: string): Promise<ToolResult> {
  const absPath = await sandbox.resolvePath(sessionId, path);
  if (existsSync(absPath)) throw Object.assign(new Error(`File already exists: ${path}`), { code: "FILE_EXISTS" });

  const buf = encoding === "base64" ? Buffer.from(content, "base64") : Buffer.from(content, "utf-8");
  sandbox.validateFileSize(buf.length, sessionId);
  await sandbox.ensureParentDir(absPath);
  await writeFile(absPath, buf);
  sandbox.updateSandboxSize(sessionId, buf.length);
  const stats = await stat(absPath);

  return formatResponse({ success: true, operation: "create", path, size: stats.size, created: stats.birthtime.toISOString() });
}

async function read(sandbox: ToolContext["sandbox"], sessionId: string | undefined, path: string, encoding: string): Promise<ToolResult> {
  const absPath = await sandbox.resolvePath(sessionId, path);
  if (!existsSync(absPath)) throw Object.assign(new Error(`File not found: ${path}`), { code: "FILE_NOT_FOUND" });

  const stats = await stat(absPath);
  if (stats.isDirectory()) throw new Error(`Cannot read directory: ${path}`);
  const buffer = await readFile(absPath);
  const content = encoding === "base64" ? buffer.toString("base64") : buffer.toString("utf-8");

  return formatResponse({ success: true, operation: "read", path, content, encoding, size: stats.size });
}

async function write(sandbox: ToolContext["sandbox"], sessionId: string | undefined, path: string, content: string, encoding: string): Promise<ToolResult> {
  const absPath = await sandbox.resolvePath(sessionId, path);
  let existingSize = 0;
  const fileExists = existsSync(absPath);
  if (fileExists) existingSize = (await stat(absPath)).size;

  const buf = encoding === "base64" ? Buffer.from(content, "base64") : Buffer.from(content, "utf-8");
  const sizeDelta = buf.length - existingSize;
  if (sizeDelta > 0) sandbox.validateFileSize(buf.length, sessionId);

  await sandbox.ensureParentDir(absPath);
  await writeFile(absPath, buf);
  sandbox.updateSandboxSize(sessionId, sizeDelta);
  const stats = await stat(absPath);

  return formatResponse({ success: true, operation: "write", path, size: stats.size, [fileExists ? "modified" : "created"]: stats.mtime.toISOString() });
}

async function patchOp(sandbox: ToolContext["sandbox"], sessionId: string | undefined, path: string, patch: PatchSpec): Promise<ToolResult> {
  const absPath = await sandbox.resolvePath(sessionId, path);
  if (!existsSync(absPath)) throw Object.assign(new Error(`File not found: ${path}`), { code: "FILE_NOT_FOUND" });

  const currentContent = await readFile(absPath, "utf-8");
  let newContent: string;
  let linesChanged: number;

  if (patch.type === "line_range") {
    const { startLine, endLine, replacement } = patch;
    if (!startLine || startLine < 1) throw new Error("patch.startLine must be a positive integer");
    if (!endLine || endLine < startLine) throw new Error("patch.endLine must be >= startLine");
    if (replacement === undefined) throw new Error("patch.replacement is required");

    const lines = currentContent.split("\n");
    if (startLine > lines.length) throw new Error(`startLine ${startLine} exceeds file length ${lines.length}`);
    const actualEndLine = Math.min(endLine, lines.length);
    const removedCount = actualEndLine - startLine + 1;
    lines.splice(startLine - 1, removedCount, ...replacement.split("\n"));
    newContent = lines.join("\n");
    linesChanged = removedCount;
  } else {
    const { search, replacement, replaceAll = false } = patch;
    if (!search) throw new Error("patch.search is required");
    if (replacement === undefined) throw new Error("patch.replacement is required");

    if (replaceAll) {
      const matches = currentContent.match(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"));
      newContent = currentContent.split(search).join(replacement);
      linesChanged = matches?.length ?? 0;
    } else {
      const index = currentContent.indexOf(search);
      if (index === -1) { newContent = currentContent; linesChanged = 0; }
      else { newContent = currentContent.slice(0, index) + replacement + currentContent.slice(index + search.length); linesChanged = 1; }
    }
  }

  const sizeDelta = Buffer.byteLength(newContent, "utf-8") - Buffer.byteLength(currentContent, "utf-8");
  if (sizeDelta > 0) sandbox.validateFileSize(Buffer.byteLength(newContent, "utf-8"), sessionId);
  await writeFile(absPath, newContent, "utf-8");
  sandbox.updateSandboxSize(sessionId, sizeDelta);
  const stats = await stat(absPath);

  return formatResponse({ success: true, operation: "patch", path, patchType: patch.type, linesChanged, size: stats.size });
}

async function deleteOp(sandbox: ToolContext["sandbox"], sessionId: string | undefined, path: string): Promise<ToolResult> {
  const absPath = await sandbox.resolvePath(sessionId, path);
  if (!existsSync(absPath)) throw Object.assign(new Error(`File not found: ${path}`), { code: "FILE_NOT_FOUND" });

  const stats = await stat(absPath);
  if (stats.isDirectory()) throw new Error(`Cannot delete directory: ${path}`);
  await unlink(absPath);
  sandbox.updateSandboxSize(sessionId, -stats.size);
  return formatResponse({ success: true, operation: "delete", path, deleted: true });
}

async function list(sandbox: ToolContext["sandbox"], sessionId: string | undefined, pattern: string): Promise<ToolResult> {
  const sandboxPath = await sandbox.ensureSandbox(sessionId);
  const files: { path: string; size: number; modified: string }[] = [];

  const walkDir = async (dirPath: string, relativeBase = "") => {
    if (!existsSync(dirPath)) return;
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryRelPath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;
      const entryAbsPath = join(dirPath, entry.name);
      if (entry.isDirectory()) await walkDir(entryAbsPath, entryRelPath);
      else if (entry.isFile() && matchesPattern(entryRelPath, pattern)) {
        const s = await stat(entryAbsPath);
        files.push({ path: entryRelPath, size: s.size, modified: s.mtime.toISOString() });
      }
    }
  };

  await walkDir(sandboxPath);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return formatResponse({ success: true, operation: "list", pattern, files, count: files.length });
}

async function statOp(sandbox: ToolContext["sandbox"], sessionId: string | undefined, path: string): Promise<ToolResult> {
  const absPath = await sandbox.resolvePath(sessionId, path);
  if (!existsSync(absPath)) throw Object.assign(new Error(`Path not found: ${path}`), { code: "FILE_NOT_FOUND" });

  const s = await stat(absPath);
  return formatResponse({
    success: true, operation: "stat", path, size: s.size,
    created: s.birthtime.toISOString(), modified: s.mtime.toISOString(),
    isFile: s.isFile(), isDirectory: s.isDirectory(), mode: s.mode.toString(8),
  });
}

async function explore(sandbox: ToolContext["sandbox"], sessionId: string | undefined, path: string, maxDepth: number): Promise<ToolResult> {
  const sandboxPath = await sandbox.ensureSandbox(sessionId);
  const absPath = await sandbox.resolvePath(sessionId, path);

  let targetDir: string;
  if (existsSync(absPath)) {
    const s = await stat(absPath);
    targetDir = s.isDirectory() ? absPath : join(absPath, "..");
  } else {
    targetDir = join(absPath, "..");
    while (!existsSync(targetDir) && targetDir !== sandboxPath) targetDir = join(targetDir, "..");
    if (!existsSync(targetDir)) targetDir = sandboxPath;
  }

  const files: string[] = [];
  const walkFlat = async (dirPath: string, rel: string, depth: number) => {
    if (depth >= maxDepth || !existsSync(dirPath)) return;
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walkFlat(join(dirPath, entry.name), entryRel, depth + 1);
      else if (entry.isFile()) files.push(entryRel);
    }
  };

  await walkFlat(targetDir, relative(sandboxPath, targetDir) || ".", 0);

  return formatResponse({
    success: true, operation: "explore", targetPath: path,
    targetExists: existsSync(absPath), exploredDirectory: relative(sandboxPath, targetDir) || ".",
    files, fileCount: files.length,
  });
}

function matchesPattern(path: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\x00GLOBSTAR\x00")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".")
    .replace(/\x00GLOBSTAR\x00/g, ".*");
  return new RegExp(`^${regexStr}$`).test(path);
}

// ── Execute Dispatcher ───────────────────────────────────────

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const operation = args.operation as Operation;
  const sessionId = args.sessionId as string | undefined;
  const path = args.path as string;
  const content = args.content as string;
  const encoding = (args.encoding as string) ?? "utf-8";
  const patch = args.patch as PatchSpec | undefined;
  const pattern = (args.pattern as string) ?? "**";
  const maxDepth = (args.maxDepth as number) ?? 3;

  if (!operation) throw new Error("operation is required");

  switch (operation) {
    case "create":  return create(ctx.sandbox, sessionId, path, content ?? "", encoding);
    case "read":    return read(ctx.sandbox, sessionId, path, encoding);
    case "write":   return write(ctx.sandbox, sessionId, path, content, encoding);
    case "patch":   return patchOp(ctx.sandbox, sessionId, path, patch!);
    case "delete":  return deleteOp(ctx.sandbox, sessionId, path);
    case "list":    return list(ctx.sandbox, sessionId, pattern);
    case "stat":    return statOp(ctx.sandbox, sessionId, path);
    case "explore": return explore(ctx.sandbox, sessionId, path, maxDepth);
    default:        throw new Error(`Unknown operation: ${operation}`);
  }
}

// ── Tool Definition ─────────────────────────────────────────

const codeEditorTool: Tool = {
  name: "code_editor",
  description:
    'Edit code files in a sandboxed workspace. Supports create, read, write, patch, delete, list, stat, and explore operations. Use "explore" before create/write to understand directory structure.',
  needsSandbox: true,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "Session ID for sandbox isolation" },
      operation: {
        type: "string",
        enum: ["create", "read", "write", "patch", "delete", "list", "stat", "explore"],
        description: "The operation to perform",
      },
      path: { type: "string", description: "Relative path within the sandbox" },
      content: { type: "string", description: "File content (for create/write)" },
      encoding: { type: "string", enum: ["utf-8", "base64"], default: "utf-8" },
      patch: {
        type: "object",
        description: "Patch specification (for patch operation)",
        properties: {
          type: { type: "string", enum: ["line_range", "search_replace"] },
          startLine: { type: "integer", description: "Starting line (1-indexed)" },
          endLine: { type: "integer", description: "Ending line (inclusive)" },
          replacement: { type: "string" },
          search: { type: "string" },
          replaceAll: { type: "boolean", default: false },
        },
      },
      pattern: { type: "string", default: "**", description: "Glob pattern for list" },
      maxDepth: { type: "integer", default: 3, description: "Max depth for explore" },
    },
    required: ["operation"],
  },
  execute,
};

export default codeEditorTool;
