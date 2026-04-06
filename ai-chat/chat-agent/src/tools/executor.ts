import { resolve } from "path";
import type { AgentConfig } from "../config/schema";
import type { ToolSchema as LLMToolSchema } from "../providers/types";
import { createToolRouter, type ToolRouter } from "../../tools/index";
import { validateToolArgs, validateCommand } from "./sandbox-guard";
import { log } from "../logger";

export interface ToolExecutionResult {
  content: string;
  isError: boolean;
}

// Tools that execute shell commands and need command validation
const COMMAND_TOOLS = new Set(["bash_command"]);

// Tools that only read files (no writes) — exempt from sandbox path validation
// since they may receive absolute paths from other tools (e.g., TTS output in /tmp)
const PATH_EXEMPT_TOOLS = new Set(["post_voice_note", "post_image", "rs_label"]);

export class ToolExecutor {
  private router: ToolRouter;
  private config: AgentConfig;
  private sandboxRoot: string;

  constructor(config: AgentConfig) {
    this.config = config;
    this.sandboxRoot = resolve(config.tools.sandbox_dir);

    const allowed = config.tools.allowed.length > 0 ? config.tools.allowed : undefined;
    const denied = config.tools.denied.length > 0 ? config.tools.denied : undefined;

    this.router = createToolRouter({
      sandboxDir: config.tools.sandbox_dir,
      config: {
        chatServerUrl: config.server.api_url,
        teamMakerUrl: config.server.team_maker_url || "http://localhost:3200",
        agentId: config.identity.sender_id,
        agentName: config.identity.display_name,
        agentChannel: config.identity.channel,
        agentRole: config.identity.role,
        integrations: config.integrations ?? {},
        llm: { provider: config.llm.provider, model: config.llm.model, api_key_env: config.llm.api_key_env, base_url: config.llm.base_url },
        reasoning: config.reasoning ?? {},
      },
      enabledTools: allowed,
      disabledTools: denied,
    });

    log.info(`Tools loaded: ${this.router.toolNames.length} (${this.router.toolNames.join(", ")})`);
    log.info(`Sandbox root: ${this.sandboxRoot}`);
  }

  /** Get tool schemas formatted for LLM providers */
  getToolSchemas(): LLMToolSchema[] {
    return this.router.getAllSchemas().map(s => ({
      name: s.name,
      description: s.description,
      input_schema: s.inputSchema,
    }));
  }

  /** Check if a tool is available */
  hasTool(name: string): boolean {
    return this.router.hasTool(name);
  }

  /** Execute a tool by name with the given arguments */
  async execute(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    if (!this.router.hasTool(name)) {
      return { content: `Tool not found: ${name}`, isError: true };
    }

    // ── Defense-in-depth: validate all path arguments ──
    if (!PATH_EXEMPT_TOOLS.has(name)) {
      const pathCheck = validateToolArgs(name, args, this.sandboxRoot);
      if (!pathCheck.allowed) {
        log.error(`SandboxGuard BLOCKED tool ${name}: ${pathCheck.reason}`);
        return {
          content: `Sandbox violation: ${pathCheck.reason}`,
          isError: true,
        };
      }

      // ── Additional check for command-execution tools ──
      if (COMMAND_TOOLS.has(name)) {
        const cmd = (args.command as string) || (args.args as string[])?.join(" ") || "";
        if (cmd) {
          const cmdCheck = validateCommand(cmd, this.sandboxRoot);
          if (!cmdCheck.allowed) {
            log.error(`SandboxGuard BLOCKED command in ${name}: ${cmdCheck.reason}`);
            return {
              content: `Sandbox violation: ${cmdCheck.reason}`,
              isError: true,
            };
          }
        }
      }
    }

    // ── Inject sessionId if not provided (ensures sandbox isolation) ──
    if (!args.sessionId) {
      args.sessionId = this.config.identity.sender_id;
    }

    try {
      const result = await this.router.executeTool(name, args);
      const text = result.content.map(c => c.text).join("\n");
      return { content: text, isError: result.isError ?? false };
    } catch (err) {
      log.error(`Tool execution failed (${name}): ${err}`);
      return { content: `Tool error: ${err}`, isError: true };
    }
  }

  get toolNames(): string[] {
    return this.router.toolNames;
  }
}
