import type { ToolHandler, ToolSchema, ToolResult, RegisteredTool, Tool, ToolContext } from "./types";
import type { SandboxManager } from "./sandbox";

export class ToolRouter {
  private tools = new Map<string, RegisteredTool>();
  sandboxManager: SandboxManager | null;
  private config: Record<string, unknown>;

  constructor(sandboxManager: SandboxManager | null = null, config: Record<string, unknown> = {}) {
    this.sandboxManager = sandboxManager;
    this.config = config;
  }

  // ── Modular Tool Loading ────────────────────────────────────

  /**
   * Register a Tool module (the new drop-in interface).
   * Each tool file exports `default` satisfying the `Tool` interface.
   */
  addTool(tool: Tool): void {
    const ctx: ToolContext = {
      sandbox: this.sandboxManager!,
      config: this.config,
    };

    const handler: ToolHandler = (args, session) => tool.execute(args, { ...ctx, session });
    const schema: ToolSchema = {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    };

    this.tools.set(tool.name, { handler, schema });
  }

  /**
   * Load multiple Tool modules at once.
   */
  addTools(tools: Tool[]): void {
    for (const tool of tools) this.addTool(tool);
  }

  // ── Legacy Registration (backwards compat) ─────────────────

  registerTool(name: string, handler: ToolHandler, schema: ToolSchema): void {
    this.tools.set(name, { handler, schema });
  }

  /**
   * Remove a tool by name. Returns true if the tool was found and removed.
   */
  removeTool(name: string): boolean {
    return this.tools.delete(name);
  }

  // ── Query & Execute ─────────────────────────────────────────

  getTool(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  getAllSchemas(): ToolSchema[] {
    return Array.from(this.tools.values()).map((t) => t.schema);
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);

    let session: { sandboxPath: string; sessionId: string } | null = null;
    if (args.sessionId && this.sandboxManager) {
      const sandboxPath = await this.sandboxManager.ensureSandbox(args.sessionId as string);
      session = { sandboxPath, sessionId: args.sessionId as string };
    }

    return tool.handler(args, session);
  }

  getManifest(): {
    serverName: string;
    serverVersion: string;
    tools: ToolSchema[];
    toolCount: number;
  } {
    return {
      serverName: "swarm-agent",
      serverVersion: "1.0.0",
      tools: this.getAllSchemas(),
      toolCount: this.tools.size,
    };
  }

  get toolNames(): string[] {
    return Array.from(this.tools.keys());
  }
}
