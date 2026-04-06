import { Database } from "bun:sqlite";
import { stat } from "fs/promises";
import { existsSync } from "fs";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Connection Pool ──────────────────────────────────────────

const connections = new Map<string, Database>();

function getConnection(dbPath: string, options: { create?: boolean; readonly?: boolean; forceNew?: boolean } = {}): Database {
  if (connections.has(dbPath) && !options.forceNew) return connections.get(dbPath)!;

  const db = new Database(dbPath, { create: options.create !== false, readonly: options.readonly ?? false });
  db.run("PRAGMA foreign_keys = ON");
  connections.set(dbPath, db);
  return db;
}

function closeConnection(dbPath: string): void {
  if (connections.has(dbPath)) {
    connections.get(dbPath)!.close();
    connections.delete(dbPath);
  }
}

// ── Operations ───────────────────────────────────────────────

async function sqliteCreate(sandbox: ToolContext["sandbox"], sessionId: string | undefined, path: string, options: { overwrite?: boolean; pragmas?: Record<string, string> }): Promise<ToolResult> {
  if (!path) throw new Error("path is required");
  const absPath = await sandbox.resolvePath(sessionId, path);

  if (existsSync(absPath) && !options.overwrite) {
    throw Object.assign(new Error(`Database already exists: ${path}`), { code: "FILE_EXISTS" });
  }

  await sandbox.ensureParentDir(absPath);
  const db = getConnection(absPath, { create: true, forceNew: true });

  if (options.pragmas) {
    for (const [pragma, value] of Object.entries(options.pragmas)) {
      db.run(`PRAGMA ${pragma} = ${value}`);
    }
  }

  const pageSize = db.query("PRAGMA page_size").get() as Record<string, unknown> | null;
  const journalMode = db.query("PRAGMA journal_mode").get() as Record<string, unknown> | null;
  const stats = await stat(absPath);

  return formatResponse({
    success: true, operation: "sqlite_create", path, size: stats.size,
    created: stats.birthtime.toISOString(),
    settings: { pageSize: pageSize?.page_size, journalMode: journalMode?.journal_mode },
  });
}

async function databaseExecute(sandbox: ToolContext["sandbox"], sessionId: string | undefined, path: string, sql: string | undefined, statements: string[]): Promise<ToolResult> {
  if (!path) throw new Error("path is required");
  if (!sql && statements.length === 0) throw new Error("sql or statements is required");

  const absPath = await sandbox.resolvePath(sessionId, path);
  if (!existsSync(absPath)) throw Object.assign(new Error(`Database not found: ${path}`), { code: "FILE_NOT_FOUND" });

  const db = getConnection(absPath);
  const sqlStatements = sql ? [sql] : statements;
  const results: Record<string, unknown>[] = [];

  for (const stmt of sqlStatements) {
    const trimmed = stmt.trim();
    if (!trimmed) continue;

    try {
      const startTime = Date.now();
      db.run(trimmed);
      results.push({ sql: trimmed.slice(0, 100) + (trimmed.length > 100 ? "..." : ""), success: true, duration: Date.now() - startTime });
    } catch (err: any) {
      results.push({ sql: trimmed.slice(0, 100) + (trimmed.length > 100 ? "..." : ""), success: false, error: err.message });
    }
  }

  const tables = db.query("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view', 'index', 'trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type, name").all() as { name: string; type: string }[];

  return formatResponse({
    success: results.every((r) => r.success !== false),
    operation: "database_execute", path, results,
    schema: {
      tables: tables.filter((t) => t.type === "table").map((t) => t.name),
      views: tables.filter((t) => t.type === "view").map((t) => t.name),
      indexes: tables.filter((t) => t.type === "index").map((t) => t.name),
      triggers: tables.filter((t) => t.type === "trigger").map((t) => t.name),
    },
  });
}

