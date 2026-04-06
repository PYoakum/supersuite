# API Design

## URL Structure
- Nouns, not verbs: `/api/tasks` not `/api/getTasks`
- Plural resources: `/api/tasks`, `/api/users`
- Nested for ownership: `/api/tasks/:id/comments`
- Query params for filtering: `/api/tasks?status=done&assignee=ai-1`

## Methods
- `GET` — read (idempotent, cacheable)
- `POST` — create or action
- `PUT` — full replace
- `PATCH` — partial update
- `DELETE` — remove

## Response Format
```json
{ "ok": true, "data": { ... } }
{ "ok": false, "errors": ["description of what went wrong"] }
```

## Status Codes
- `200` — success
- `201` — created
- `400` — bad request (client error, validation failure)
- `401` — not authenticated
- `403` — not authorized
- `404` — not found
- `409` — conflict (duplicate, state mismatch)
- `500` — server error (never intentional)

## Pagination
- Use `?limit=N&offset=M` or cursor-based
- Return `{ total, limit, offset }` in response

## Versioning
- Don't version until you need to
- When you do: URL prefix `/api/v2/`
