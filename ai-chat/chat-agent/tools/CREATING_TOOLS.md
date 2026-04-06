# Creating a Tool

Guide for creating new tools in the chat-agent tool system.

## Quick Start

1. Create a new `.ts` file in `tools/` (this directory)
2. Export a default `Tool` object (or array of `Tool` objects)
3. Import and add it to `ALL_TOOLS` in `tools/index.ts`

## File Structure

```
tools/
├── types.ts            # Tool, ToolContext, ToolResult types
├── router.ts           # ToolRouter — wires tools to LLM providers
├── sandbox.ts          # SandboxManager for isolated per-agent directories
├── index.ts            # ALL_TOOLS array + createToolRouter factory
├── your-tool.ts        # ← your new tool
└── CREATING_TOOLS.md   # this file
```

## The Tool Interface

Every tool file must `export default` an object (or array) matching this interface:

```typescript
import type { Tool, ToolResult, ToolContext } from "./types";

interface Tool {
  name: string;                    // snake_case — used in LLM tool_use calls
  description: string;             // Shown to the LLM to decide when to use the tool
  inputSchema: {                   // JSON Schema for input arguments
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  needsSandbox?: boolean;          // Default: true. Set false if tool doesn't need file isolation
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}
```

A single file can export multiple tools as an array:

```typescript
const tools: Tool[] = [mainTool, aliasTool];
export default tools;
```

The index uses `flatten()` to handle both single and array exports.

## ToolContext

Every tool receives a `ToolContext` when executed:

```typescript
interface ToolContext {
  sandbox: SandboxManager;                // Create/access isolated sandbox directories
  config: Record<string, unknown>;        // Runtime config passed from the agent
}
```

### Sandbox

- **`ctx.sandbox.ensureSandbox(sessionId)`** — returns the absolute path to an isolated directory for that agent session. Files created here are persisted across tool calls.

### Config

Runtime values injected by the agent's `ToolExecutor`. Available keys:

| Key | Type | Description |
|-----|------|-------------|
| `chatServerUrl` | `string` | Base URL of the chat server (e.g., `http://localhost:3000`) |
| `agentId` | `string` | The agent's `sender_id` |
| `agentName` | `string` | The agent's `display_name` |
| `agentChannel` | `string` | The agent's chat channel |
| `agentRole` | `string` | The agent's role |

Access with type assertions: `(ctx.config.chatServerUrl as string) ?? ""`.

## Returning Results

Use the two helpers from `types.ts`:

```typescript
import { formatResponse, formatError } from "./types";

// Success — pass any JSON-serializable data
return formatResponse({ success: true, data: "hello" });

// Error — pass a human-readable error message
return formatError("Something went wrong");
```

Both return a `ToolResult`:

```typescript
interface ToolResult {
  content: [{ type: "text"; text: string }];
  isError?: boolean;
}
```

## Minimal Example

```typescript
// tools/my-tool.ts
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const input = args.input as string | undefined;
  if (!input) return formatError("input is required");

  return formatResponse({ success: true, result: input.toUpperCase() });
}

const myTool: Tool = {
  name: "my_tool",
  description: "Converts input text to uppercase.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      input: { type: "string", description: "Text to convert" },
    },
    required: ["input"],
  },
  execute,
};

export default myTool;
```

## Chat-Posting Tool Example

Tools that post messages to the chat (images, audio, structured content):

```typescript
// tools/post-example.ts
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const chatServerUrl = ctx.config.chatServerUrl as string;
  const agentId = ctx.config.agentId as string;
  const agentName = ctx.config.agentName as string;
  const agentChannel = (ctx.config.agentChannel as string) || "general";

  if (!chatServerUrl) return formatError("chatServerUrl not configured");

  // Post a message to chat
  const res = await fetch(`${chatServerUrl}/api/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      senderType: "agent",
      senderId: agentId,
      displayName: agentName,
      content: "Hello from my tool!",
      contentFormat: "text",       // "text" | "image" | "audio" | "structured"
      channel: agentChannel,
    }),
  });

  const data = await res.json() as any;
  if (!data.ok) return formatError(`Post failed: ${data.errors?.join(", ")}`);
  return formatResponse({ posted: true, messageId: data.message?.id });
}
```

### Uploading files (images, audio)

```typescript
// Read file from sandbox, upload to chat server
const fileData = readFileSync(sandboxFilePath);
const b64 = Buffer.from(fileData).toString("base64");