async function sqlRunner(sandbox: ToolContext["sandbox"], sessionId: string | undefined, path: string, query: string, params: unknown[], options: { readonly?: boolean; limit?: number }, maxResultRows: number): Promise<ToolResult> {
  if (!path) throw new Error("path is required");
  if (!query) throw new Error("query is required");

  const absPath = await sandbox.resolvePath(sessionId, path);
  if (!existsSync(absPath)) throw Object.assign(new Error(`Database not found: ${path}`), { code: "FILE_NOT_FOUND" });

  const db = getConnection(absPath, { readonly: options.readonly });
  const trimmed = query.trim();
  const upper = trimmed.toUpperCase();
  const isSelect = upper.startsWith("SELECT") || upper.startsWith("WITH") || upper.startsWith("PRAGMA");
  const startTime = Date.now();

  try {
    if (isSelect) {
      const stmt = db.query(trimmed);
      const rows = (params.length > 0 ? stmt.all(...params) : stmt.all()) as Record<string, unknown>[];
      const duration = Date.now() - startTime;
      const limitedRows = rows.slice(0, options.limit ?? maxResultRows);
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

      return formatResponse({
        success: true, operation: "sql_runner", queryType: "SELECT", path,
        columns, rows: limitedRows, rowCount: rows.length,
        truncated: rows.length > limitedRows.length, duration,
      });
    } else {
      const isInsert = upper.startsWith("INSERT");
      const isUpdate = upper.startsWith("UPDATE");
      const isDelete = upper.startsWith("DELETE");

      let result: { changes: number; lastInsertRowid: number | bigint };
      if (params.length > 0) {
        const stmt = db.query(trimmed);
        result = stmt.run(...params) as any;
      } else {
        result = db.run(trimmed) as any;
      }
      const duration = Date.now() - startTime;

      return formatResponse({
        success: true, operation: "sql_runner",
        queryType: isInsert ? "INSERT" : isUpdate ? "UPDATE" : isDelete ? "DELETE" : "OTHER",
        path, changes: result.changes,
        lastInsertRowid: isInsert ? Number(result.lastInsertRowid) : undefined,
        duration,
      });
    }
  } catch (err: any) {
    return formatResponse({
      success: false, operation: "sql_runner", path,
      error: { message: err.message, code: err.code }, duration: Date.now() - startTime,
    });
  }
}

// ── Execute Dispatcher ───────────────────────────────────────

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const action = args.action as string;
  const sessionId = args.sessionId as string | undefined;
  const path = args.path as string;
  const maxResultRows = (ctx.config.sqliteMaxResultRows as number) ?? 1000;

  if (!action) return formatError("action is required (create, execute, query, close)");

  switch (action) {
    case "create":
      return sqliteCreate(ctx.sandbox, sessionId, path, (args.options as { overwrite?: boolean; pragmas?: Record<string, string> }) ?? {});
    case "execute":
      return databaseExecute(ctx.sandbox, sessionId, path, args.sql as string | undefined, (args.statements as string[]) ?? []);
    case "query":
      return sqlRunner(ctx.sandbox, sessionId, path, args.query as string, (args.params as unknown[]) ?? [], (args.options as { readonly?: boolean; limit?: number }) ?? {}, maxResultRows);
    case "close":
      if (path) {
        const absPath = await ctx.sandbox.resolvePath(sessionId, path);
        closeConnection(absPath);
      }
      return formatResponse({ success: true, operation: "close", path });
    default:
      return formatError(`Unknown action: ${action}. Supported: create, execute, query, close`);
  }
}

// ── Tool Definition ─────────────────────────────────────────

const sqliteQueryTool: Tool = {
  name: "sqlite_query",
  description:
    "SQLite database operations: create databases, execute schema statements (CREATE TABLE, ALTER, etc.), run queries (SELECT, INSERT, UPDATE, DELETE), and manage connections. Uses Bun's built-in SQLite.",
  needsSandbox: true,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "execute", "query", "close"],
        description: "Database operation to perform",
      },
      sessionId: { type: "string", description: "Session ID for sandbox isolation" },
      path: { type: "string", description: 'Relative path to the database file (e.g., "data/app.db")' },
      sql: { type: "string", description: "SQL statement to execute (for execute action)" },
      statements: { type: "array", items: { type: "string" }, description: "Multiple SQL statements to execute in order" },
      query: { type: "string", description: "SQL query to run (for query action)" },
      params: {
        type: "array",
        description: "Query parameters for prepared statements",
        items: {},
      },
      options: {
        type: "object",
        properties: {
          overwrite: { type: "boolean", default: false, description: "Overwrite existing database (create)" },
          pragmas: { type: "object", additionalProperties: { type: "string" }, description: 'Initial PRAGMA settings (e.g., {"journal_mode": "WAL"})' },
          readonly: { type: "boolean", default: false, description: "Open database read-only (query)" },
          limit: { type: "integer", default: 1000, description: "Max rows to return for SELECT queries" },
        },
      },
    },
    required: ["action", "path"],
  },
  execute,
};

export default sqliteQueryTool;
