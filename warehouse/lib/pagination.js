export function parsePagination(url) {
  const params = url.searchParams;
  const limit = Math.min(Math.max(parseInt(params.get("limit") || "50", 10), 1), 200);
  const afterId = params.get("afterId") || null;
  const sort = params.get("sort") || "created_at";
  const order = params.get("order") === "asc" ? "ASC" : "DESC";
  return { limit, afterId, sort, order };
}

const ALLOWED_SORT_COLUMNS = new Set([
  "created_at", "updated_at", "name", "sku", "quantity", "code", "label",
]);

export function buildOrderClause(sort, order) {
  const col = ALLOWED_SORT_COLUMNS.has(sort) ? sort : "created_at";
  return `ORDER BY ${col} ${order}`;
}
