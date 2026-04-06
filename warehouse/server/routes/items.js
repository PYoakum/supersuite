import { requireAuth } from "../middleware.js";
import { parseJsonBody, requireFields, httpError } from "../../lib/validate.js";
import { parsePagination, buildOrderClause } from "../../lib/pagination.js";

export function registerItemRoutes(router, config, sql) {
  // POST /api/items
  router.post("/api/items", async ({ req, user, sql }) => {
    requireAuth(user);
    const body = await parseJsonBody(req);
    requireFields(body, ["organization_id", "sku", "name"]);

    const [item] = await sql`
      INSERT INTO items (organization_id, sku, name, description, thumbnail_url, quantity, unit, condition, status, metadata_json)
      VALUES (
        ${body.organization_id},
        ${body.sku},
        ${body.name},
        ${body.description || null},
        ${body.thumbnail_url || null},
        ${body.quantity ?? 0},
        ${body.unit || null},
        ${body.condition || null},
        ${body.status || null},
        ${body.metadata_json ? JSON.stringify(body.metadata_json) : null}
      )
      RETURNING id, organization_id, sku, name, description, thumbnail_url, quantity, unit, condition, status, metadata_json, created_at, updated_at
    `;

    return Response.json(item, { status: 201 });
  });

  // GET /api/items
  router.get("/api/items", async ({ url, user, sql }) => {
    requireAuth(user);
    const { limit, afterId, sort, order } = parsePagination(url);
    const orderClause = buildOrderClause(sort, order);

    const orgId = url.searchParams.get("organization_id");
    const status = url.searchParams.get("status");
    const condition = url.searchParams.get("condition");

    const conditions = ["deleted_at IS NULL"];
    const values = [];
    let paramIdx = 1;

    if (orgId) {
      conditions.push(`organization_id = $${paramIdx++}`);
      values.push(orgId);
    }
    if (status) {
      conditions.push(`status = $${paramIdx++}`);
      values.push(status);
    }
    if (condition) {
      conditions.push(`condition = $${paramIdx++}`);
      values.push(condition);
    }
    if (afterId) {
      conditions.push(`id > $${paramIdx++}`);
      values.push(afterId);
    }

    values.push(limit);
    const whereClause = conditions.join(" AND ");

    const rows = await sql.unsafe(
      `SELECT id, organization_id, sku, name, description, thumbnail_url, quantity, unit, condition, status, created_at, updated_at
       FROM items
       WHERE ${whereClause}
       ${orderClause} LIMIT $${paramIdx}`,
      values
    );

    return Response.json(rows);
  });

  // GET /api/items/:id
  router.get("/api/items/:id", async ({ params, user, sql }) => {
    requireAuth(user);

    const [item] = await sql`
      SELECT id, organization_id, sku, name, description, thumbnail_url, quantity, unit, condition, status, metadata_json, created_at, updated_at
      FROM items
      WHERE id = ${params.id} AND deleted_at IS NULL
    `;
    if (!item) httpError(404, "Item not found");

    const tags = await sql`
      SELECT t.id, t.name, t.type
      FROM item_tags t
      INNER JOIN item_tag_map m ON m.tag_id = t.id
      WHERE m.item_id = ${params.id}
    `;

    const barcodes = await sql`
      SELECT id, symbology, value, image_url, type, created_at
      FROM barcodes
      WHERE item_id = ${params.id}
    `;

    const assignments = await sql`
      SELECT ia.id, ia.warehouse_id, ia.rack_location_id, ia.quantity, ia.placed_at,
             w.name AS warehouse_name, rl.label AS location_label
      FROM inventory_assignments ia
      LEFT JOIN warehouses w ON w.id = ia.warehouse_id
      LEFT JOIN rack_locations rl ON rl.id = ia.rack_location_id
      WHERE ia.item_id = ${params.id}
    `;

    return Response.json({ ...item, tags, barcodes, assignments });
  });

  // PATCH /api/items/:id
  router.patch("/api/items/:id", async ({ req, params, user, sql }) => {
    requireAuth(user);
    const body = await parseJsonBody(req);

    const [existing] = await sql`
      SELECT id FROM items WHERE id = ${params.id} AND deleted_at IS NULL
    `;
    if (!existing) httpError(404, "Item not found");

    const [item] = await sql`
      UPDATE items SET
        name = COALESCE(${body.name ?? null}, name),
        sku = COALESCE(${body.sku ?? null}, sku),
        description = COALESCE(${body.description ?? null}, description),
        thumbnail_url = COALESCE(${body.thumbnail_url ?? null}, thumbnail_url),
        quantity = COALESCE(${body.quantity ?? null}, quantity),
        unit = COALESCE(${body.unit ?? null}, unit),
        condition = COALESCE(${body.condition ?? null}, condition),
        status = COALESCE(${body.status ?? null}, status),
        metadata_json = COALESCE(${body.metadata_json ? JSON.stringify(body.metadata_json) : null}, metadata_json),
        updated_at = now()
      WHERE id = ${params.id}
      RETURNING id, organization_id, sku, name, description, thumbnail_url, quantity, unit, condition, status, metadata_json, created_at, updated_at
    `;

    return Response.json(item);
  });

  // DELETE /api/items/:id
  router.delete("/api/items/:id", async ({ params, user, sql }) => {
    requireAuth(user);

    const [item] = await sql`
      UPDATE items SET deleted_at = now(), updated_at = now()
      WHERE id = ${params.id} AND deleted_at IS NULL
      RETURNING id
    `;
    if (!item) httpError(404, "Item not found");

    return Response.json({ deleted: true });
  });

  // POST /api/items/:id/tags
  router.post("/api/items/:id/tags", async ({ req, params, user, sql }) => {
    requireAuth(user);
    const body = await parseJsonBody(req);
    requireFields(body, ["tag_ids"]);

    const [existing] = await sql`
      SELECT id FROM items WHERE id = ${params.id} AND deleted_at IS NULL
    `;
    if (!existing) httpError(404, "Item not found");

    if (!Array.isArray(body.tag_ids) || body.tag_ids.length === 0) {
      httpError(422, "tag_ids must be a non-empty array");
    }

    const rows = body.tag_ids.map((tagId) => ({ item_id: params.id, tag_id: tagId }));

    await sql`
      INSERT INTO item_tag_map ${sql(rows, "item_id", "tag_id")}
      ON CONFLICT DO NOTHING
    `;

    return Response.json({ added: body.tag_ids.length }, { status: 201 });
  });

  // DELETE /api/items/:id/tags/:tagId
  router.delete("/api/items/:id/tags/:tagId", async ({ params, user, sql }) => {
    requireAuth(user);

    await sql`
      DELETE FROM item_tag_map
      WHERE item_id = ${params.id} AND tag_id = ${params.tagId}
    `;

    return Response.json({ deleted: true });
  });

  // GET /api/items/:id/transactions
  router.get("/api/items/:id/transactions", async ({ url, params, user, sql }) => {
    requireAuth(user);
    const { limit, afterId, sort, order } = parsePagination(url);

    let rows;
    if (afterId) {
      rows = await sql`
        SELECT it.id, it.type, it.from_location_id, it.to_location_id, it.quantity,
               it.actor_user_id, it.note, it.created_at,
               u.name AS actor_name
        FROM inventory_transactions it
        LEFT JOIN users u ON u.id = it.actor_user_id
        WHERE it.item_id = ${params.id} AND it.id > ${afterId}
        ORDER BY it.created_at DESC
        LIMIT ${limit}
      `;
    } else {
      rows = await sql`
        SELECT it.id, it.type, it.from_location_id, it.to_location_id, it.quantity,
               it.actor_user_id, it.note, it.created_at,
               u.name AS actor_name
        FROM inventory_transactions it
        LEFT JOIN users u ON u.id = it.actor_user_id
        WHERE it.item_id = ${params.id}
        ORDER BY it.created_at DESC
        LIMIT ${limit}
      `;
    }

    return Response.json(rows);
  });
}
