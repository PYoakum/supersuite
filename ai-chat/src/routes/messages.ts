import { chatService } from "../services/chat-service";
import { storageService } from "../services/storage-service";
import { validateCreateMessage } from "../utils/validate";
import type { PaginationQuery } from "../models/message";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handlePostMessage(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const validation = validateCreateMessage(body);

    if (!validation.valid) {
      return json({ ok: false, errors: validation.errors }, 400);
    }

    const result = chatService.createMessage(body);

    const response: Record<string, unknown> = {
      ok: true,
      message: {
        id: result.message.id,
        timestamp: result.message.timestamp,
      },
    };

    if (result.personaWarnings.length > 0) {
      response.personaWarnings = result.personaWarnings;
    }

    return json(response, 201);
  } catch (err) {
    return json({ ok: false, errors: ["Invalid JSON body"] }, 400);
  }
}

export function handleGetMessages(req: Request): Response {
  const url = new URL(req.url);
  const query: PaginationQuery = {
    limit: Number(url.searchParams.get("limit")) || undefined,
    before: url.searchParams.get("before") || undefined,
    after: url.searchParams.get("after") || undefined,
    order: (url.searchParams.get("order") as "asc" | "desc") || undefined,
  };

  const messages = storageService.getRecent(query);
  return json({ ok: true, messages });
}
