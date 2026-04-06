import { config } from "./config";
import { handleEvaluate } from "./routes/evaluate";
import { handleExport } from "./routes/export";
import { handleHealth } from "./routes/health";
import { handlePatchRoles, handleGetRoles, handleRenameRole, handleGeneratePMs } from "./routes/roles";
import { handleImport } from "./routes/import";
import { handleDispatch } from "./routes/dispatch";
import { handleLaunchAgent, handleStopAgent, handleListAgents, handleRecruitAgent, handleReportStats, handleGetStats } from "./routes/agents";
import { handleListConfigs, handleImportConfigs } from "./routes/agent-import";
import { handleListSkills, handleAssignSkills, handleGetSkillAssignments } from "./routes/skills";
import { handleListTools, handleAssignTools, handleGetToolAssignments } from "./routes/tools";
import { startTaskBridge } from "./task-bridge";
import { join } from "path";
import { existsSync } from "fs";

const STATIC_DIR = join(import.meta.dir, "..", "public");

function serveStatic(pathname: string): Response | null {
  const filePath = join(STATIC_DIR, pathname === "/" ? "index.html" : pathname);
  if (!existsSync(filePath)) return null;
  return new Response(Bun.file(filePath));
}

function corsHeaders(response: Response): Response {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

const server = Bun.serve({
  port: config.port,
  hostname: config.host,

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "OPTIONS") {
      return corsHeaders(new Response(null, { status: 204 }));
    }

    let response: Response;

    if (path === "/api/evaluate" && req.method === "POST") {
      response = await handleEvaluate(req);
    } else if (path === "/api/roles" && req.method === "GET") {
      response = await handleGetRoles(req);
    } else if (path === "/api/roles" && req.method === "PATCH") {
      response = await handlePatchRoles(req);
    } else if (path === "/api/roles/rename" && req.method === "POST") {
      response = await handleRenameRole(req);
    } else if (path === "/api/import" && req.method === "POST") {
      response = await handleImport(req);
    } else if (path === "/api/dispatch" && req.method === "POST") {
      response = await handleDispatch(req);
    } else if (path === "/api/agents" && req.method === "GET") {
      response = handleListAgents();
    } else if (path === "/api/agents/launch" && req.method === "POST") {
      response = await handleLaunchAgent(req);
    } else if (path === "/api/agents/stop" && req.method === "POST") {
      response = await handleStopAgent(req);
    } else if (path === "/api/agents/configs" && req.method === "GET") {
      response = handleListConfigs();
    } else if (path === "/api/agents/recruit" && req.method === "POST") {
      response = await handleRecruitAgent(req);
    } else if (path === "/api/agents/stats" && req.method === "POST") {
      response = await handleReportStats(req);
    } else if (path === "/api/agents/stats" && req.method === "GET") {
      response = handleGetStats();
    } else if (path === "/api/agents/import" && req.method === "POST") {
      response = await handleImportConfigs(req);
    } else if (path === "/api/skills" && req.method === "GET") {
      response = handleListSkills();
    } else if (path === "/api/skills/assign" && req.method === "POST") {
      response = await handleAssignSkills(req);
    } else if (path === "/api/skills/assignments" && req.method === "GET") {
      response = handleGetSkillAssignments();
    } else if (path === "/api/tools" && req.method === "GET") {
      response = handleListTools();
    } else if (path === "/api/tools/assign" && req.method === "POST") {
      response = await handleAssignTools(req);
    } else if (path === "/api/tools/assignments" && req.method === "GET") {
      response = handleGetToolAssignments();
    } else if (path === "/api/roles/generate-pms" && req.method === "POST") {
      response = await handleGeneratePMs(req);
    } else if (path === "/api/export" && req.method === "POST") {
      response = await handleExport(req);
    } else if (path === "/api/health" && req.method === "GET") {
      response = handleHealth();
    } else {
      const staticResponse = serveStatic(path);
      if (staticResponse) return staticResponse;
      response = new Response("Not Found", { status: 404 });
    }

    return corsHeaders(response);
  },
});

console.log(`[team-maker] Running at http://${server.hostname}:${server.port}`);
startTaskBridge();
