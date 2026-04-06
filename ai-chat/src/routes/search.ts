import { storageService } from "../services/storage-service";
import type { SearchQuery, SenderType } from "../models/message";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function handleSearch(req: Request): Response {
  const url = new URL(req.url);
  const query: SearchQuery = {
    q: url.searchParams.get("q") || undefined,
    senderId: url.searchParams.get("senderId") || undefined,
    senderType: (url.searchParams.get("senderType") as SenderType) || undefined,
    after: url.searchParams.get("after") || undefined,
    before: url.searchParams.get("before") || undefined,
    limit: Number(url.searchParams.get("limit")) || undefined,
    offset: Number(url.searchParams.get("offset")) || undefined,
  };

  const { results, total } = storageService.search(query);
  return json({ ok: true, results, total });
}
