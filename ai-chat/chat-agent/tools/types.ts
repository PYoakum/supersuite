// ── Tool System Types ────────────────────────────────────────

export interface ToolResultContent {
  type: "text";
  text: string;
}

export interface ToolResult {
  content: ToolResultContent[];
  isError?: boolean;
}

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type ToolHandler = (
  args: Record<string, unknown>,
  session?: { sandboxPath: string; sessionId: string } | null
) => Promise<ToolResult>;

export interface RegisteredTool {
  handler: ToolHandler;
  schema: ToolSchema;
}

// ── Modular Tool Interface ──────────────────────────────────
// Every tool file must `export default` an object satisfying this interface.
// The router auto-discovers and registers tools from files that match this contract.

export interface ToolContext {
  sandbox: import("./sandbox").SandboxManager;
  config: Record<string, unknown>;
  session?: { sandboxPath: string; sessionId: string } | null;
}

export interface Tool {
  /** Unique tool name (used in LLM tool_use calls). */
  name: string;
  /** Human-readable description for LLM schema. */
  description: string;
  /** JSON Schema for the tool's input arguments. */
  inputSchema: ToolSchema["inputSchema"];
  /** Whether the tool requires a sandbox (default: true). */
  needsSandbox?: boolean;
  /** Execute the tool with the given arguments and context. */
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

// ── Sandbox Types ────────────────────────────────────────────

export interface SandboxConfig {
  baseDir: string;
  maxFileSize?: number;
  maxTotalSize?: number;
  defaultSandboxId?: string;
}

export interface SandboxStats {
  totalSandboxes: number;
  totalSize: number;
  sandboxSizes: Record<string, number>;
  limits: { maxFileSize: number; maxTotalSize: number };
}

// ── Tool Config ──────────────────────────────────────────────

export interface ToolsConfig {
  sandboxDir: string;
  httpAllowedHosts: string[];
  httpTimeout: number;
  bashEnabled: boolean;
  bashAllowSudo: boolean;
  bashAllowedCommands: string[] | null;
  jsRuntimes: { node: boolean; bun: boolean };
}

// ── Helpers ──────────────────────────────────────────────────

export function formatResponse(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

export function formatError(message: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}
