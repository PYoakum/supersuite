import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const ACTIONS = ["create_form", "add_field", "generate_submissions", "export_json", "export_csv"] as const;
type Action = (typeof ACTIONS)[number];

const FIELD_TYPES = [
  "short_text", "long_text", "email", "phone", "number",
  "dropdown", "radio", "checkbox", "multi_select",
  "date", "rating", "section", "consent",
] as const;

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function getFormPath(sandboxBase: string, agentId: string, formId: string): string {
  return join(sandboxBase, agentId, "forms", `${formId}.json`);
}

function loadForm(path: string): any {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const action = args.action as Action | undefined;
  if (!action || !ACTIONS.includes(action)) return formatError(`Unknown action. Available: ${ACTIONS.join(", ")}`);

  const agentId = (ctx.config.agentId as string) || "default";
  const sandboxBase = (ctx.sandbox as any)?.baseDir || "./sandbox";
  const formsDir = join(sandboxBase, agentId, "forms");
  mkdirSync(formsDir, { recursive: true });

  switch (action) {
    case "create_form": {
      const title = args.title as string;
      if (!title) return formatError("title is required");

      const id = genId();
      const now = new Date().toISOString();
      const form = {
        id,
        title,
        description: (args.description as string) || "",
        status: "draft",
        slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        fields: [],
        theme: {
          name: "Minimal Light", primary: "#1a1a2e", bg: "#ffffff",
          text: "#1a1a2e", accent: "#e2725b", font: "'DM Sans'",
          radius: "8px", spacing: "comfortable",
        },
        settings: { successMessage: "Thank you for your submission." },
        createdAt: now,
        updatedAt: now,
      };

      const path = getFormPath(sandboxBase, agentId, id);
      writeFileSync(path, JSON.stringify(form, null, 2), "utf-8");

      return formatResponse({
        created: true, id, title, path: `sandbox/${agentId}/forms/${id}.json`,
      });
    }

    case "add_field": {
      const formId = args.form_id as string;
      if (!formId) return formatError("form_id is required");

      const path = getFormPath(sandboxBase, agentId, formId);
      const form = loadForm(path);
      if (!form) return formatError(`Form not found: ${formId}`);

      const fieldType = args.field_type as string;
      if (!fieldType || !FIELD_TYPES.includes(fieldType as any)) {
        return formatError(`field_type must be one of: ${FIELD_TYPES.join(", ")}`);
      }

      const field = {
        id: genId(),
        type: fieldType,
        label: (args.label as string) || "Untitled",
        placeholder: (args.placeholder as string) || "",
        helpText: (args.help_text as string) || "",
        required: (args.required as boolean) ?? false,
        options: (args.options as string[]) || [],
        validation: {},
        order: form.fields.length,
      };

      form.fields.push(field);
      form.updatedAt = new Date().toISOString();
      writeFileSync(path, JSON.stringify(form, null, 2), "utf-8");

      return formatResponse({ added: true, field_id: field.id, form_id: formId, total_fields: form.fields.length });
    }

    case "generate_submissions": {
      const formId = args.form_id as string;
      const count = (args.count as number) || 5;
      if (!formId) return formatError("form_id is required");

      const path = getFormPath(sandboxBase, agentId, formId);
      const form = loadForm(path);
      if (!form) return formatError(`Form not found: ${formId}`);

      const submissions = [];
      for (let i = 0; i < count; i++) {
        const answers: Record<string, any> = {};
        for (const f of form.fields) {
          if (f.type === "section") { answers[f.id] = null; continue; }
          if (f.type === "short_text" || f.type === "long_text") answers[f.id] = `Sample answer ${i + 1}`;
          else if (f.type === "email") answers[f.id] = `user${i + 1}@example.com`;
          else if (f.type === "phone") answers[f.id] = `555-000-${String(i + 1).padStart(4, "0")}`;
          else if (f.type === "number") answers[f.id] = Math.floor(Math.random() * 100);
          else if (f.type === "rating") answers[f.id] = Math.floor(Math.random() * 5) + 1;
          else if (f.type === "checkbox" || f.type === "consent") answers[f.id] = Math.random() > 0.3;
          else if (f.type === "date") answers[f.id] = new Date(Date.now() - Math.random() * 30 * 86400000).toISOString().slice(0, 10);
          else if (f.type === "dropdown" || f.type === "radio") answers[f.id] = f.options?.[Math.floor(Math.random() * f.options.length)] || "";
          else if (f.type === "multi_select") {
            const picks = (f.options || []).filter(() => Math.random() > 0.5);
            answers[f.id] = picks.length > 0 ? picks : [f.options?.[0] || ""];
          }
        }
        submissions.push({
          id: genId(), formId, answers, status: "new", categories: [],
          submittedAt: new Date(Date.now() - Math.random() * 7 * 86400000).toISOString(),
        });
      }

      const subsPath = join(formsDir, `${formId}-submissions.json`);
      writeFileSync(subsPath, JSON.stringify(submissions, null, 2), "utf-8");

      return formatResponse({ generated: count, path: `sandbox/${agentId}/forms/${formId}-submissions.json` });
    }

    case "export_json": {
      const formId = args.form_id as string;
      if (!formId) return formatError("form_id is required");
      const path = getFormPath(sandboxBase, agentId, formId);
      const form = loadForm(path);
      if (!form) return formatError(`Form not found: ${formId}`);

      // Bundle form + submissions for import
      const subsPath = join(formsDir, `${formId}-submissions.json`);
      const submissions = existsSync(subsPath) ? JSON.parse(readFileSync(subsPath, "utf-8")) : [];

      const bundle = { forms: [form], submissions };
      const bundlePath = join(formsDir, `${formId}-bundle.json`);
      writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), "utf-8");

      return formatResponse({ exported: true, path: `sandbox/${agentId}/forms/${formId}-bundle.json` });
    }

    case "export_csv": {
      const formId = args.form_id as string;
      if (!formId) return formatError("form_id is required");
      const path = getFormPath(sandboxBase, agentId, formId);
      const form = loadForm(path);
      if (!form) return formatError(`Form not found: ${formId}`);

      const subsPath = join(formsDir, `${formId}-submissions.json`);
      if (!existsSync(subsPath)) return formatError("No submissions found. Use generate_submissions first.");
      const submissions = JSON.parse(readFileSync(subsPath, "utf-8"));

      const headers = ["Submitted At", "Status", ...form.fields.filter((f: any) => f.type !== "section").map((f: any) => f.label)];
      const rows = submissions.map((s: any) => {
        const vals = [s.submittedAt, s.status];
        for (const f of form.fields) {
          if (f.type === "section") continue;
          const v = s.answers[f.id];
          vals.push(Array.isArray(v) ? v.join(";") : String(v ?? ""));
        }
        return vals.map((v: string) => `"${String(v).replace(/"/g, '""')}"`).join(",");
      });

      const csv = [headers.map((h: string) => `"${h}"`).join(","), ...rows].join("\n");
      const csvPath = join(formsDir, `${formId}.csv`);
      writeFileSync(csvPath, csv, "utf-8");

      return formatResponse({ exported: true, rows: submissions.length, path: `sandbox/${agentId}/forms/${formId}.csv` });
    }
  }

  return formatError("Unhandled action");
}

const tool: Tool = {
  name: "forms_builder",
  description:
    "Create forms compatible with the js-forms app. Build form definitions with typed fields, " +
    "generate sample submissions, and export as JSON or CSV.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: [...ACTIONS], description: "Action to perform" },
      form_id: { type: "string", description: "Form ID (from create_form)" },
      title: { type: "string", description: "Form title (create_form)" },
      description: { type: "string", description: "Form description" },
      field_type: { type: "string", enum: [...FIELD_TYPES], description: "Field type (add_field)" },
      label: { type: "string", description: "Field label" },
      placeholder: { type: "string" },
      help_text: { type: "string" },
      required: { type: "boolean" },
      options: { type: "array", items: { type: "string" }, description: "Options for dropdown/radio/multi_select" },
      count: { type: "number", description: "Number of submissions to generate (default 5)" },
    },
    required: ["action"],
  },
  execute,
};

export default tool;
