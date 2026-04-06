import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";
import { readFileSync, existsSync } from "fs";
import { basename } from "path";

const REQUEST_TIMEOUT = 15_000;
const UPLOAD_TIMEOUT = 60_000;
const DEFAULT_URL = "http://localhost:3008";

const ACTIONS = [
  "list_files", "upload_file", "delete_file",
  "list_projects", "get_project", "create_project", "update_project",
  "start_render", "get_render_status",
] as const;
type Action = (typeof ACTIONS)[number];

async function req(baseUrl: string, method: string, path: string, body?: unknown, timeout = REQUEST_TIMEOUT) {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${baseUrl}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const data = await res.json().catch(() => res.text());
  return { status: res.status, data };
}

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const integ = (ctx.config.integrations as any)?.vidiyo || {};
  const baseUrl = integ.url || DEFAULT_URL;
  const action = args.action as Action | undefined;
  if (!action || !ACTIONS.includes(action)) return formatError(`Unknown action: ${action}. Available: ${ACTIONS.join(", ")}`);

  try {
    let r;
    switch (action) {
      case "list_files": r = await req(baseUrl, "GET", "/api/files"); break;
      case "upload_file": {
        const filePath = args.file_path as string;
        if (!filePath) return formatError("file_path is required");
        if (!existsSync(filePath)) return formatError(`File not found: ${filePath}`);
        const fileData = readFileSync(filePath);
        const formData = new FormData();
        formData.append("file", new Blob([fileData]), basename(filePath));
        const res = await fetch(`${baseUrl}/api/files/upload`, {
          method: "POST", body: formData, signal: AbortSignal.timeout(UPLOAD_TIMEOUT),
        });
        r = { status: res.status, data: await res.json().catch(() => res.text()) };
        break;
      }
      case "delete_file": r = await req(baseUrl, "DELETE", `/api/files/${args.file_id}`); break;
      case "list_projects": r = await req(baseUrl, "GET", "/api/projects"); break;
      case "get_project": r = await req(baseUrl, "GET", `/api/projects/${args.project_id}`); break;
      case "create_project": r = await req(baseUrl, "POST", "/api/projects", { name: args.name, timeline: args.timeline }); break;
      case "update_project": {
        const body: any = {};
        if (args.name !== undefined) body.name = args.name;
        if (args.timeline !== undefined) body.timeline = args.timeline;
        r = await req(baseUrl, "PUT", `/api/projects/${args.project_id}`, body);
        break;
      }
      case "start_render":
        r = await req(baseUrl, "POST", "/api/render", { project_id: args.project_id, format: args.format, resolution: args.resolution }, 30_000);
        break;
      case "get_render_status": r = await req(baseUrl, "GET", `/api/render/${args.job_id}`); break;
    }
    return formatResponse(r!.data);
  } catch (err: any) {
    return formatError(err.message);
  }
}

const tool: Tool = {
  name: "vidiyo",
  description: "Video editor. Upload files, manage projects, start renders, and check render status.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: [...ACTIONS], description: "Action to perform" },
      file_id: { type: "string" }, file_path: { type: "string", description: "Local file path to upload" },
      project_id: { type: "string" }, job_id: { type: "string" },
      name: { type: "string" }, timeline: { type: "object", description: "Project timeline data" },
      format: { type: "string", description: "Output format (mp4, webm)" },
      resolution: { type: "string", description: "Output resolution (1080p, 720p)" },
    },
    required: ["action"],
  },
  execute,
};

export default tool;
