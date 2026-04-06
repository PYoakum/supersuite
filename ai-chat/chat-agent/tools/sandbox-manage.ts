import { readdirSync, statSync, readFileSync, renameSync, existsSync, mkdirSync } from "fs";
import { join, relative, dirname, basename } from "path";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Helpers ────────────────────────────────────────────────────

function getSandboxRoot(ctx: ToolContext, sessionId?: string): string {
  const base = (ctx.sandbox as any)?.baseDir || "./sandbox";
  return sessionId ? join(base, sessionId) : base;
}

function walkDir(dir: string, root: string, results: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, root, results);
    } else {
      results.push(relative(root, full));
    }
  }
}

function isInsideSandbox(path: string, sandboxRoot: string): boolean {
  const resolved = join(sandboxRoot, path);
  const rel = relative(sandboxRoot, resolved);
  return !rel.startsWith("..") && !rel.startsWith("/");
}

// ── sandbox_search_files ───────────────────────────────────────

async function executeSearchFiles(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const pattern = args.pattern as string | undefined;
  const agentId = (args.agent_id as string) || "";
  const sandboxRoot = getSandboxRoot(ctx);

  if (!pattern) return formatError("pattern is required (glob-like: *.txt, report*, etc.)");

  // Convert simple glob to regex
  const regexStr = pattern
    .replace(/\./g, "\\.")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  const regex = new RegExp(regexStr, "i");

  const searchRoot = agentId ? join(sandboxRoot, agentId) : sandboxRoot;
  const files: string[] = [];
  walkDir(searchRoot, sandboxRoot, files);

  const matches = files.filter(f => regex.test(basename(f)) || regex.test(f));

  if (matches.length === 0) {
    return formatResponse({ count: 0, matches: [], searched: searchRoot });
  }

  const results = matches.slice(0, 100).map(f => {
    const full = join(sandboxRoot, f);
    try {
      const s = statSync(full);
      return { path: f, size: s.size, modified: s.mtime.toISOString() };
    } catch {
      return { path: f, size: 0, modified: "" };
    }
  });

  return formatResponse({ count: results.length, matches: results });
}

// ── sandbox_search_content ─────────────────────────────────────

async function executeSearchContent(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const query = args.query as string | undefined;
  const agentId = (args.agent_id as string) || "";
  const maxResults = (args.max_results as number) || 20;
  const sandboxRoot = getSandboxRoot(ctx);

  if (!query) return formatError("query is required (text to search for)");

  const searchRoot = agentId ? join(sandboxRoot, agentId) : sandboxRoot;
  const files: string[] = [];
  walkDir(searchRoot, sandboxRoot, files);

  const TEXT_EXTS = new Set(["txt", "md", "js", "ts", "json", "html", "css", "py", "toml", "yaml", "yml", "csv", "xml", "sh", "sql"]);
  const queryLower = query.toLowerCase();
  const results: { path: string; line: number; text: string }[] = [];

  for (const f of files) {
    const ext = f.split(".").pop()?.toLowerCase() || "";
    if (!TEXT_EXTS.has(ext)) continue;

    const full = join(sandboxRoot, f);
    try {
      const content = readFileSync(full, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(queryLower)) {
          results.push({ path: f, line: i + 1, text: lines[i].trim().slice(0, 200) });
          if (results.length >= maxResults) break;
        }
      }
      if (results.length >= maxResults) break;
    } catch {}
  }

  return formatResponse({ count: results.length, query, results });
}

// ── sandbox_move ───────────────────────────────────────────────

async function executeMove(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const from = args.from as string | undefined;
  const to = args.to as string | undefined;
  const sandboxRoot = getSandboxRoot(ctx);

  if (!from) return formatError("from is required (source path relative to sandbox/)");
  if (!to) return formatError("to is required (destination path relative to sandbox/)");
  if (!isInsideSandbox(from, sandboxRoot)) return formatError("from path must be inside sandbox");
  if (!isInsideSandbox(to, sandboxRoot)) return formatError("to path must be inside sandbox");

  const srcFull = join(sandboxRoot, from);
  const dstFull = join(sandboxRoot, to);

  if (!existsSync(srcFull)) return formatError(`Source not found: ${from}`);

  // Create destination directory if needed
  const dstDir = dirname(dstFull);
  if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });

  try {
    renameSync(srcFull, dstFull);
    return formatResponse({ moved: true, from, to });
  } catch (err) {
    return formatError(`Move failed: ${err instanceof Error ? err.message : err}`);
  }
}