const uploadRes = await fetch(`${chatServerUrl}/api/upload`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ data: b64, filename: "output.png", mimeType: "image/png" }),
});
const { url } = await uploadRes.json() as any;
// url is now "/uploads/1234-abcd.png" — use in a message
```

Supported upload MIME types:
- **Images:** `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`
- **Audio:** `audio/wav`, `audio/mpeg`, `audio/ogg`, `audio/webm`

## Sandboxed Example

Tools that create files or run commands should use the sandbox:

```typescript
async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const sessionId = args.sessionId as string | undefined;
  if (!sessionId) return formatError("sessionId is required");

  const sandboxPath = await ctx.sandbox.ensureSandbox(sessionId);
  const filePath = join(sandboxPath, "output.txt");
  await writeFile(filePath, "hello", "utf-8");

  return formatResponse({ success: true, path: filePath });
}
```

The `sessionId` is auto-injected by the `ToolExecutor` (set to the agent's `sender_id`) if not provided by the LLM.

## Registering Your Tool

Add your tool to `tools/index.ts`:

```typescript
import myTool from "./my-tool";

const ALL_TOOLS: Tool[] = [
  // ... existing tools ...
  ...flatten(myTool),       // flatten() handles both Tool and Tool[]
];
```

Then add the tool name to `team-maker/src/routes/tools.ts` → `AVAILABLE_TOOLS` array so team-maker can assign it to agents.

## Tool Allowlisting

Tools are allowlisted per agent in the TOML config:

```toml
[tools]
enabled = true
allowed = ["my_tool", "read_file"]    # empty = all tools
denied = ["bash_command"]             # explicit deny overrides
```

The `ToolExecutor` + `createToolRouter` handle filtering automatically.

## Important: Tools That Post to Chat

Tools like `post_image`, `post_voice_note`, and any tool that calls `POST /api/messages` have special considerations:

### Sandbox guard exemption

Posting tools often receive **absolute file paths** from other tools (e.g., TTS writes to `/tmp/tts-tool/output.wav`). The `ToolExecutor` sandbox guard blocks absolute paths by default. Read-only posting tools must be added to `PATH_EXEMPT_TOOLS` in `src/tools/executor.ts`:

```typescript
const PATH_EXEMPT_TOOLS = new Set(["post_voice_note", "post_image"]);
```

In the tool itself, handle both absolute and relative paths:

```typescript
const resolvedPath = filePath.startsWith("/")
  ? filePath
  : resolve(ctx.sandbox.baseDir, agentId, filePath);
```

### Tool loop context isolation

The tool execution loop uses a **local message array** separate from the shared context. This prevents a critical bug: when a tool posts a chat message, it echoes back via WebSocket and gets added to the shared context. If the tool loop read from the shared context, these echoes would create duplicate/misplaced messages that break Anthropic's strict alternating `user`/`assistant` role requirement.

**Rule:** Tools that post to chat should *not* also add anything to the LLM context. The tool result (returned via `formatResponse`) is the only feedback the LLM gets.

### Silent tools

Tools that read data or perform meta-operations (not direct conversation) should be added to the `silent_tools` default in `src/config/schema.ts` so they don't spam "Agent is using X" announcements in chat.

## Conventions

| Rule | Example |
|------|---------|
| File naming | `kebab-case.ts` → `my-tool.ts` |
| Tool name | `snake_case` → `my_tool` |
| Constants at top | Timeouts, limits, URLs in a `// ── Constants ──` block |
| External hosts | Define as named constants for future self-hosting |
| Input validation | Check all required args, return `formatError` early |
| Timeouts | Always enforce on external calls / subprocess execution |
| Output limits | Cap stdout/stderr capture (e.g., `MAX_OUTPUT = 10 * 1024 * 1024`) |
| No classes | Tools are plain objects. Define `execute` as standalone `async function` |
| Imports | Only `./types` for tool system types. Node/Bun stdlib for everything else |
| Security | Validate and sanitize inputs. Use allowlists for hosts/commands |
| Silent tools | Add to `silent_tools` in config schema if the tool shouldn't announce usage in chat |

## Available Tools Reference

Current tools registered in `index.ts`:

**Core:** `code_editor`, `file_create`, `http_request`, `bash_command`, `javascript_execute`, `python_runner`, `sqlite_query`, `read_file`, `project_scaffold`, `net_tools`, `git_host`, `calendar`

**Research:** `analyze_research`, `browser_request`, `context_research_browser`, `review_research`

**Communication:** `compose_email`, `read_email`, `persona_compose`

**Media:** `create_image`, `midi_mp3`, `tts`, `text_to_speech`, `speak`, `stt`, `voice_clone`, `edit_audio`, `audio_cleanup`, `create_drum`

**3D & Export:** `create_mesh`, `create_obj`, `pdf_export`, `docx_md`, `md_docx`

**Dev:** `tablemaker`, `tcp_connect`, `framework_exec`, `golang_exec`, `token_replace`

**Chat:** `post_image`, `post_voice_note`, `read_chat_logs`, `evaluate_chat`, `chat_moderation` (includes `chat_participation`, `mute_agent`, `unmute_agent`)
