import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Constants ──────────────────────────────────────────────

const REQUEST_TIMEOUT = 15_000;
const DEFAULT_CALENDAR_URL = "http://localhost:3100";

const ACTIONS = [
  "login",
  "list_calendars",
  "create_calendar",
  "list_events",
  "get_event",
  "create_event",
  "update_event",
  "delete_event",
  "list_reminders",
  "create_reminder",
  "dismiss_reminder",
] as const;

type Action = (typeof ACTIONS)[number];

// ── Token Cache ────────────────────────────────────────────

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

// ── Helpers ────────────────────────────────────────────────

async function calRequest(
  baseUrl: string,
  token: string | null,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api${path}`;

  const headers: Record<string, string> = {
    "Accept": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const init: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  };

  if (body && !["GET", "HEAD"].includes(method)) {
    init.body = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }

  const resp = await fetch(url, init);
  const text = await resp.text();

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return { status: resp.status, data };
}

async function ensureToken(
  baseUrl: string,
  email: string,
  password: string
): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const result = await calRequest(baseUrl, null, "POST", "/auth/login", { email, password });
  if (result.status !== 200) {
    throw new Error(`Calendar auth failed (${result.status}): ${JSON.stringify(result.data)}`);
  }

  const body = result.data as { accessToken: string; expiresIn: number };
  cachedToken = {
    accessToken: body.accessToken,
    expiresAt: Date.now() + body.expiresIn * 1000,
  };
  return cachedToken.accessToken;
}

// ── Actions ────────────────────────────────────────────────

async function actionLogin(baseUrl: string, args: Record<string, unknown>): Promise<ToolResult> {
  const email = args.email as string;
  const password = args.password as string;
  if (!email || !password) return formatError("email and password are required");

  const token = await ensureToken(baseUrl, email, password);
  return formatResponse({ success: true, message: "Authenticated successfully", tokenCached: true });
}

async function actionListCalendars(baseUrl: string, token: string): Promise<ToolResult> {
  const result = await calRequest(baseUrl, token, "GET", "/calendars");
  if (result.status !== 200) return formatError(`Failed to list calendars (${result.status}): ${JSON.stringify(result.data)}`);
  return formatResponse({ action: "list_calendars", calendars: result.data });
}

async function actionCreateCalendar(baseUrl: string, token: string, args: Record<string, unknown>): Promise<ToolResult> {
  const name = args.name as string;
  if (!name) return formatError("name is required");
  const body: Record<string, unknown> = { name };
  if (args.color) body.color = args.color;

  const result = await calRequest(baseUrl, token, "POST", "/calendars", body);
  if (result.status !== 201) return formatError(`Failed to create calendar (${result.status}): ${JSON.stringify(result.data)}`);
  return formatResponse({ action: "create_calendar", calendar: result.data });
}

async function actionListEvents(baseUrl: string, token: string, args: Record<string, unknown>): Promise<ToolResult> {
  const params = new URLSearchParams();
  if (args.start) params.set("start", args.start as string);
  if (args.end) params.set("end", args.end as string);
  if (args.calendarId) params.set("calendarId", args.calendarId as string);
  const qs = params.toString();
  const path = `/events${qs ? `?${qs}` : ""}`;

  const result = await calRequest(baseUrl, token, "GET", path);
  if (result.status !== 200) return formatError(`Failed to list events (${result.status}): ${JSON.stringify(result.data)}`);
  return formatResponse({ action: "list_events", events: result.data });
}

async function actionGetEvent(baseUrl: string, token: string, args: Record<string, unknown>): Promise<ToolResult> {
  const id = args.eventId as string;
  if (!id) return formatError("eventId is required");

  const result = await calRequest(baseUrl, token, "GET", `/events/${id}`);
  if (result.status !== 200) return formatError(`Failed to get event (${result.status}): ${JSON.stringify(result.data)}`);
  return formatResponse({ action: "get_event", event: result.data });
}

async function actionCreateEvent(baseUrl: string, token: string, args: Record<string, unknown>): Promise<ToolResult> {
  const calendarId = args.calendarId as string;
  const title = args.title as string;
  const startAt = args.startAt as string;
  const endAt = args.endAt as string;

  if (!calendarId) return formatError("calendarId is required");
  if (!title) return formatError("title is required");
  if (!startAt) return formatError("startAt is required (ISO 8601)");
  if (!endAt) return formatError("endAt is required (ISO 8601)");

  const body: Record<string, unknown> = {
    calendarId,
    title,
    startAt,
    endAt,
  };

  if (args.description) body.description = args.description;
  if (args.location) body.location = args.location;
  if (args.allDay !== undefined) body.allDay = args.allDay;
  if (args.timezone) body.timezone = args.timezone;
  if (args.recurrenceRule) body.recurrenceRule = args.recurrenceRule;
  if (args.reminders) body.reminders = args.reminders;

  const result = await calRequest(baseUrl, token, "POST", "/events", body);
  if (result.status !== 201) return formatError(`Failed to create event (${result.status}): ${JSON.stringify(result.data)}`);
  return formatResponse({ action: "create_event", event: result.data });
}

async function actionUpdateEvent(baseUrl: string, token: string, args: Record<string, unknown>): Promise<ToolResult> {
  const id = args.eventId as string;
  if (!id) return formatError("eventId is required");

  const body: Record<string, unknown> = {};
  for (const key of ["title", "description", "location", "startAt", "endAt", "allDay", "timezone", "recurrenceRule"]) {
    if (args[key] !== undefined) body[key] = args[key];
  }

  if (Object.keys(body).length === 0) return formatError("At least one field to update is required");

  const result = await calRequest(baseUrl, token, "PATCH", `/events/${id}`, body);
  if (result.status !== 200) return formatError(`Failed to update event (${result.status}): ${JSON.stringify(result.data)}`);
  return formatResponse({ action: "update_event", event: result.data });
}

async function actionDeleteEvent(baseUrl: string, token: string, args: Record<string, unknown>): Promise<ToolResult> {
  const id = args.eventId as string;
  if (!id) return formatError("eventId is required");

  const result = await calRequest(baseUrl, token, "DELETE", `/events/${id}`);
  if (result.status !== 200 && result.status !== 204) {
    return formatError(`Failed to delete event (${result.status}): ${JSON.stringify(result.data)}`);
  }
  return formatResponse({ action: "delete_event", eventId: id, deleted: true });
}

async function actionListReminders(baseUrl: string, token: string, args: Record<string, unknown>): Promise<ToolResult> {
  const eventId = args.eventId as string;
  const path = eventId ? `/reminders/event/${eventId}` : "/reminders/pending";

  const result = await calRequest(baseUrl, token, "GET", path);
  if (result.status !== 200) return formatError(`Failed to list reminders (${result.status}): ${JSON.stringify(result.data)}`);
  return formatResponse({ action: "list_reminders", reminders: result.data });
}

async function actionCreateReminder(baseUrl: string, token: string, args: Record<string, unknown>): Promise<ToolResult> {
  const eventId = args.eventId as string;
  const offsetMinutes = args.offsetMinutes as number;
  if (!eventId) return formatError("eventId is required");
  if (offsetMinutes === undefined) return formatError("offsetMinutes is required");

  const result = await calRequest(baseUrl, token, "POST", "/reminders", { eventId, offsetMinutes });
  if (result.status !== 201 && result.status !== 200) {
    return formatError(`Failed to create reminder (${result.status}): ${JSON.stringify(result.data)}`);
  }
  return formatResponse({ action: "create_reminder", reminder: result.data });
}

async function actionDismissReminder(baseUrl: string, token: string, args: Record<string, unknown>): Promise<ToolResult> {
  const reminderId = args.reminderId as string;
  if (!reminderId) return formatError("reminderId is required");

  const result = await calRequest(baseUrl, token, "POST", `/reminders/${reminderId}/dismiss`);
  if (result.status !== 200) return formatError(`Failed to dismiss reminder (${result.status}): ${JSON.stringify(result.data)}`);
  return formatResponse({ action: "dismiss_reminder", reminderId, dismissed: true });
}

// ── Execute Dispatcher ─────────────────────────────────────

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const action = args.action as Action | undefined;
  if (!action) return formatError(`action is required. Available: ${ACTIONS.join(", ")}`);
  if (!ACTIONS.includes(action)) return formatError(`Unknown action: ${action}. Available: ${ACTIONS.join(", ")}`);

  const integ = (ctx.config.integrations as any)?.calendar || {};
  const baseUrl = (ctx.config.calendarUrl as string) || integ.url || DEFAULT_CALENDAR_URL;
  const emailEnv = integ.email || "";
  const pwdEnvName = integ.password_env || "CALENDAR_PASSWORD";
  const email = (args.email as string) || (ctx.config.calendarEmail as string) || emailEnv;
  const password = (args.password as string) || (ctx.config.calendarPassword as string) || process.env[pwdEnvName] || "";

  try {
    // Login doesn't need a pre-existing token
    if (action === "login") {
      return actionLogin(baseUrl, { email, password });
    }

    // All other actions need auth
    if (!email || !password) {
      return formatError("Calendar credentials required. Set calendarEmail and calendarPassword in tool config, or pass email/password args.");
    }

    const token = await ensureToken(baseUrl, email, password);

    switch (action) {
      case "list_calendars":    return actionListCalendars(baseUrl, token);
      case "create_calendar":   return actionCreateCalendar(baseUrl, token, args);
      case "list_events":       return actionListEvents(baseUrl, token, args);
      case "get_event":         return actionGetEvent(baseUrl, token, args);
      case "create_event":      return actionCreateEvent(baseUrl, token, args);
      case "update_event":      return actionUpdateEvent(baseUrl, token, args);
      case "delete_event":      return actionDeleteEvent(baseUrl, token, args);
      case "list_reminders":    return actionListReminders(baseUrl, token, args);
      case "create_reminder":   return actionCreateReminder(baseUrl, token, args);
      case "dismiss_reminder":  return actionDismissReminder(baseUrl, token, args);
      default:                  return formatError(`Unhandled action: ${action}`);
    }
  } catch (err) {
    return formatError(`Calendar API error: ${(err as Error).message}`);
  }
}

// ── Tool Definition ─────────────────────────────────────────

const calendarTool: Tool = {
  name: "calendar",
  description:
    "Manage calendar events, reminders, and calendars via the homelab calendar API. " +
    "Actions: login, list_calendars, create_calendar, list_events, get_event, create_event, " +
    "update_event, delete_event, list_reminders, create_reminder, dismiss_reminder.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [...ACTIONS],
        description: "Calendar action to perform",
      },
      // Auth
      email: { type: "string", description: "User email for authentication (or set in config)" },
      password: { type: "string", description: "User password for authentication (or set in config)" },
      // Calendar fields
      name: { type: "string", description: "Calendar name (create_calendar)" },
      color: { type: "string", description: "Calendar color hex (create_calendar)" },
      calendarId: { type: "string", description: "Calendar UUID (create_event, list_events)" },
      // Event fields
      eventId: { type: "string", description: "Event UUID (get_event, update_event, delete_event)" },
      title: { type: "string", description: "Event title" },
      description: { type: "string", description: "Event description" },
      location: { type: "string", description: "Event location" },
      startAt: { type: "string", description: "Event start time (ISO 8601)" },
      endAt: { type: "string", description: "Event end time (ISO 8601)" },
      timezone: { type: "string", description: "Timezone (e.g., 'America/New_York', default: 'UTC')" },
      allDay: { type: "boolean", description: "Whether event is all-day" },
      recurrenceRule: {
        type: "string",
        description: "RFC 5545 RRULE (e.g., 'FREQ=WEEKLY;BYDAY=MO,WE,FR')",
      },
      reminders: {
        type: "array",
        items: {
          type: "object",
          properties: {
            offsetMinutes: { type: "integer", description: "Minutes before event to trigger reminder" },
          },
          required: ["offsetMinutes"],
        },
        description: "Reminders to create with the event",
      },
      // Date range for listing
      start: { type: "string", description: "Range start (ISO 8601, for list_events)" },
      end: { type: "string", description: "Range end (ISO 8601, for list_events)" },
      // Reminder fields
      reminderId: { type: "string", description: "Reminder UUID (dismiss_reminder)" },
      offsetMinutes: { type: "integer", description: "Minutes before event for reminder (create_reminder)" },
    },
    required: ["action"],
  },
  execute,
};

export default calendarTool;