// ── sandbox_rename ─────────────────────────────────────────────

async function executeRename(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const path = args.path as string | undefined;
  const newName = args.new_name as string | undefined;
  const sandboxRoot = getSandboxRoot(ctx);

  if (!path) return formatError("path is required (file path relative to sandbox/)");
  if (!newName) return formatError("new_name is required");
  if (newName.includes("/") || newName.includes("\\")) return formatError("new_name must be a filename, not a path");
  if (!isInsideSandbox(path, sandboxRoot)) return formatError("path must be inside sandbox");

  const srcFull = join(sandboxRoot, path);
  if (!existsSync(srcFull)) return formatError(`File not found: ${path}`);

  const dstFull = join(dirname(srcFull), newName);
  const newRelative = relative(sandboxRoot, dstFull);

  try {
    renameSync(srcFull, dstFull);
    return formatResponse({ renamed: true, from: path, to: newRelative });
  } catch (err) {
    return formatError(`Rename failed: ${err instanceof Error ? err.message : err}`);
  }
}

// ── sandbox_list ───────────────────────────────────────────────

async function executeList(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const dir = (args.path as string) || "";
  const agentId = (args.agent_id as string) || "";
  const sandboxRoot = getSandboxRoot(ctx);

  const listRoot = agentId ? join(sandboxRoot, agentId, dir) : join(sandboxRoot, dir);

  if (!existsSync(listRoot)) return formatError(`Directory not found: ${dir || "/"}`);

  try {
    const entries = readdirSync(listRoot, { withFileTypes: true }).map(e => {
      const full = join(listRoot, e.name);
      const s = statSync(full);
      return {
        name: e.name,
        type: e.isDirectory() ? "dir" : "file",
        size: e.isFile() ? s.size : undefined,
        modified: s.mtime.toISOString(),
      };
    });
    return formatResponse({ path: dir || "/", count: entries.length, entries });
  } catch (err) {
    return formatError(`List failed: ${err instanceof Error ? err.message : err}`);
  }
}

// ── Tool Definitions ───────────────────────────────────────────

const searchFilesTool: Tool = {
  name: "sandbox_search_files",
  description: "Search for files by name pattern across agent sandboxes. Supports glob-like patterns (*.txt, report*, etc.).",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Filename pattern to search for (e.g. *.txt, report*, *.py)" },
      agent_id: { type: "string", description: "Limit search to a specific agent's sandbox (e.g. 'lyric')" },
    },
    required: ["pattern"],
  },
  execute: executeSearchFiles,
};

const searchContentTool: Tool = {
  name: "sandbox_search_content",
  description: "Search file contents across agent sandboxes. Returns matching lines with file paths and line numbers.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Text to search for (case-insensitive)" },
      agent_id: { type: "string", description: "Limit search to a specific agent's sandbox" },
      max_results: { type: "number", description: "Maximum results to return (default 20)" },
    },
    required: ["query"],
  },
  execute: executeSearchContent,
};

const moveTool: Tool = {
  name: "sandbox_move",
  description: "Move a file or directory within the sandbox. Paths are relative to sandbox/ root. Creates destination directories automatically.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "Source path (e.g. 'lyric/draft.txt')" },
      to: { type: "string", description: "Destination path (e.g. 'lyric/final/draft.txt')" },
    },
    required: ["from", "to"],
  },
  execute: executeMove,
};

const renameTool: Tool = {
  name: "sandbox_rename",
  description: "Rename a file in the sandbox. Only changes the filename, not the directory.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to sandbox/ (e.g. 'lyric/draft.txt')" },
      new_name: { type: "string", description: "New filename (e.g. 'final_draft.txt')" },
    },
    required: ["path", "new_name"],
  },
  execute: executeRename,
};

const listTool: Tool = {
  name: "sandbox_list",
  description: "List files and directories in a sandbox path. Shows names, types, sizes, and modification times.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path relative to sandbox/ (default: root)" },
      agent_id: { type: "string", description: "List a specific agent's sandbox" },
    },
  },
  execute: executeList,
};

const tools: Tool[] = [searchFilesTool, searchContentTool, moveTool, renameTool, listTool];

export default tools;
