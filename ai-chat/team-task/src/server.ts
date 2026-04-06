import { join } from "path";
import { config } from "./config";
import { storageService } from "./services/storage-service";
import { wsService, type WSData } from "./services/websocket-service";
import { taskService } from "./services/task-service";
import { handleCreateTask, handleGetTasks, handleGetTask, handleUpdateTask, handleDeleteTask, handleExportTasks, handleClearTasks, handleNotifyTask } from "./routes/tasks";
import { handleImport } from "./routes/import";
import { handleHealth, handleStats } from "./routes/health";
import { validateCreate, validateUpdate } from "./utils/validate";

const publicDir = join(import.meta.dir, "..", "public");

function cors(res: Response): Response {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

function extractTaskId(pathname: string): string {
  const parts = pathname.split("/");
  return parts[3] || "";
}

await storageService.init();

const server = Bun.serve<WSData>({
  port: config.port,
  hostname: config.host,

  async fetch(req, server) {
    const url = new URL(req.url);
    const { pathname } = url;

    if (req.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }

    if (pathname === "/ws") {
      const clientId = crypto.randomUUID();
      const upgraded = server.upgrade(req, { data: { clientId } });
      if (!upgraded) return new Response("WebSocket upgrade failed", { status: 400 });
      return undefined as any;
    }

    let res: Response;

    // API routes
    if (pathname === "/api/tasks" && req.method === "POST") {
      res = await handleCreateTask(req);
    } else if (pathname === "/api/tasks" && req.method === "GET") {
      res = handleGetTasks(req);
    } else if (pathname === "/api/tasks" && req.method === "DELETE") {
      res = handleClearTasks();
    } else if (pathname === "/api/export" && req.method === "GET") {
      res = handleExportTasks();
    } else if (pathname === "/api/import" && req.method === "POST") {
      res = await handleImport(req);
    } else if (pathname === "/api/health" && req.method === "GET") {
      res = handleHealth();
    } else if (pathname === "/api/stats" && req.method === "GET") {
      res = handleStats();
    } else if (pathname.match(/^\/api\/tasks\/[^/]+$/) && req.method === "GET") {
      res = handleGetTask(extractTaskId(pathname));
    } else if (pathname.match(/^\/api\/tasks\/[^/]+$/) && req.method === "PUT") {
      res = await handleUpdateTask(extractTaskId(pathname), req);
    } else if (pathname.match(/^\/api\/tasks\/[^/]+$/) && req.method === "DELETE") {
      res = handleDeleteTask(extractTaskId(pathname));
    } else if (pathname.match(/^\/api\/notify\/[^/]+$/) && req.method === "POST") {
      const id = pathname.split("/")[3];
      res = await handleNotifyTask(id);
    } else {
      // Static files
      let filePath = pathname === "/" ? "/index.html" : pathname;
      const file = Bun.file(join(publicDir, filePath));
      if (await file.exists()) {
        return new Response(file);
      }
      res = Response.json({ ok: false, errors: ["Not found"] }, { status: 404 });
    }

    return cors(res);
  },

  websocket: {
    open(ws) {
      wsService.add(ws);
      ws.send(JSON.stringify({ type: "connection:status", payload: { status: "connected", clientId: ws.data.clientId } }));
    },
    close(ws) {
      wsService.remove(ws);
    },
    message(ws, raw) {
      try {
        const msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
        if (msg.type === "task:create" && msg.payload) {
          const { errors, payload } = validateCreate(msg.payload);
          if (errors.length > 0) {
            wsService.sendTo(ws.data.clientId, "error", { errors });
          } else {
            taskService.create(payload!);
          }
        } else if (msg.type === "task:update" && msg.payload?.id) {
          const { errors, payload } = validateUpdate(msg.payload);
          if (errors.length > 0) {
            wsService.sendTo(ws.data.clientId, "error", { errors });
          } else {
            const task = taskService.update(msg.payload.id, payload!);
            if (!task) wsService.sendTo(ws.data.clientId, "error", { errors: ["Task not found"] });
          }
        } else if (msg.type === "task:delete" && msg.payload?.id) {
          const deleted = taskService.delete(msg.payload.id);
          if (!deleted) wsService.sendTo(ws.data.clientId, "error", { errors: ["Task not found"] });
        }
      } catch {
        wsService.sendTo(ws.data.clientId, "error", { errors: ["Invalid message format"] });
      }
    },
  },
});

console.log(`team-task running on http://${config.host}:${config.port}`);
