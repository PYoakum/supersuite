import { config } from "./config";
import { storageService } from "./services/storage-service";
import { wsService, type WSData } from "./services/websocket-service";
import { chatService } from "./services/chat-service";
import { validateCreateMessage } from "./utils/validate";
import { handlePostMessage, handleGetMessages } from "./routes/messages";
import { handleSearch } from "./routes/search";
import { handleHealth, handleStats } from "./routes/health";
import { handleUpload } from "./routes/upload";
import { join } from "path";
import { existsSync } from "fs";

// Initialize storage (replay log)
storageService.init();

const STATIC_DIR = join(import.meta.dir, "..", "public");
const SANDBOX_DIR = join(import.meta.dir, "..", "chat-agent", "sandbox");

function serveStatic(pathname: string): Response | null {
  let filePath = join(STATIC_DIR, pathname === "/" ? "index.html" : pathname);
  if (!existsSync(filePath)) return null;

  const file = Bun.file(filePath);
  return new Response(file);
}

function serveSandbox(pathname: string): Response | null {
  // /sandbox/agent-id/path/to/file → chat-agent/sandbox/agent-id/path/to/file
  const relative = pathname.slice("/sandbox/".length);
  if (!relative || relative.includes("..")) return null;

  const filePath = join(SANDBOX_DIR, relative);
  if (!existsSync(filePath)) return null;

  const file = Bun.file(filePath);
  const headers: Record<string, string> = {};
  const ext = filePath.split(".").pop()?.toLowerCase() || "";

  // Force code/script files to text/plain to prevent execution
  const forceTextPlain = new Set([
    "js", "ts", "jsx", "tsx", "mjs", "cjs",
    "html", "htm", "xhtml", "xml", "svg",
    "sh", "bash", "zsh", "bat", "cmd", "ps1",
    "py", "rb", "php", "pl", "lua",
    "css", "scss", "less",
    "json", "toml", "yaml", "yml",
    "md", "txt", "csv", "log",
    "sql", "graphql",
  ]);

  // Safe binary types served with their native MIME
  const safeBinary = new Set(["png", "jpg", "jpeg", "gif", "webp", "wav", "mp3", "ogg", "webm", "pdf", "woff", "woff2"]);

  if (forceTextPlain.has(ext)) {
    headers["Content-Type"] = "text/plain; charset=utf-8";
  } else if (!safeBinary.has(ext)) {
    // Unknown type — force download
    headers["Content-Type"] = "application/octet-stream";
    headers["Content-Disposition"] = `attachment; filename="${relative.split("/").pop()}"`;
  }

  // Prevent sniffing
  headers["X-Content-Type-Options"] = "nosniff";

  return new Response(file, { headers });
}

function corsHeaders(response: Response): Response {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

const server = Bun.serve<WSData>({
  port: config.port,
  hostname: config.host,

  async fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS preflight
    if (req.method === "OPTIONS") {
      return corsHeaders(new Response(null, { status: 204 }));
    }

    // WebSocket upgrade
    if (path === "/ws") {
      const upgraded = server.upgrade(req, {
        data: { id: crypto.randomUUID(), connectedAt: Date.now() },
      });
      if (upgraded) return undefined as unknown as Response;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // API routes
    let response: Response;

    if (path === "/api/messages" && req.method === "POST") {
      response = await handlePostMessage(req);
    } else if (path === "/api/messages" && req.method === "GET") {
      response = handleGetMessages(req);
    } else if (path === "/api/messages" && req.method === "DELETE") {
      chatService.clearHistory();
      response = Response.json({ ok: true });
    } else if (path === "/api/search" && req.method === "GET") {
      response = handleSearch(req);
    } else if (path === "/api/health" && req.method === "GET") {
      response = handleHealth();
    } else if (path === "/api/stats" && req.method === "GET") {
      response = handleStats();
    } else if (path === "/api/upload" && req.method === "POST") {
      response = await handleUpload(req);
    } else if (path.startsWith("/sandbox/")) {
      const sandboxResponse = serveSandbox(path);
      if (sandboxResponse) return corsHeaders(sandboxResponse);
      response = new Response("Not Found", { status: 404 });
    } else {
      // Static files
      const staticResponse = serveStatic(path);
      if (staticResponse) return staticResponse;
      response = new Response("Not Found", { status: 404 });
    }

    return corsHeaders(response);
  },

  websocket: {
    idleTimeout: 960,           // 16 minutes (max Bun allows)
    sendPings: true,            // auto-ping to keep connections alive

    open(ws) {
      wsService.addClient(ws);
      ws.send(JSON.stringify({
        type: "connection:status",
        payload: { status: "connected", clientId: ws.data.id },
      }));
    },

    close(ws) {
      wsService.removeClient(ws);
    },

    message(ws, rawMsg) {
      try {
        const envelope = JSON.parse(String(rawMsg));

        if (envelope.type === "chat:clear") {
          chatService.clearHistory();
        } else if (envelope.type === "message:create" && envelope.payload) {
          const validation = validateCreateMessage(envelope.payload);
          if (!validation.valid) {
            ws.send(JSON.stringify({
              type: "error",
              payload: { errors: validation.errors },
            }));
            return;
          }
          const result = chatService.createMessage(envelope.payload);
          // Acknowledge to sender if there are persona warnings
          if (result.personaWarnings.length > 0) {
            ws.send(JSON.stringify({
              type: "persona:warning",
              payload: { messageId: result.message.id, warnings: result.personaWarnings },
            }));
          }
        } else {
          ws.send(JSON.stringify({
            type: "error",
            payload: { errors: [`Unknown message type: ${envelope.type}`] },
          }));
        }
      } catch {
        ws.send(JSON.stringify({
          type: "error",
          payload: { errors: ["Invalid JSON"] },
        }));
      }
    },
  },
});

console.log(`[server] Chat server running at http://${server.hostname}:${server.port}`);
