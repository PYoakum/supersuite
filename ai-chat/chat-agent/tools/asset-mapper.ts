import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

const REQUEST_TIMEOUT = 15_000;
const DEFAULT_URL = "http://localhost:3005";

const ACTIONS = [
  "list_locations", "get_location", "create_location", "update_location", "delete_location",
  "list_devices", "create_device", "update_device", "delete_device", "search",
] as const;
type Action = (typeof ACTIONS)[number];

async function req(baseUrl: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  const data = await res.json().catch(() => res.text());
  return { status: res.status, data };
}

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const integ = (ctx.config.integrations as any)?.asset_mapper || {};
  const baseUrl = integ.url || DEFAULT_URL;
  const action = args.action as Action | undefined;

  if (!action || !ACTIONS.includes(action)) return formatError(`Unknown action: ${action}. Available: ${ACTIONS.join(", ")}`);

  try {
    let r;
    switch (action) {
      case "list_locations": r = await req(baseUrl, "GET", "/api/locations"); break;
      case "get_location": r = await req(baseUrl, "GET", `/api/locations/${args.location_id}`); break;
      case "create_location": r = await req(baseUrl, "POST", "/api/locations", { name: args.name, description: args.description }); break;
      case "update_location": {
        const body: any = {};
        if (args.name !== undefined) body.name = args.name;
        if (args.description !== undefined) body.description = args.description;
        r = await req(baseUrl, "PATCH", `/api/locations/${args.location_id}`, body);
        break;
      }
      case "delete_location": r = await req(baseUrl, "DELETE", `/api/locations/${args.location_id}`); break;
      case "list_devices": r = await req(baseUrl, "GET", `/api/locations/${args.location_id}/devices`); break;
      case "create_device": {
        const body: any = { name: args.name, location_id: args.location_id };
        for (const k of ["category", "type", "status", "ip", "mac", "serial", "barcode"]) {
          if ((args as any)[k] !== undefined) body[k] = (args as any)[k];
        }
        r = await req(baseUrl, "POST", "/api/devices", body);
        break;
      }
      case "update_device": {
        const body: any = {};
        for (const k of ["name", "category", "type", "status", "ip", "mac", "serial", "barcode", "location_id"]) {
          if ((args as any)[k] !== undefined) body[k] = (args as any)[k];
        }
        r = await req(baseUrl, "PATCH", `/api/devices/${args.device_id}`, body);
        break;
      }
      case "delete_device": r = await req(baseUrl, "DELETE", `/api/devices/${args.device_id}`); break;
      case "search": r = await req(baseUrl, "GET", `/api/search?q=${encodeURIComponent(String(args.query || ""))}`); break;
    }
    return formatResponse(r!.data);
  } catch (err: any) {
    return formatError(err.message);
  }
}

const tool: Tool = {
  name: "asset_mapper",
  description: "Manage network assets (locations, devices, links). Search by name, IP, MAC, serial, or barcode.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: [...ACTIONS], description: "Action to perform" },
      location_id: { type: "string", description: "Location ID" },
      device_id: { type: "string", description: "Device ID" },
      name: { type: "string", description: "Name (location or device)" },
      description: { type: "string", description: "Description" },
      category: { type: "string", description: "Device category" },
      type: { type: "string", description: "Device type" },
      status: { type: "string", description: "Device status" },
      ip: { type: "string", description: "IP address" },
      mac: { type: "string", description: "MAC address" },
      serial: { type: "string", description: "Serial number" },
      barcode: { type: "string", description: "Barcode" },
      query: { type: "string", description: "Search query" },
    },
    required: ["action"],
  },
  execute,
};

export default tool;
