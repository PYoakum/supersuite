import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const ACTIONS = ["create_project", "add_file", "list_templates"] as const;
type Action = (typeof ACTIONS)[number];

const TEMPLATES: Record<string, Record<string, string>> = {
  "node-hello": {
    "index.js": 'console.log("Hello from codebaux!");\n',
    "package.json": '{"name":"project","version":"1.0.0","main":"index.js"}\n',
  },
  "html-app": {
    "index.html": '<!DOCTYPE html>\n<html><head><title>App</title></head>\n<body>\n<h1>Hello</h1>\n<script src="app.js"></script>\n</body></html>\n',
    "app.js": 'document.querySelector("h1").textContent = "Hello from codebaux!";\n',
    "style.css": "body { font-family: sans-serif; margin: 2rem; }\n",
  },
  "python-script": {
    "main.py": 'print("Hello from codebaux!")\n',
    "requirements.txt": "",
  },
};

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const action = args.action as Action | undefined;
  if (!action || !ACTIONS.includes(action)) return formatError(`Unknown action. Available: ${ACTIONS.join(", ")}`);

  const agentId = (ctx.config.agentId as string) || "default";
  const sandboxBase = (ctx.sandbox as any)?.baseDir || "./sandbox";

  switch (action) {
    case "list_templates":
      return formatResponse({
        templates: Object.entries(TEMPLATES).map(([name, files]) => ({
          name,
          files: Object.keys(files),
        })),
      });

    case "create_project": {
      const name = args.name as string;
      const template = (args.template as string) || "node-hello";
      if (!name) return formatError("name is required");

      const tmpl = TEMPLATES[template];
      if (!tmpl) return formatError(`Unknown template: ${template}. Available: ${Object.keys(TEMPLATES).join(", ")}`);

      const projectDir = join(sandboxBase, agentId, "codebaux", name);
      mkdirSync(projectDir, { recursive: true });

      const created: string[] = [];
      for (const [filename, content] of Object.entries(tmpl)) {
        writeFileSync(join(projectDir, filename), content, "utf-8");
        created.push(filename);
      }

      return formatResponse({
        created: true,
        project: name,
        template,
        path: `sandbox/${agentId}/codebaux/${name}`,
        files: created,
      });
    }

    case "add_file": {
      const project = args.project as string;
      const filename = args.filename as string;
      const content = args.content as string;
      if (!project) return formatError("project name is required");
      if (!filename) return formatError("filename is required");
      if (content === undefined) return formatError("content is required");
      if (filename.includes("..")) return formatError("filename must not contain ..");

      const projectDir = join(sandboxBase, agentId, "codebaux", project);
      if (!existsSync(projectDir)) return formatError(`Project not found: ${project}. Use create_project first.`);

      const filePath = join(projectDir, filename);
      const dir = join(filePath, "..");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, content, "utf-8");

      return formatResponse({
        written: true,
        path: `sandbox/${agentId}/codebaux/${project}/${filename}`,
        size: content.length,
      });
    }
  }

  return formatError("Unhandled action");
}

const tool: Tool = {
  name: "codebaux_project",
  description:
    "Create project files for the codebaux browser VM sandbox. Generate from templates or add individual files. " +
    "Files are saved to the sandbox and can be copied to the codebaux workspace.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: [...ACTIONS], description: "Action to perform" },
      name: { type: "string", description: "Project name (for create_project)" },
      template: { type: "string", description: "Template: node-hello, html-app, python-script" },
      project: { type: "string", description: "Existing project name (for add_file)" },
      filename: { type: "string", description: "File path within the project (for add_file)" },
      content: { type: "string", description: "File content (for add_file)" },
    },
    required: ["action"],
  },
  execute,
};

export default tool;
