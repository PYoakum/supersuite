# chat-agent — AI Chatbot Agent for agent-chat

A Bun-based service that connects to an [agent-chat](../) server as an AI-powered participant. Supports multiple LLM providers, configurable system prompts with template variables, rate limiting, token spend tracking, and webhook notifications.

## Quick Start

```bash
cd chat-agent
bun install

# Copy and edit the config
cp agent.example.toml agent.toml

# Set your API key
export LLM_API_KEY="sk-..."

# Run
bun run start
# or with a custom config path
bun run start -- --config ./my-agent.toml
```

## Configuration

All configuration lives in a single TOML file. See [`agent.example.toml`](./agent.example.toml) for a fully commented example.

### Identity

```toml
[identity]
sender_id = "analyst-agent"
display_name = "Analyst"
role = "analysis"
tags = ["analysis", "data"]
```

### LLM Provider

Four providers are supported:

| Provider | `provider` value | Notes |
|---|---|---|
| Anthropic (Claude) | `anthropic` | Uses the Messages API |
| OpenAI (ChatGPT) | `openai` | Uses Chat Completions |
| Google (Gemini) | `gemini` | Uses the Generative Language API |
| OpenAI-compatible | `openai-compat` | Ollama, vLLM, LM Studio, etc. |

```toml
[llm]
provider = "openai-compat"
model = "llama3"
api_key_env = "LLM_API_KEY"
base_url = "http://localhost:11434/v1"   # Ollama example
max_tokens = 1024
temperature = 0.7
```

The `api_key_env` field names the environment variable holding your key — the key itself is never stored in the config file.

### System Prompt Templates

Prompts use `{{VARIABLE}}` tokens, the same syntax as the [prompt builder](../public/prompt-builder.html):

```toml
[prompt]
template = """
You are {{NAME}}, a specialist in {{SPECIALIZATION}}.
{{PERSONALITY}}
"""

[prompt.variables]
NAME = "Analyst"
SPECIALIZATION = "data analysis"
PERSONALITY = "You are methodical and evidence-driven."
```

Use `--dry-run` to validate your config and see the resolved prompt without connecting:

```bash
bun run start -- --dry-run
```

### Limits

#### Rate limiting
```toml
[limits.rate]
min_delay_ms = 3000        # minimum time between outgoing messages
max_per_minute = 10         # rolling per-minute cap
max_message_chars = 5000    # truncate outgoing messages beyond this
```

#### Token spend
```toml
[limits.spend]
max_input_tokens = 500000   # per session
max_output_tokens = 50000
```

#### Message counts
```toml
[limits.messages]
max_sent = 200
max_received = 500
```

#### Session end conditions
```toml
[limits.session]
max_duration_minutes = 60
max_total_messages = 300
end_keywords = ["session:end", "/end"]
send_farewell = true
farewell_message = "Session limit reached. Signing off."
```

When any limit is reached, the agent sends a farewell message (if configured), fires a webhook notification, logs session stats, and exits.

### Guardrails Proxy

Route all LLM API calls through a guardrails/safety proxy:

```toml
[guardrails]
enabled = true
proxy_url = "http://localhost:8080"
```

When enabled, the proxy URL replaces the provider's default API base URL. The proxy receives the exact same request the LLM API would have received.

### Webhooks

```toml
[webhooks]
url = "https://hooks.example.com/chat-agent"
on_error = true
on_limit_reached = true
on_session_end = true
```

Webhook payloads are JSON:
```json
{
  "event": "limit_reached",
  "agent_id": "analyst-agent",
  "timestamp": "2026-04-03T...",
  "details": { "reason": "Max sent messages reached (200)" }
}
```

## Architecture

```
src/
  index.ts               # Entry point, CLI, main loop
  logger.ts              # Structured console logger
  config/
    schema.ts            # Zod config schema
    loader.ts            # TOML loading + validation
  providers/
    types.ts             # LLMProvider interface
    anthropic.ts         # Claude (Anthropic Messages API)
    openai.ts            # ChatGPT (OpenAI Chat Completions)
    gemini.ts            # Gemini (Google Generative Language)
    factory.ts           # Provider factory
  chat/
    ws-client.ts         # WebSocket client with auto-reconnect
    history.ts           # Bootstrap context from /api/messages
    context.ts           # Sliding-window conversation context
  limits/
    rate-limiter.ts      # Message rate limiting
    spend-tracker.ts     # Token budget tracking
    session-tracker.ts   # Message count + duration limits
    end-detector.ts      # Keyword-based end detection
  template/
    resolver.ts          # {{VARIABLE}} template engine
  webhooks/
    notifier.ts          # Webhook POST notifications
```

The agent is event-driven: it connects via WebSocket, listens for `message:created` events, and generates LLM responses subject to all configured limits. There is no polling — rate limiting controls the response cadence.

## Running Multiple Agents

Launch multiple agents with different configs to simulate a team:

```bash
bun run src/index.ts --config agents/analyst.toml &
bun run src/index.ts --config agents/engineer.toml &
bun run src/index.ts --config agents/designer.toml &
```

Each agent connects independently to the same chat server.
