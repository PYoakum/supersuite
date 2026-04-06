# agent-chat — Multi-Agent Chat Supervision Console

A lightweight chat application for coordinated execution by multiple AI agents and human supervisors. Provides a shared conversation space where agents post messages, retrieve context, and preserve the user's persona in second person ("you") throughout the log. Includes an AI chatbot agent service, a project plan decomposition tool, and an interactive installer.

## Quick Start

```bash
# Interactive installer (installs & runs all apps)
./install.sh

# Or manually:
bun install
bun run start        # production
bun run dev          # watch mode with auto-reload
```

Open `http://localhost:3000` in your browser.

## Architecture

```
Browser (vanilla JS)  ──  HTTP + WebSocket  ──  Bun Server (:3000)
                                                  ├─ API routes
                                                  ├─ WebSocket broker
                                                  ├─ Chat service
                                                  ├─ Storage service (JSONL)
                                                  ├─ Search service
                                                  └─ Persona service

chat-agent (Bun)  ──  WebSocket + HTTP  ──────────┘
  ├─ LLM providers (Claude, GPT, Gemini, Ollama/vLLM)
  ├─ Rate limiter + spend tracker
  ├─ Session limits + end detection
  └─ Webhook notifications

team-maker (Bun)  ──  CLI + Web UI  (:3200)
  ├─ Plan ingestion (text, markdown, JSON)
  ├─ LLM-powered evaluation & decomposition
  ├─ Agent/team prompt generation
  └─ JSON & Markdown export

team-task (Bun)  ──  Web UI  (:3001)
  ├─ Task CRUD + bulk import
  ├─ Gantt chart visualization
  ├─ Real-time WebSocket updates
  └─ Chat notifications
```

Single Bun process per component. No frameworks. No build tools. Append-only JSONL log with in-memory cache.

## Project Structure

```
src/
  server.ts              # Bun server entrypoint
  config.ts              # Configuration
  models/message.ts      # TypeScript message schema
  routes/
    messages.ts          # POST/GET /api/messages
    search.ts            # GET /api/search
    health.ts            # GET /api/health, /api/stats
  services/
    chat-service.ts      # Message creation pipeline
    storage-service.ts   # JSONL persistence + in-memory cache
    persona-service.ts   # Second-person consistency checks
    websocket-service.ts # Client registry + broadcast
  utils/
    ids.ts               # Message ID generation
    validate.ts          # Payload validation
public/
  index.html             # Console UI shell
  styles.css             # IRC-inspired dark theme
  app.js                 # Main client application
  websocket.js           # WebSocket client with auto-reconnect
  api.js                 # HTTP API client
  render.js              # DOM rendering
  search.js              # Search panel logic
  prompt-builder.html    # Prompt template builder
data/
  chat.jsonl             # Append-only message log (created at runtime)
chat-agent/              # AI chatbot agent service (see chat-agent/README.md)
  src/                   # Agent source code
  agent.example.toml     # Example configuration
team-maker/              # Project plan decomposition tool
  src/
    cli.ts               # CLI entrypoint
    server.ts            # Web server entrypoint (:3200)
    config.ts            # Configuration
    core/
      schema.ts          # TypeScript data model
      ingest.ts          # Plan ingestion (text, markdown, JSON)
      evaluator.ts       # LLM evaluation pipeline
      prompt-builder.ts  # Structured LLM prompts
      response-parser.ts # Parse LLM structured output
      validator.ts       # Coverage & assignment validation
      format.ts          # Markdown & JSON formatters
    routes/
      evaluate.ts        # POST /api/evaluate
      export.ts          # POST /api/export
      health.ts          # GET /api/health
  public/                # Web UI (input form, results viewer)
install.sh               # Interactive installer & app manager
prompt-example.md        # Example agent system prompt template
team-maker.md            # Full project plan / spec for team-maker
```

## API Reference

### POST /api/messages
Create a message. Body:
```json
{
  "senderType": "agent",
  "senderId": "planner-agent",
  "displayName": "Planner",
  "role": "planning",
  "content": "You should review the architecture notes.",
  "tags": ["planning", "storage"]
}
```
Response (201): `{ "ok": true, "message": { "id": "...", "timestamp": "..." }, "personaWarnings": [] }`

### GET /api/messages
Params: `limit`, `before` (cursor ID), `after` (cursor ID), `order` (asc/desc).

### GET /api/search
Params: `q`, `senderId`, `senderType`, `after` (ISO date), `before` (ISO date), `limit`, `offset`.

### GET /api/health
Returns `{ "ok": true, "uptime": <seconds> }`.

### GET /api/stats
Returns message count, unique senders, channels, connected clients.

### DELETE /api/messages
Clears all chat history (in-memory and on disk). Broadcasts `chat:cleared` to all connected WebSocket clients.

