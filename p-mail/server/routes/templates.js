import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { json, error } from "../middleware.js";

const TEMPLATES_PATH = "data/templates.json";

async function loadTemplates() {
  try {
    const raw = await readFile(TEMPLATES_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveTemplates(templates) {
  if (!existsSync("data")) await mkdir("data", { recursive: true });
  await writeFile(TEMPLATES_PATH, JSON.stringify(templates, null, 2));
}

export function registerTemplateRoutes(router) {
  // List all templates
  router.get("/api/templates", async (req, ctx) => {
    const templates = await loadTemplates();
    return json(templates);
  });

  // Get single template
  router.get("/api/templates/:id", async (req, ctx) => {
    const templates = await loadTemplates();
    const tmpl = templates.find((t) => t.id === ctx.params.id);
    if (!tmpl) return error("Template not found", 404);
    return json(tmpl);
  });

  // Create template
  router.post("/api/templates", async (req, ctx) => {
    const { name, subject, to, cc, html } = await req.json();
    if (!name) return error("Template name is required", 400);

    const templates = await loadTemplates();
    const tmpl = {
      id: crypto.randomUUID(),
      name,
      subject: subject || "",
      to: to || "",
      cc: cc || "",
      html: html || "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    templates.push(tmpl);
    await saveTemplates(templates);
    return json(tmpl);
  });

  // Update template
  router.put("/api/templates/:id", async (req, ctx) => {
    const templates = await loadTemplates();
    const idx = templates.findIndex((t) => t.id === ctx.params.id);
    if (idx === -1) return error("Template not found", 404);

    const updates = await req.json();
    templates[idx] = {
      ...templates[idx],
      ...updates,
      id: templates[idx].id,
      createdAt: templates[idx].createdAt,
      updatedAt: new Date().toISOString(),
    };
    await saveTemplates(templates);
    return json(templates[idx]);
  });

  // Delete template
  router.delete("/api/templates/:id", async (req, ctx) => {
    const templates = await loadTemplates();
    const idx = templates.findIndex((t) => t.id === ctx.params.id);
    if (idx === -1) return error("Template not found", 404);

    templates.splice(idx, 1);
    await saveTemplates(templates);
    return json({ ok: true });
  });
}
