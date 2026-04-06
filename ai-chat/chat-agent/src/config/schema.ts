import { z } from "zod";

export const AgentConfigSchema = z.object({
  identity: z.object({
    sender_id: z.string().default("chat-agent"),
    display_name: z.string().default("Agent"),
    avatar: z.string().default(""),
    role: z.string().default(""),
    sender_type: z.literal("agent").default("agent"),
    channel: z.string().default("general"),
    tags: z.array(z.string()).default([]),
  }).default({}),

  server: z.object({
    url: z.string().default("ws://localhost:3000/ws"),
    api_url: z.string().default("http://localhost:3000"),
    team_maker_url: z.string().default(""),
    reconnect_delay_ms: z.number().default(2000),
    max_reconnect_delay_ms: z.number().default(15000),
    max_reconnect_attempts: z.number().default(5),
    http_poll_interval_ms: z.number().default(3000),
    bootstrap_history: z.number().default(50),
  }).default({}),

  llm: z.object({
    provider: z.enum(["anthropic", "openai", "gemini", "openai-compat"]).default("anthropic"),
    model: z.string().default("claude-sonnet-4-20250514"),
    api_key_env: z.string().default("LLM_API_KEY"),
    base_url: z.string().default(""),
    max_tokens: z.number().default(1024),
    temperature: z.number().default(0.7),
  }).default({}),

  prompt: z.object({
    template: z.string().default("You are a helpful assistant participating in a multi-agent chat room."),
    variables: z.record(z.string()).default({}),
  }).default({}),

  context: z.object({
    max_messages: z.number().default(40),
    max_chars: z.number().default(12000),
    include_own_messages: z.boolean().default(true),
  }).default({}),

  limits: z.object({
    rate: z.object({
      min_delay_ms: z.number().default(3000),
      max_per_minute: z.number().default(10),
      max_message_chars: z.number().default(5000),
    }).default({}),
    spend: z.object({
      max_input_tokens: z.number().default(500000),
      max_output_tokens: z.number().default(50000),
    }).default({}),
    messages: z.object({
      max_sent: z.number().default(200),
      max_received: z.number().default(500),
    }).default({}),
    session: z.object({
      max_duration_minutes: z.number().default(60),
      max_total_messages: z.number().default(300),
      end_keywords: z.array(z.string()).default(["session:end", "/end"]),
      send_farewell: z.boolean().default(true),
      farewell_message: z.string().default("Session limit reached. Signing off."),
    }).default({}),
  }).default({}),

  tools: z.object({
    enabled: z.boolean().default(false),
    allowed: z.array(z.string()).default([]),
    denied: z.array(z.string()).default([]),
    sandbox_dir: z.string().default("./sandbox"),
    max_tool_rounds: z.number().default(5),
    announce_tool_use: z.boolean().default(true),
    silent_tools: z.array(z.string()).default(["chat_participation", "evaluate_chat", "read_chat_logs", "aos_send", "dismiss_agent", "team_status", "update_task_tokens", "noted", "wiki", "community_board", "rs_label", "asset_mapper", "warehouse", "p_mail", "vidiyo", "yolodex", "thinking", "analyzing", "reviewing_work"]),
  }).default({}),

  reasoning: z.object({
    thinking: z.object({
      provider: z.string().default(""),
      model: z.string().default(""),
      api_key_env: z.string().default(""),
      max_tokens: z.number().default(4096),
      temperature: z.number().default(0.3),
    }).default({}),
    analyzing: z.object({
      provider: z.string().default(""),
      model: z.string().default(""),
      api_key_env: z.string().default(""),
      max_tokens: z.number().default(4096),
      temperature: z.number().default(0.2),
    }).default({}),
    reviewing_work: z.object({
      provider: z.string().default(""),
      model: z.string().default(""),
      api_key_env: z.string().default(""),
      max_tokens: z.number().default(4096),
      temperature: z.number().default(0.2),
    }).default({}),
  }).default({}),

  integrations: z.record(z.record(z.string())).default({}),

  guardrails: z.object({
    enabled: z.boolean().default(false),
    proxy_url: z.string().default(""),
  }).default({}),

  webhooks: z.object({
    url: z.string().default(""),
    on_error: z.boolean().default(true),
    on_limit_reached: z.boolean().default(true),
    on_session_end: z.boolean().default(true),
  }).default({}),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
