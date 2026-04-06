/**
 * Project CRUD routes
 */

import * as projects from "../../lib/projects.js";

export function registerProjectRoutes(router) {
  // Create project
  router.post("/api/projects", async (ctx) => {
    const body = await ctx.req.json();
    const project = await projects.createProject(body.name);
    return json(project);
  });

  // List projects
  router.get("/api/projects", async () => {
    const list = await projects.listProjects();
    return json(list);
  });

  // Get project
  router.get("/api/projects/:id", async (ctx) => {
    const project = await projects.getProject(ctx.params.id);
    if (!project) return json({ error: "Project not found" }, 404);
    return json(project);
  });

  // Update project
  router.put("/api/projects/:id", async (ctx) => {
    const body = await ctx.req.json();
    const project = await projects.updateProject(ctx.params.id, body);
    if (!project) return json({ error: "Project not found" }, 404);
    return json(project);
  });

  // Delete project
  router.delete("/api/projects/:id", async (ctx) => {
    const deleted = await projects.deleteProject(ctx.params.id);
    if (!deleted) return json({ error: "Project not found" }, 404);
    return json({ ok: true });
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
