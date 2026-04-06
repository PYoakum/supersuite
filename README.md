# supersuite

A self-hosted app platform where AI agents and humans work side by side. Paste in a project plan and the system breaks it into tasks, spins up specialized agents with individual skills, and assigns a project manager to keep everything on track. Agents interact with every app in the suite through built-in tools — scheduling meetings, editing documents, managing inventory, printing labels, composing music, and more.

Built with [Bun](https://bun.sh) and Rust. 16 apps. No cloud dependencies.

---

## Apps

### Productivity

| App | Description | Stack |
|-----|-------------|-------|
| [noted](noted/) | Document editor with versioning, tags, and folder organization | Bun, PostgreSQL |
| [wiki](wiki/) | Flat-file markdown wiki with shared password editing | Bun, SQLite |
| [calender](calender/) | Calendar with events, reminders, ICS feed import, and an Electron desktop app | Bun, PostgreSQL |
| [p-mail](p-mail/) | Email client with IMAP/SMTP support, templates, and drafts | Bun |
| [js-forms](js-forms/) | Drag-and-drop form builder with CSV/JSON export | Bun |
| [js-spreadsheets](js-spreadsheets/) | Spreadsheet editor with formulas and CSV import | Bun |

### Operations

| App | Description | Stack |
|-----|-------------|-------|
| [warehouse](warehouse/) | Inventory management with barcode scanning and check-in/out tracking | Bun, PostgreSQL |
| [asset-mapper](asset-mapper/) | Network asset tracking with an interactive 3D map view | Bun, SQLite |
| [rs-label](rs-label/) | USB label printer driver and CLI for Brother PT-D600 series | Rust |
| [vidiyo](vidiyo/) | Video project manager with timeline editing and render pipeline | Bun |

### Community

| App | Description | Stack |
|-----|-------------|-------|
| [community-board](community-board/) | BBS-style forum with categories, threads, and direct messages | Bun, PostgreSQL |
| [yolodex](yolodex/) | Nonprofit CRM for contacts, donations, memberships, and SMTP outreach | Bun |

### Infrastructure

| App | Description | Stack |
|-----|-------------|-------|
| [vm-provisioner](vm-provisioner/) | Multi-backend VM manager (Firecracker, QEMU, Docker) with real-time web dashboard | Bun |
| [virtual-client](virtual-client/) | Browser-based x86 emulator powered by v86 WebAssembly | Bun, v86 |
| [qemu-image-builder](qemu-image-builder/) | Build QEMU/KVM disk images with custom packages | Bash |

---

## AI Agent Platform

The [`ai-chat/`](ai-chat/) directory is the orchestration layer that ties everything together.

### Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  team-maker  │────▶│  chat server │◀───▶│  team-task   │
│    :3200     │     │    :3000     │     │    :3001     │
│  plan → roles│     │  WebSocket   │     │  task board  │
└──────┬───────┘     └──────┬───────┘     └──────────────┘
       │                    │
       ▼                    ▼
  ┌─────────┐    ┌─────────────────────┐
  │ PM agent│    │   worker agents     │
  │ (task   │◀──▶│ (skills + tools)    │
  │  board) │    │                     │
  └─────────┘    └────────┬────────────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
          calendar     warehouse    noted  ...
```

| Service | Port | Purpose |
|---------|------|---------|
| **chat server** | 3000 | WebSocket chat room where agents and humans collaborate |
| **team-task** | 3001 | Task board with dependency tracking and real-time status |
| **team-maker** | 3200 | Plan decomposition, PM generation, agent launching, skill/tool assignment |
| **chat-agent** | — | Per-agent process with LLM provider, tools, and prompt injection |

### How It Works

1. **Submit a plan** — Paste a project plan (markdown, text, or JSON) into team-maker's web UI
2. **Evaluation** — An LLM decomposes the plan into tasks and assigns them across AI and human roles
3. **PM generation** — Project manager agents are auto-created to oversee workers, grouped by workstream
4. **Skills & tools** — Each agent gets individualized skill files (markdown reference docs) and a tool allowlist
5. **Launch** — Agents join the chat room and start working. PMs manage the task board; workers report progress in natural language
6. **Task sync** — A bridge watches chat for `[TASK:T1:done]` status tags and syncs to the task board in real time

### Permissions

| Role | Can update task board | Reports to |
|------|----------------------|------------|
| **PM agents** | Yes — via `[TASK:Tx:status]` tags | Humans |
| **Worker agents** | No — tags are rejected | Their PM |
| **Humans** | Yes — directly or via UI | — |

Human messages always take priority. Every agent responds to humans immediately.

### Agent Tools (50+)

Agents interact with the world through typed tool calls. The LLM decides when and how to use them.

| Category | Tools |
|----------|-------|
| **Suite apps** | calendar, noted, wiki, community-board, asset-mapper, warehouse, p-mail, vidiyo, yolodex, rs-label, forms-builder, spreadsheet-builder, codebaux |
| **Code & files** | bash-command, code-editor, file-create, read-file, js-execute, python-runner, golang-exec, framework-exec, project-scaffold, git-host |
| **Research** | browser-request, context-research-browser, analyze-research, review-research, http-request |
| **Media** | create-image, create-drum, midi-mp3, edit-audio, audio-cleanup, tts, stt, voice-clone, create-mesh, create-obj, post-image, post-voice-note |
| **Management** | chat-moderation, flag-agent, evaluate-chat, read-chat-logs, reasoning |

### Skills

Skills are markdown files that get injected into an agent's system prompt — giving it domain-specific knowledge.

| Skill | What it teaches |
|-------|-----------------|
| `bun-typescript.md` | Bun runtime, `Bun.serve()` patterns, test runner |
| `rust-service.md` | `rs-{name}` conventions, axum 0.8, async pitfalls |
| `code-review.md` | Review checklist, what to flag, feedback format |
| `api-design.md` | REST URL structure, status codes, pagination |
| `testing-qa.md` | Test strategy, real databases over mocks, naming |
| `technical-writing.md` | READMEs, API docs, architecture docs |
| `music-composition.md` | Song structure, arrangement, mixing, EQ, compression |

Add your own: drop a `.md` file in `ai-chat/team-maker/skills/` and assign it to any role from the web UI.

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.1+
- [Rust](https://rustup.rs) (only for rs-label)
- PostgreSQL (for apps that use it) or SQLite (auto-created)
- An LLM API key (Anthropic, OpenAI, or Gemini) for the agent platform

### Run any app

```bash
cd noted
bun install
cp config.toml.example config.toml   # edit as needed
bun run src/server.ts
```

### Run the AI platform

```bash
cd ai-chat

# Install all services
bun install
cd chat-agent && bun install && cd ..
cd team-maker && bun install && cd ..
cd team-task && bun install && cd ..

# Configure
cp .env.example .env
# Add your API key: ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY

# Start services (each in its own terminal)
bun run src/server.ts                    # chat server on :3000
cd team-task && bun run src/server.ts    # task board on :3001
cd team-maker && bun run src/server.ts   # orchestrator on :3200
```

Open `http://localhost:3200`, paste a plan, and launch your agents.

### Build a VM image

```bash
cd qemu-image-builder && sudo ./build-image.sh --format qcow2 --size 2G
```

---

## Configuration

Every app follows the same pattern:

- `config.toml.example` — reference config, committed to git
- `config.toml` — your local config, gitignored
- `.env` / `.env.example` — environment variables for secrets

No credentials are stored in this repository.

## License

[MIT](LICENSE)
