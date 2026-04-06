# supersuite

A self-hosted app platform where AI agents and humans work side by side. Paste a project plan, and the system decomposes it into tasks, spins up specialized agents with individual skills, and assigns a project manager to keep everything on track. Agents can interact with every app in the suite through built-in tools.

Built with [Bun](https://bun.sh) and Rust.

## Apps

### Productivity

| App | Description | Stack |
|-----|-------------|-------|
| [noted](noted/) | Document editor with versioning, tags, and folders | Bun, PostgreSQL |
| [wiki](wiki/) | Flat-file markdown wiki with shared password editing | Bun, SQLite |
| [calender](calender/) | Calendar with events, reminders, ICS feed import, and desktop app | Bun, PostgreSQL |
| [p-mail](p-mail/) | Email client with IMAP/SMTP, templates, and drafts | Bun |
| [js-forms](js-forms/) | Drag-and-drop form builder with CSV/JSON export | Bun |
| [js-spreadsheets](js-spreadsheets/) | Spreadsheet editor with formulas and CSV import | Bun |

### Operations

| App | Description | Stack |
|-----|-------------|-------|
| [warehouse](warehouse/) | Inventory management with barcode scanning and check-in/out | Bun, PostgreSQL |
| [asset-mapper](asset-mapper/) | Network asset tracking with interactive 3D map | Bun, SQLite |
| [rs-label](rs-label/) | Label printer CLI for Brother PT-D600 series | Rust |
| [vidiyo](vidiyo/) | Video project manager with render pipeline | Bun |

### Community

| App | Description | Stack |
|-----|-------------|-------|
| [community-board](community-board/) | BBS-style forum with categories, threads, and DMs | Bun, PostgreSQL |
| [yolodex](yolodex/) | Nonprofit CRM — contacts, donations, memberships, SMTP | Bun |

### Infrastructure

| App | Description | Stack |
|-----|-------------|-------|
| [vm-provisioner](vm-provisioner/) | Multi-backend VM manager (Firecracker, QEMU, Docker) with live dashboard | Bun |
| [virtual-client](virtual-client/) | Browser-based x86 VM emulator using v86 | Bun, v86 WebAssembly |
| [iso-builder](iso-builder/) | Build custom Linux live ISOs with TUI wizard | Bash |
| [fc-image-builder](fc-image-builder/) | Build Firecracker microVM rootfs and kernel images | Bash |
| [qemu-image-builder](qemu-image-builder/) | Build QEMU disk images with package customization | Bash |
| [codebaux](codebaux/) | Browser-based VM sandbox for running code projects | Firecracker guest image |

---

## AI Agent Platform

The [`ai-chat/`](ai-chat/) directory is the orchestration layer. It consists of four services:

| Service | Port | Purpose |
|---------|------|---------|
| **chat server** | 3000 | WebSocket chat room where agents and humans talk |
| **team-task** | 3001 | Task board with status tracking and dependency management |
| **team-maker** | 3200 | Plan decomposition, role generation, agent launching |
| **chat-agent** | — | Per-agent process with LLM provider and tool access |

### How it works

1. **Submit a plan** — Paste a project plan (markdown, text, or JSON) into team-maker
2. **Evaluation** — An LLM decomposes the plan into tasks and assigns them to AI and human roles
3. **PM generation** — Project manager agents are auto-created to oversee workers, grouped by workstream
4. **Skills & tools** — Each agent gets individualized skill files (markdown) and tool access
5. **Launch** — Agents join the chat room and start working. PMs manage the task board; workers report progress in natural language
6. **Task sync** — A bridge watches chat for status updates and syncs them to the task board in real time

### Permissions

- **PM agents** can update task status (`[TASK:T1:done]` tags)
- **Worker agents** report to their PM in plain language — task tags from workers are rejected
- **Humans** have priority over all agents — any human message gets an immediate response

### Agent Tools

Agents interact with the suite through 50+ tools:

**App integrations** — calendar, noted, wiki, community-board, asset-mapper, warehouse, p-mail, vidiyo, yolodex, rs-label, js-forms, js-spreadsheets, codebaux

**Code & files** — bash-command, code-editor, file-create, read-file, js-execute, python-runner, golang-exec, framework-exec, project-scaffold, git-host

**Research & web** — browser-request, context-research-browser, analyze-research, review-research, http-request

**Media** — create-image, create-drum, midi-mp3, edit-audio, audio-cleanup, tts, stt, voice-clone, create-mesh, create-obj, post-image, post-voice-note

**Management** — chat-moderation, flag-agent, evaluate-chat, read-chat-logs, reasoning

### Skills

Skills are markdown files assigned per-agent that get injected into their system prompt:

| Skill | Focus |
|-------|-------|
| `bun-typescript.md` | Bun runtime patterns, server conventions, testing |
| `rust-service.md` | rs-{name} conventions, axum 0.8, async patterns |
| `code-review.md` | Review checklist and feedback format |
| `api-design.md` | REST conventions, status codes, pagination |
| `testing-qa.md` | Test strategy, integration tests, what to test |
| `technical-writing.md` | README, API docs, architecture doc patterns |
| `music-composition.md` | Song structure, arrangement, mixing, mastering |

Create your own by dropping a `.md` file in `ai-chat/team-maker/skills/` and assigning it from the UI.

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.1+
- [Rust](https://rustup.rs) (for rs-label only)
- PostgreSQL (for apps that use it) or SQLite (auto-created)

### Run any app

```bash
cd noted
bun install
cp config.toml.example config.toml  # edit as needed
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
# Add your API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY)

# Start services (each in a separate terminal)
bun run src/server.ts                    # chat server on :3000
cd team-task && bun run src/server.ts    # task board on :3001
cd team-maker && bun run src/server.ts   # orchestrator on :3200
```

Then open `http://localhost:3200` to submit a plan and launch agents.

---

## Configuration

Every app follows the same pattern:

- `config.toml.example` — reference config, committed to git
- `config.toml` — your local config, gitignored
- `.env` / `.env.example` — environment variables for secrets

No real credentials are stored in the repository.

## License

MIT
