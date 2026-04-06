import { requireAuth } from "../middleware.js";
import { parseJsonBody, requireFields, httpError } from "../../lib/validate.js";
import { parsePagination, buildOrderClause } from "../../lib/pagination.js";

export function registerRackLocationRoutes(router, config, sql) {
  // POST /api/rack-locations
  router.post("/api/rack-locations", async ({ req, user, sql }) => {
    requireAuth(user);
    const body = await parseJsonBody(req);
    requireFields(body, ["warehouse_id", "aisle", "rack", "shelf", "bin"]);

    const [loc] = await sql`
      INSERT INTO rack_locations (warehouse_id, zone_id, group_id, aisle, rack, shelf, bin, label, x, y, z, width, height, depth)
      VALUES (
        ${body.warehouse_id},
        ${body.zone_id || null},
        ${body.group_id || null},
        ${body.aisle},
        ${body.rack},
        ${body.shelf},
        ${body.bin},
        ${body.label || null},
        ${body.x ?? null},
        ${body.y ?? null},
        ${body.z ?? null},
        ${body.width ?? null},
        ${body.height ?? null},
        ${body.depth ?? null}
      )
      RETURNING id, warehouse_id, zone_id, group_id, aisle, rack, shelf, bin, label, x, y, z, width, height, depth, created_at
    `;

    return Response.json(loc, { status: 201 });
  });

  // GET /api/rack-locations
  router.get("/api/rack-locations", async ({ url, user, sql }) => {
    requireAuth(user);
    const { limit, afterId, sort, order } = parsePagination(url);
    const orderClause = buildOrderClause(sort, order);

    const warehouseId = url.searchParams.get("warehouse_id");
    const zoneId = url.searchParams.get("zone_id");

    const conditions = ["deleted_at IS NULL"];
    const values = [];
    let paramIdx = 1;

    if (warehouseId) {
      conditions.push(`warehouse_id = $${paramIdx++}`);
      values.push(warehouseId);
    }
    if (zoneId) {
      conditions.push(`zone_id = $${paramIdx++}`);
      values.push(zoneId);
    }
    if (afterId) {
      conditions.push(`id > $${paramIdx++}`);
      values.push(afterId);
    }

    values.push(limit);
    const whereClause = conditions.join(" AND ");

    const rows = await sql.unsafe(
      `SELECT id, warehouse_id, zone_id, group_id, aisle, rack, shelf, bin, label, x, y, z, width, height, depth
       FROM rack_locations
       WHERE ${whereClause}
       ${orderClause} LIMIT $${paramIdx}`,
      values
    );

    return Response.json(rows);
  });

  // GET /api/rack-locations/:id
  router.get("/api/rack-locations/:id", async ({ params, user, sql }) => {
    requireAuth(user);

    const [loc] = await sql`
      SELECT rl.id, rl.warehouse_id, rl.zone_id, rl.group_id, rl.aisle, rl.rack, rl.shelf, rl.bin,
             rl.label, rl.x, rl.y, rl.z, rl.width, rl.height, rl.depth,
             wz.name AS zone_name, wz.code AS zone_code, wz.type AS zone_type
      FROM rack_locations rl
      LEFT JOIN warehouse_zones wz ON wz.id = rl.zone_id
      WHERE rl.id = ${params.id} AND rl.deleted_at IS NULL
    `;
    if (!loc) httpError(404, "Rack location not found");

    return Response.json(loc);
  });

  // PATCH /api/rack-locations/:id
  router.patch("/api/rack-locations/:id", async ({ req, params, user, sql }) => {
    requireAuth(user);
    const body = await parseJsonBody(req);

    const [existing] = await sql`
      SELECT id FROM rack_locations WHERE id = ${params.id} AND deleted_at IS NULL
    `;
    if (!existing) httpError(404, "Rack location not found");

    const [loc] = await sql`
      UPDATE rack_locations SET
        zone_id = COALESCE(${body.zone_id ?? null}, zone_id),
        group_id = COALESCE(${body.group_id ?? null}, group_id),
        aisle = COALESCE(${body.aisle ?? null}, aisle),
        rack = COALESCE(${body.rack ?? null}, rack),
        shelf = COALESCE(${body.shelf ?? null}, shelf),
        bin = COALESCE(${body.bin ?? null}, bin),
        label = COALESCE(${body.label ?? null}, label),
        x = COALESCE(${body.x ?? null}, x),
        y = COALESCE(${body.y ?? null}, y),
        z = COALESCE(${body.z ?? null}, z),
        width = COALESCE(${body.width ?? null}, width),
        height = COALESCE(${body.height ?? null}, height),
        depth = COALESCE(${body.depth ?? null}, depth)
      WHERE id = ${params.id}
      RETURNING id, warehouse_id, zone_id, group_id, aisle, rack, shelf, bin, label, x, y, z, width, height, depth
    `;

    return Response.json(loc);
  });

  // DELETE /api/rack-locations/:id
  router.delete("/api/rack-locations/:id", async ({ params, user, sql }) => {
    requireAuth(user);

    const [loc] = await sql`
      UPDATE rack_locations SET deleted_at = now()
      WHERE id = ${params.id} AND deleted_at IS NULL
      RETURNING id
    `;
    if (!loc) httpError(404, "Rack location not found");

    return Response.json({ deleted: true });
  });
}
