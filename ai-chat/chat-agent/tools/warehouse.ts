import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

const REQUEST_TIMEOUT = 15_000;
const DEFAULT_URL = "http://localhost:3006";

const ACTIONS = [
  "login", "list_items", "get_item", "create_item", "update_item", "delete_item",
  "search", "check_in", "check_out", "list_warehouses", "create_warehouse",
  "list_transactions", "dashboard", "scan_barcode",
] as const;
type Action = (typeof ACTIONS)[number];

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function whReq(baseUrl: string, token: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(`${baseUrl}/api${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  const data = await res.json().catch(() => res.text());
  return { status: res.status, data };
}

async function ensureToken(baseUrl: string, email: string, password: string): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 30_000) return cachedToken.accessToken;
  const r = await whReq(baseUrl, null, "POST", "/auth/login", { email, password });
  if (r.status !== 200) throw new Error(`Login failed: ${r.status}`);
  const d = r.data as any;
  cachedToken = { accessToken: d.token || d.accessToken, expiresAt: Date.now() + 14 * 60_000 };
  return cachedToken.accessToken;
}

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const integ = (ctx.config.integrations as any)?.warehouse || {};
  const baseUrl = integ.url || DEFAULT_URL;
  const action = args.action as Action | undefined;
  if (!action || !ACTIONS.includes(action)) return formatError(`Unknown action: ${action}. Available: ${ACTIONS.join(", ")}`);

  const email = (args.email as string) || integ.email || "";
  const pwdEnv = integ.password_env || "WAREHOUSE_PASSWORD";
  const password = (args.password as string) || process.env[pwdEnv] || "";

  try {
    if (action === "login") {
      if (!email || !password) return formatError("email and password required");
      await ensureToken(baseUrl, email, password);
      return formatResponse({ success: true });
    }

    const token = await ensureToken(baseUrl, email, password);
    let r;

    switch (action) {
      case "list_items": {
        const p = new URLSearchParams();
        if (args.query) p.set("search", String(args.query));
        if (args.status) p.set("status", String(args.status));
        if (args.warehouse_id) p.set("warehouse_id", String(args.warehouse_id));
        p.set("limit", String(args.limit || 50));
        r = await whReq(baseUrl, token, "GET", `/items?${p}`);
        break;
      }
      case "get_item": r = await whReq(baseUrl, token, "GET", `/items/${args.item_id}`); break;
      case "create_item": {
        const body: any = { name: args.name };
        for (const k of ["sku", "description", "category", "condition", "warehouse_id", "location_id"]) {
          if ((args as any)[k] !== undefined) body[k] = (args as any)[k];
        }
        r = await whReq(baseUrl, token, "POST", "/items", body);
        break;
      }
      case "update_item": {
        const body: any = {};
        for (const k of ["name", "sku", "description", "category", "condition", "status", "warehouse_id", "location_id"]) {
          if ((args as any)[k] !== undefined) body[k] = (args as any)[k];
        }
        r = await whReq(baseUrl, token, "PATCH", `/items/${args.item_id}`, body);
        break;
      }
      case "delete_item": r = await whReq(baseUrl, token, "DELETE", `/items/${args.item_id}`); break;
      case "search": r = await whReq(baseUrl, token, "GET", `/search?q=${encodeURIComponent(String(args.query || ""))}`); break;
      case "check_in":
        r = await whReq(baseUrl, token, "POST", "/inventory/transactions", { item_id: args.item_id, type: "check_in", quantity: args.quantity || 1, notes: args.notes });
        break;
      case "check_out":
        r = await whReq(baseUrl, token, "POST", "/inventory/transactions", { item_id: args.item_id, type: "check_out", quantity: args.quantity || 1, notes: args.notes });
        break;
      case "list_warehouses": r = await whReq(baseUrl, token, "GET", "/warehouses"); break;
      case "create_warehouse": r = await whReq(baseUrl, token, "POST", "/warehouses", { name: args.name, address: args.address, organization_id: args.organization_id }); break;
      case "list_transactions": {
        const p = new URLSearchParams();
        if (args.item_id) p.set("item_id", String(args.item_id));
        if (args.type) p.set("type", String(args.type));
        p.set("limit", String(args.limit || 50));
        r = await whReq(baseUrl, token, "GET", `/inventory/transactions?${p}`);
        break;
      }
      case "dashboard": r = await whReq(baseUrl, token, "GET", "/inventory/dashboard"); break;
      case "scan_barcode": r = await whReq(baseUrl, token, "GET", `/barcodes/${encodeURIComponent(String(args.barcode))}`); break;
    }
    return formatResponse(r!.data);
  } catch (err: any) {
    return formatError(err.message);
  }
}

const tool: Tool = {
  name: "warehouse",
  description: "Manage warehouse inventory. CRUD items, check in/out, scan barcodes, view transactions and dashboard.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: [...ACTIONS], description: "Action to perform" },
      item_id: { type: "string" }, warehouse_id: { type: "string" }, location_id: { type: "string" },
      organization_id: { type: "string" }, name: { type: "string" }, sku: { type: "string" },
      description: { type: "string" }, category: { type: "string" }, condition: { type: "string" },
      status: { type: "string" }, quantity: { type: "number" }, notes: { type: "string" },
      address: { type: "string" }, barcode: { type: "string" }, query: { type: "string" },
      type: { type: "string" }, email: { type: "string" }, password: { type: "string" },
      limit: { type: "number" },
    },
    required: ["action"],
  },
  execute,
};

export default tool;
