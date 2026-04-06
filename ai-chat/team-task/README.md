# team-task — Task Management & Tracking

A lightweight task management application for teams and AI agents. Functions as a simplified ticketing system with real-time updates, Gantt chart visualization, and push notifications to [ai-chat](../ai-chat/).

## Quick Start

```bash
bun run start        # production
bun run dev          # watch mode with auto-reload
```

Open `http://localhost:3001` in your browser.

## Architecture

```
Browser (vanilla JS)  ──  HTTP + WebSocket  ──  Bun Server
                                                  ├─ API routes (CRUD + import)
                                                  ├─ WebSocket broker
                                                  ├─ Task service
                                                  ├─ Storage service (JSONL)
                                                  └─ Notify service (ai-chat)
```

Single Bun process. No frameworks. No dependencies. Append-only JSONL log with in-memory cache.

## Project Structure

```
src/
  server.ts              # Bun server entrypoint
  config.ts              # Configuration
  models/task.ts         # Task schema & types
  routes/
    tasks.ts             # CRUD endpoints
    import.ts            # Bulk import endpoint
    health.ts            # Health & stats
  services/
    task-service.ts      # Task business logic
    storage-service.ts   # JSONL persistence + in-memory cache
    websocket-service.ts # Client registry + broadcast
    notify-service.ts    # ai-chat push notifications
  utils/
    ids.ts               # Task ID generation
    validate.ts          # Payload validation
public/
  index.html             # UI shell with tabs
  styles.css             # Dark monospace theme
  app.js                 # Main app + tab switching
  api.js                 # HTTP API client
  websocket.js           # WebSocket client with auto-reconnect
  tasks.js               # Task list rendering & CRUD
  gantt.js               # Gantt chart (HTML/CSS)
  chart.js               # Completion chart (Canvas 2D)
  import.js              # JSON import UI
data/
  tasks.jsonl            # Append-only task log (created at runtime)
```

## API Reference

### POST /api/tasks
Create a task. Body:
```json
{
  "title": "Migrate database schema",
  "description": "Move from v2 to v3 schema format",
  "status": "todo",
  "priority": "high",
  "tags": ["backend", "database"],
  "dependencies": ["task_1711929600_0_a1b2"],
  "assignee": "alice",
  "group": "infrastructure",
  "startDate": "2026-04-01",
  "dueDate": "2026-04-10"
}
```
Response (201): `{ "ok": true, "task": { ... } }`

Only `title` is required. Defaults: status=`todo`, priority=`medium`.

### GET /api/tasks
List tasks with optional filters.

| Param    | Description                         |
|----------|-------------------------------------|
| status   | Filter by status                    |
| priority | Filter by priority                  |
| assignee | Filter by assignee                  |
| group    | Filter by group                     |
| tag      | Filter by tag                       |
| q        | Search title, description, and tags |
| limit    | Page size (default 50, max 500)     |
| offset   | Offset for pagination               |

### GET /api/tasks/:id
Get a single task by ID.

### PUT /api/tasks/:id
Update a task. Body contains only the fields to update.

### DELETE /api/tasks/:id
Delete a task.

### DELETE /api/tasks
Clear all tasks (in-memory and on disk). Broadcasts `tasks:cleared` to all connected WebSocket clients.

### GET /api/export
Download all tasks as a JSON file. Returns `{ "tasks": [ ... ] }` with a `Content-Disposition: attachment` header.

### POST /api/import
Bulk import tasks. Body:
```json
{
  "tasks": [
    { "title": "Task 1", "status": "todo", "priority": "high" },
    { "title": "Task 2", "status": "in-progress", "assignee": "bob" }
  ]
}
```
Response (201): `{ "ok": true, "imported": 2, "tasks": [ ... ] }`

### POST /api/notify/:id
Push a notification about a task to the configured ai-chat instance.

### GET /api/health
Returns `{ "ok": true, "uptime": <seconds> }`.

### GET /api/stats
Returns task counts by status and priority, groups, assignees, and connected WebSocket clients.

## WebSocket Protocol

Connect: `ws://localhost:3001/ws`

### Client → Server
| Type          | Payload                        |
|---------------|--------------------------------|
| task:create   | CreateTaskPayload              |
| task:update   | { id, ...UpdateTaskPayload }   |
| task:delete   | { id }                         |

### Server → Client
| Type              | Payload                          |
|-------------------|----------------------------------|
| connection:status | { status, clientId }             |
| task:created      | Full task object                 |
| task:updated      | Full task object                 |
| task:deleted      | { id }                           |
| tasks:imported    | { count }                        |
| error             | { errors: string[] }             |

## Task Model

| Field        | Type     | Description                                          |
|--------------|----------|------------------------------------------------------|
| id           | string   | Auto-generated (`task_<ts>_<seq>_<rand>`)            |
| title        | string   | Task title (required, max 200 chars)                 |
| description  | string   | Detailed description                                 |
| status       | string   | `todo`, `in-progress`, `blocked`, `done`, `cancelled`|
| priority     | string   | `low`, `medium`, `high`, `critical`                  |
| tags         | string[] | Freeform labels                                      |
| dependencies | string[] | Task IDs this task depends on                        |
| assignee     | string   | Person or agent assigned                             |
| group        | string   | Logical grouping                                     |
| startDate    | string   | YYYY-MM-DD                                           |
| dueDate      | string   | YYYY-MM-DD                                           |
| completedAt  | string   | ISO 8601, set automatically when status → done       |
| createdAt    | string   | ISO 8601                                             |
| updatedAt    | string   | ISO 8601                                             |

## UI Tabs

### Tasks
List view with inline status cycling, filters by status/priority/search, and a create/edit form. Each task card shows a notify button (📢) to push status to ai-chat.

### Visualize
- **Gantt chart**: Tasks with start/due dates shown on a timeline. Color-coded by status, filterable by group. Today marker shown as a red vertical line.
- **Completion chart**: Canvas-drawn line chart of cumulative tasks completed over time, with daily count bars.

### Import
Paste JSON or upload a `.json` file to bulk-create tasks. Validates all entries before importing.

## ai-chat Integration

When `CHAT_URL` is set, the notify service can push task updates to your ai-chat instance as a service user. Two modes:

1. **Manual**: Click 📢 on any task or call `POST /api/notify/:id`
2. **Automatic**: Set `NOTIFY_ON_CHANGE=true` to broadcast on every status change, assignment, or import

Messages appear in ai-chat as:
```
[DONE] Task "Migrate database schema" (task_abc123) — status → done
Assignee: alice
Group: infrastructure
Tags: #backend #database
```

## Configuration

Copy `.env.example` to `.env` and adjust:

| Variable         | Default         | Description                                   |
|------------------|-----------------|-----------------------------------------------|
| PORT             | 3001            | Server port                                   |
| HOST             | 0.0.0.0         | Bind address                                  |
| DATA_FILE        | data/tasks.jsonl | Task log file path                            |
| CHAT_URL         | (empty)         | ai-chat base URL for notifications            |
| CHAT_SENDER_ID   | task-manager    | Sender ID in ai-chat                          |
| CHAT_DISPLAY_NAME| Task Manager    | Display name in ai-chat                       |
| CHAT_CHANNEL     | general         | ai-chat channel to post to                    |
| NOTIFY_ON_CHANGE | false           | Auto-notify on task changes                   |
