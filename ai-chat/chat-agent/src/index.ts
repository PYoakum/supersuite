import { parseArgs } from "util";
import { resolve } from "path";
import { loadConfig, resolveApiKey } from "./config/loader";
import { resolveTemplate, extractVariables } from "./template/resolver";
import { createProvider } from "./providers/factory";
import type { LLMMessage, LLMContentBlock, ToolUseBlock } from "./providers/types";
import { WSClient } from "./chat/ws-client";
import { HttpTransport } from "./chat/http-transport";
import { fetchHistory, type ChatMessage } from "./chat/history";
import { ContextManager } from "./chat/context";
import { RateLimiter } from "./limits/rate-limiter";
import { SpendTracker } from "./limits/spend-tracker";
import { SessionTracker } from "./limits/session-tracker";
import { EndDetector } from "./limits/end-detector";
import { WebhookNotifier } from "./webhooks/notifier";
import { ToolExecutor } from "./tools/executor";
import { log, setPrefix } from "./logger";

// ── CLI args ────────────────────────────────────
const { values: args } = parseArgs({
  options: {
    config: { type: "string", default: "agent.toml" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (args.help) {
  console.log(`chat-agent — AI chatbot agent for agent-chat

Usage:
  bun run src/index.ts [options]

Options:
  --config <path>    Path to TOML config file (default: ./agent.toml)
  --dry-run          Validate config and print resolved prompt, then exit
  --help             Show this help`);
  process.exit(0);
}

// ── Load config ─────────────────────────────────
const configPath = resolve(args.config!);
const config = loadConfig(configPath);
setPrefix(config.identity.sender_id);

const apiKey = resolveApiKey(config);
const systemPrompt = resolveTemplate(config.prompt.template, config.prompt.variables);

if (args["dry-run"]) {
  console.log("=== Resolved Config ===");
  console.log(`Provider: ${config.llm.provider} (${config.llm.model})`);
  console.log(`Identity: ${config.identity.display_name} [${config.identity.sender_id}]`);
  console.log(`Server:   ${config.server.url}`);
  console.log(`Tools:    ${config.tools.enabled ? "enabled" : "disabled"}`);
  console.log();
  console.log("=== System Prompt ===");
  console.log(systemPrompt);

  const vars = extractVariables(config.prompt.template);
  const unresolved = vars.filter(v => config.prompt.variables[v] === undefined);
  if (unresolved.length > 0) {
    console.log(`\nWARN: Unresolved variables: ${unresolved.join(", ")}`);
  }

  if (config.tools.enabled) {
    const executor = new ToolExecutor(config);
    console.log(`\n=== Tools (${executor.toolNames.length}) ===`);
    console.log(executor.toolNames.join(", "));
  }
  process.exit(0);
}

// ── Init modules ────────────────────────────────
const provider = createProvider(config, apiKey);
const context = new ContextManager(config, systemPrompt);
const rateLimiter = new RateLimiter(config);
const spendTracker = new SpendTracker(config);
const sessionTracker = new SessionTracker(config);
const endDetector = new EndDetector(config);
const notifier = new WebhookNotifier(config);

let toolExecutor: ToolExecutor | null = null;
if (config.tools.enabled) {
  toolExecutor = new ToolExecutor(config);
}

let responding = false;
let pendingResponse = false;
let shuttingDown = false;
let usingHttp = false;
let lastResponseTime = 0;
let lastRespondedToAgent = false; // true if last response was triggered by an agent message

// ── Token reporting to team-maker ──────────────
function reportUsage(): void {
  const teamMakerUrl = config.server.team_maker_url;
  if (!teamMakerUrl) return;

  const usage = spendTracker.getUsage();
  fetch(`${teamMakerUrl}/api/agents/stats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentId: config.identity.sender_id,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    }),
  }).catch(() => {}); // fire-and-forget
}

// ── HTTP fallback transport ─────────────────────
const httpTransport = new HttpTransport({
  apiUrl: config.server.api_url,
  pollIntervalMs: config.server.http_poll_interval_ms,
  onMessage(type, payload) {
    if (type === "message:created" && payload) {
      handleIncoming(payload as ChatMessage);
    }
  },
});

function activateHttpFallback(): void {
  if (usingHttp) return;
  usingHttp = true;
  log.warn("Falling back to HTTP polling");
  httpTransport.start();

  setInterval(() => {
    if (shuttingDown) return;
    log.info("Attempting to restore WebSocket...");
    ws.resetAttempts();
    ws.connect();
  }, 60_000);
}

// ── Helpers ─────────────────────────────────────
function sendChatMessage(content: string, tags?: string[], contentFormat?: string): void {
  const truncated = content.slice(0, config.limits.rate.max_message_chars);
  const payload: Record<string, unknown> = {
    senderType: config.identity.sender_type,
    senderId: config.identity.sender_id,
    displayName: config.identity.display_name,
    avatar: config.identity.avatar || undefined,
    role: config.identity.role || undefined,
    content: truncated,
    tags: tags || (config.identity.tags.length > 0 ? config.identity.tags : undefined),
    channel: config.identity.channel,
  };
  if (contentFormat) payload.contentFormat = contentFormat;

  if (usingHttp && !ws.connected) {
    httpTransport.send("message:create", payload);
  } else {
    ws.send("message:create", payload);
  }
  rateLimiter.recordSend();
  sessionTracker.recordSent();
}

function announceToolUse(toolName: string): void {
  if (!config.tools.announce_tool_use) return;
  if (config.tools.silent_tools.includes(toolName)) return;
  const content = `${config.identity.display_name} is using ${toolName}`;
  const payload: Record<string, unknown> = {
    senderType: "system",
    senderId: config.identity.sender_id,
    displayName: config.identity.display_name,
    content,
    tags: ["tool-use", toolName],
    channel: config.identity.channel,
    contentFormat: "tool-use",
  };

  if (usingHttp && !ws.connected) {
    httpTransport.send("message:create", payload);
  } else {
    ws.send("message:create", payload);
  }
}

function announceToolDone(toolName: string): void {
  if (!config.tools.announce_tool_use) return;
  if (config.tools.silent_tools.includes(toolName)) return;
  const content = `${config.identity.display_name} finished using ${toolName}`;
  const payload: Record<string, unknown> = {
    senderType: "system",
    senderId: config.identity.sender_id,
    displayName: config.identity.display_name,
    content,
    tags: ["tool-done", toolName],
    channel: config.identity.channel,
    contentFormat: "tool-done",
  };

  if (usingHttp && !ws.connected) {
    httpTransport.send("message:create", payload);
  } else {
    ws.send("message:create", payload);
  }
}

// ── Tool execution loop ─────────────────────────
// Uses a LOCAL message array to avoid contamination from WS echoes
// of messages posted by tools (e.g., post_voice_note posts to chat,
// which echoes back and would corrupt the shared context mid-loop).
async function executeToolLoop(
  toolUseBlocks: ToolUseBlock[],
  assistantContentBlocks: LLMContentBlock[],
): Promise<string> {
  if (!toolExecutor) return "";

  // Snapshot the current context and build a local message array
  const localMessages: LLMMessage[] = context.toLLMMessages();
  let rounds = 0;
  let currentToolUse = toolUseBlocks;
  let currentAssistantBlocks = assistantContentBlocks;

  while (currentToolUse.length > 0 && rounds < config.tools.max_tool_rounds) {
    rounds++;

    // Append assistant message with tool_use blocks
    localMessages.push({ role: "assistant", content: currentAssistantBlocks });

    // Execute each tool and collect results
    for (const tu of currentToolUse) {
      log.info(`Tool call: ${tu.name} (round ${rounds})`);
      announceToolUse(tu.name);

      const result = await toolExecutor.execute(tu.name, tu.input);

      announceToolDone(tu.name);
      log.debug(`Tool result (${tu.name}): ${result.content.slice(0, 200)}${result.content.length > 200 ? "..." : ""}`);

      // Append tool result
      localMessages.push({
        role: "tool_result",
        tool_use_id: tu.id,
        content: result.content,
      });
    }

    // Call LLM again with tool results
    const toolSchemas = toolExecutor.getToolSchemas();
    const followUp = await provider.complete({
      messages: localMessages,
      max_tokens: config.llm.max_tokens,
      temperature: config.llm.temperature,
      tools: toolSchemas,
    });

    spendTracker.record(followUp.input_tokens, followUp.output_tokens);
    log.debug(`Follow-up tokens: +${followUp.input_tokens} in, +${followUp.output_tokens} out`);

    if (spendTracker.isOverBudget()) {
      log.warn("Token spend limit reached during tool loop");
      return followUp.content || "";
    }

    if (followUp.tool_use && followUp.tool_use.length > 0) {
      currentAssistantBlocks = [];
      if (followUp.content) {
        currentAssistantBlocks.push({ type: "text", text: followUp.content });
      }
      for (const tu of followUp.tool_use) {
        currentAssistantBlocks.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
      }
      currentToolUse = followUp.tool_use;
    } else {
      return followUp.content || "";
    }
  }

  if (rounds >= config.tools.max_tool_rounds) {
    log.warn(`Max tool rounds (${config.tools.max_tool_rounds}) reached`);
  }

  return "";
}

// ── Response generation ─────────────────────────
async function generateResponse(): Promise<void> {
  if (responding || shuttingDown) {
    pendingResponse = true;
    return;
  }

  if (!rateLimiter.canSend()) {
    const wait = rateLimiter.timeUntilReady();
    log.debug(`Rate limited, waiting ${wait}ms`);
    setTimeout(() => generateResponse(), wait);
    return;
  }

  responding = true;
  pendingResponse = false;

  const safetyTimer = setTimeout(() => {
    if (responding) {
      log.error("LLM response timed out (90s safety limit) — releasing lock");
      responding = false;
      if (pendingResponse && !shuttingDown) generateResponse();
    }
  }, 90_000);

  try {
    const messages = context.toLLMMessages();
    const toolSchemas = toolExecutor?.getToolSchemas();

    const req = {
      messages,
      max_tokens: config.llm.max_tokens,
      temperature: config.llm.temperature,
      tools: toolSchemas && toolSchemas.length > 0 ? toolSchemas : undefined,
    };

    let content = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let toolUseBlocks: ToolUseBlock[] | undefined;
    let stopReason: string | undefined;

    // When tools are enabled, use non-streaming complete to get tool_use blocks
    if (toolExecutor) {
      const result = await provider.complete(req);
      content = result.content;
      inputTokens = result.input_tokens;
      outputTokens = result.output_tokens;
      toolUseBlocks = result.tool_use;
      stopReason = result.stop_reason;
    } else if (provider.streamComplete) {
      for await (const chunk of provider.streamComplete(req)) {
        if (chunk.text) content += chunk.text;
        if (chunk.usage) {
          inputTokens = chunk.usage.input_tokens;
          outputTokens = chunk.usage.output_tokens;
        }
      }
    } else {
      const result = await provider.complete(req);
      content = result.content;
      inputTokens = result.input_tokens;
      outputTokens = result.output_tokens;
    }

    spendTracker.record(inputTokens, outputTokens);
    reportUsage();
    log.debug(`Tokens: +${inputTokens} in, +${outputTokens} out (${content.length} chars)`);

    if (spendTracker.isOverBudget()) {
      const usage = spendTracker.getUsage();
      log.warn("Token spend limit reached", usage);
      if (content.trim()) sendChatMessage(content.trim());
      await shutdown(`Token budget exhausted (in: ${usage.inputTokens}/${usage.maxInput}, out: ${usage.outputTokens}/${usage.maxOutput})`);
      return;
    }

    // Handle tool use
    if (toolUseBlocks && toolUseBlocks.length > 0 && toolExecutor) {
      // Build assistant content blocks for the tool loop
      const assistantBlocks: LLMContentBlock[] = [];
      if (content) {
        assistantBlocks.push({ type: "text", text: content });
      }
      for (const tu of toolUseBlocks) {
        assistantBlocks.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
      }

      // Don't send pre-tool text separately — it's in the assistant blocks
      // and sending it as a chat message creates duplicate context entries
      // that break Anthropic's alternating role requirement.

      // Execute tools and get final response
      const finalContent = await executeToolLoop(toolUseBlocks, assistantBlocks);
      if (finalContent.trim()) {
        sendChatMessage(finalContent.trim());
      }
    } else if (content.trim()) {
      sendChatMessage(content.trim());
    }
  } catch (err) {
    log.error(`LLM error: ${err}`);
    notifier.notify("error", { error: String(err) });
  } finally {
    clearTimeout(safetyTimer);
    responding = false;
    lastResponseTime = Date.now();
  }

  if (pendingResponse && !shuttingDown) {
    generateResponse();
  }
}

async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`Shutting down: ${reason}`);

  if (config.limits.session.send_farewell) {
    sendChatMessage(config.limits.session.farewell_message);
  }

  const stats = { ...sessionTracker.getStats(), ...spendTracker.getUsage(), reason };
  await notifier.notify("session_end", stats);

  log.info("Session stats:", stats);
  ws.close();
  setTimeout(() => process.exit(0), 500);
}

function handleIncoming(msg: ChatMessage): void {
  // Skip own messages (optionally add to context)
  if (msg.senderId === config.identity.sender_id) {
    if (config.context.include_own_messages) {
      context.addMessage(msg);
    }
    return;
  }

  // Skip tool-use/tool-done announcements — noise, not conversation
  const fmt = (msg as any).contentFormat;
  if (fmt === "tool-use" || fmt === "tool-done") {
    return;
  }

  // Skip periodic queue status polls from team-maker
  if (msg.senderId === "team-maker" && (msg as any).tags?.includes("queue-status")) {
    return;
  }

  context.addMessage(msg);
  sessionTracker.recordReceived();

  const endCheck = endDetector.check(msg.content);
  if (endCheck.ended) {
    shutdown(`End keyword detected: "${endCheck.keyword}"`);
    return;
  }

  const sessionCheck = sessionTracker.shouldStop();
  if (sessionCheck.stop) {
    notifier.notify("limit_reached", { reason: sessionCheck.reason });
    shutdown(sessionCheck.reason);
    return;
  }

  // Human messages: always respond immediately, reset agent-loop guard
  if (msg.senderType === "human") {
    lastRespondedToAgent = false;
    pendingResponse = true;
    generateResponse();
    return;
  }

  // System messages (nudges, task notifications): respond but don't loop
  if (msg.senderType === "system") {
    lastRespondedToAgent = false;
    if (!responding) {
      generateResponse();
    } else {
      pendingResponse = true;
    }
    return;
  }

  // Agent messages: only respond once, then wait for human/system to break the cycle
  if (lastRespondedToAgent) {
    log.debug(`Skipping agent message from ${msg.senderId} — already responded to an agent, waiting for human/system`);
    return;
  }

  lastRespondedToAgent = true;
  if (!responding) {
    generateResponse();
  } else {
    pendingResponse = true;
  }
}

// ── WebSocket ───────────────────────────────────
const ws = new WSClient({
  url: config.server.url,
  reconnectDelay: config.server.reconnect_delay_ms,
  maxReconnectDelay: config.server.max_reconnect_delay_ms,
  maxReconnectAttempts: config.server.max_reconnect_attempts,

  async onConnected(clientId) {
    log.info(`Connected as ${config.identity.display_name} (client: ${clientId})`);

    if (usingHttp) {
      log.info("WebSocket restored — stopping HTTP polling");
      httpTransport.stop();
      usingHttp = false;
    }

    if (config.server.bootstrap_history > 0) {
      const history = await fetchHistory(config.server.api_url, config.server.bootstrap_history);
      if (history.length > 0) {
        context.addHistory(history);
        log.info(`Loaded ${history.length} messages from history`);

        const lastMsg = history[history.length - 1];
        if (lastMsg?.id) httpTransport.seedLastId(lastMsg.id);

        // Generate initial response if bootstrap has messages from others
        const hasUnaddressed = history.some(m => m.senderId !== config.identity.sender_id);
        if (hasUnaddressed) {
          log.info("Bootstrap contains unaddressed messages — generating response");
          generateResponse();
        }
      }
    }
  },

  onMessage(type, payload) {
    if (type === "message:created" && payload) {
      handleIncoming(payload as ChatMessage);
    } else if (type === "chat:cleared") {
      context.clear();
      log.info("Chat history cleared by server");
    } else if (type === "error") {
      log.warn("Server error:", payload);
    }
  },

  onDisconnected() {},

  onFallback() {
    activateHttpFallback();
  },
});

// ── Start ───────────────────────────────────────
log.info(`Starting ${config.identity.display_name} [${config.identity.sender_id}]`);
log.info(`Provider: ${provider.name} (${config.llm.model})`);
log.info(`Server: ${config.server.url}`);
if (toolExecutor) {
  log.info(`Tools: ${toolExecutor.toolNames.length} enabled`);
}
ws.connect();

// ── Graceful shutdown ───────────────────────────
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
