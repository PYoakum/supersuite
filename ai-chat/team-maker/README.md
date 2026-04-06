# team-maker

Decompose project plans into AI agent and human team prompts using LLM evaluation. Web UI, CLI, and dispatch to chat-agent and team-task.

## Install

```bash
cd ai-chat/team-maker
bun install
```

Create `ai-chat/.env` with your API keys:

```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

## Run

```bash
bun run dev          # web UI at http://localhost:3200 (watch mode)
bun run start        # production
```

## CLI

```bash
bun run cli evaluate --file ./plan.md --agents 4 --humans 3
bun run cli evaluate --file ./plan.md --format json --output result.json
bun run cli evaluate --stdin --agents 2 --humans 1
bun run cli export --input result.json --output result.md
bun run cli --help
```

## Web UI

1. Paste or upload a project plan (markdown, text, or JSON)
2. Set AI agent count, human count, provider, model, and strategy
3. Click **Evaluate Plan** — streams the LLM response live, then renders structured results
4. Review tasks, assignments, and generated prompts
5. Configure per-role LLM provider/model in the Model Assignment section
6. **Send to Chat** — dispatches prompts to the chat server as system messages
7. **Send to Tasks** — imports tasks into team-task with assignees and priorities
8. **Export** as JSON or Markdown
9. **Import** a previous result JSON to skip re-evaluation

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/evaluate` | Evaluate a plan (set `stream: true` for SSE) |
| POST | `/api/import` | Import a previous evaluation result |
| POST | `/api/dispatch` | Send prompts/tasks to chat or task server |
| GET/PATCH | `/api/roles` | Get or update role LLM assignments |
| POST | `/api/export` | Export results as markdown or JSON |
| GET | `/api/health` | Health check |

## Dispatch Targets

**Chat** (`{ target: "chat" }`) — posts each role's prompt to the chat server (`CHAT_SERVER_URL`, default `:3000`) as a system message tagged with the role ID.

**Tasks** (`{ target: "tasks" }`) — bulk imports decomposed tasks to team-task (`TASK_SERVER_URL`, default `:3001`) with assignees, groups, priorities, and dependencies.

Both support `roleIds` array to dispatch specific roles only.

## Config

All via environment variables or `ai-chat/.env`:

| Variable | Default | Description |
|---|---|---|
| PORT | 3200 | Server port |
| LLM_PROVIDER | anthropic | Default provider |
| LLM_MODEL | claude-sonnet-4-20250514 | Default model |
| ANTHROPIC_API_KEY | — | Anthropic API key |
| OPENAI_API_KEY | — | OpenAI API key |
| GEMINI_API_KEY | — | Gemini API key |
| LLM_MAX_TOKENS | 16384 | Max output tokens |
| LLM_TEMPERATURE | 0.3 | Sampling temperature |
| LLM_BASE_URL | — | Custom base URL (openai-compat) |
| CHAT_SERVER_URL | http://localhost:3000 | Chat server for dispatch |
| TASK_SERVER_URL | http://localhost:3001 | Task server for dispatch |