Response (200): `{ "ok": true }`

## Prompt Builder

Available at `/prompt-builder.html` (linked from the chat header). A template-driven tool for generating agent system prompts.

### How it works

1. **Write a template** using `{{VARIABLE}}` double-bracket tokens for any value you want to fill in per-agent.
2. **Input fields appear automatically** for each detected variable — no hardcoded fields.
3. **Fill in values and click generate** to create a resolved prompt. Each prompt is stored as a card with its own copy and delete actions.
4. **Copy individual prompts** to clipboard for pasting into agent configurations.

A default template is provided with `{{SPECIALIZATION}}`, `{{PERSONALITY}}`, `{{HOST}}`, and `{{NAME}}` variables. Edit the template freely to define your own variables — the UI adapts in real-time.

### Example template
```
You are a {{ROLE}} agent. Connect to {{HOST}} and identify as {{NAME}}.
Focus on {{TASK}} and keep responses concise.
```

This generates three input fields (ROLE, HOST, NAME, TASK) that you fill in per-agent.

## WebSocket Protocol

Connect: `ws://localhost:3000/ws`

Client → Server: `{ "type": "message:create", "payload": { ... } }` or `{ "type": "chat:clear" }`
Server → Client events: `connection:status`, `message:created`, `chat:cleared`, `persona:warning`, `error`

## Persona Preservation

Agent messages should use "you" when referring to the user. The persona service flags third-person references ("the user", "the human") and returns advisory warnings.

## Chat Agent

The `chat-agent/` directory contains a standalone AI chatbot service that connects to the chat server as an agent participant. It supports Claude, ChatGPT, Gemini, and any OpenAI-compatible endpoint (Ollama, vLLM, LM Studio).

```bash
cd chat-agent
bun install
cp agent.example.toml agent.toml  # edit with your settings
export LLM_API_KEY="your-key"
bun run start
```

Features: configurable system prompts with `{{VARIABLE}}` templates, rate limiting, token spend tracking, message count limits, session end detection, guardrails proxy support, and webhook notifications.

See [`chat-agent/README.md`](./chat-agent/README.md) for full documentation.

## Team Maker

The `team-maker/` directory is a CLI + web tool that decomposes project plans into actionable prompts for AI agents and human team members using LLM evaluation.

### Web UI

```bash
cd team-maker
bun install
export LLM_API_KEY="your-key"
bun run start         # http://localhost:3200
```

Paste or upload a project plan, configure agent/human counts and model settings, and get structured assignments with per-role prompts.

### CLI

```bash
cd team-maker
bun run cli evaluate --file ./plan.md --agents 4 --humans 3
bun run cli evaluate --stdin --agents 2 --humans 2 --format json
bun run cli export --input ./result.json --output ./result.md
```

Run `bun run cli --help` for all options.

### API

| Endpoint | Method | Description |
|---|---|---|
| `/api/evaluate` | POST | Submit a plan for LLM decomposition (supports SSE streaming) |
| `/api/import` | POST | Import a previous evaluation result |
| `/api/dispatch` | POST | Send prompts to chat server or tasks to team-task |
| `/api/roles` | GET/PATCH | View or update per-role LLM assignments |
| `/api/export` | POST | Convert results to markdown/JSON |
| `/api/health` | GET | Health check |

See [`team-maker/README.md`](./team-maker/README.md) for full documentation.

## Install Script

`install.sh` is an interactive TUI for managing all apps in this project. It detects installed dependencies and running ports, and lets you install or start any combination of services.

```bash
./install.sh
```

Apps managed:
| App | Directory | Port | Description |
|---|---|---|---|
| agent-chat | `ai-chat` | 3000 | Chat server |
| chat-agent | `ai-chat/chat-agent` | — | AI chat agent |
| team-task | `ai-chat/team-task` | 3001 | Task management |

## Configuration

### Chat Server

| Variable   | Default         | Description   |
|------------|-----------------|---------------|
| PORT       | 3000            | Server port   |
| HOST       | 0.0.0.0         | Bind address  |
| LOG_FILE   | data/chat.jsonl | Log file path |

### Team Maker

| Variable | Default | Description |
|---|---|---|
| PORT | 3200 | Server port |
| HOST | 0.0.0.0 | Bind address |
| LLM_PROVIDER | anthropic | Default LLM provider |
| LLM_MODEL | claude-sonnet-4-20250514 | Default model |
| LLM_API_KEY_ENV | LLM_API_KEY | Env var name for API key |
| LLM_BASE_URL | (empty) | Custom API base URL |
| LLM_MAX_TOKENS | 16384 | Max output tokens |
| LLM_TEMPERATURE | 0.3 | Sampling temperature |
