import { requireAuth } from "../middleware.js";
import { parseJsonBody, requireFields, httpError } from "../../lib/validate.js";
import { parsePagination, buildOrderClause } from "../../lib/pagination.js";

export function registerWarehouseRoutes(router, config, sql) {
  // POST /api/warehouses
  router.post("/api/warehouses", async ({ req, user, sql }) => {
    requireAuth(user);
    const body = await parseJsonBody(req);
    requireFields(body, ["organization_id", "name", "code"]);

    const { organization_id, name, code, address } = body;

    const [warehouse] = await sql`
      INSERT INTO warehouses (organization_id, name, code, address)
      VALUES (${organization_id}, ${name}, ${code}, ${address || null})
      RETURNING id, organization_id, name, code, address, created_at, updated_at
    `;

    return Response.json(warehouse, { status: 201 });
  });

  // GET /api/warehouses
  router.get("/api/warehouses", async ({ url, user, sql }) => {
    requireAuth(user);
    const { limit, afterId, sort, order } = parsePagination(url);
    const orderClause = buildOrderClause(sort, order);
    const orgId = url.searchParams.get("organization_id");

    let rows;
    if (orgId && afterId) {
      rows = await sql.unsafe(
        `SELECT id, organization_id, name, code, address, created_at, updated_at
         FROM warehouses
         WHERE deleted_at IS NULL AND organization_id = $1 AND id > $2
         ${orderClause} LIMIT $3`,
        [orgId, afterId, limit]
      );
    } else if (orgId) {
      rows = await sql.unsafe(
        `SELECT id, organization_id, name, code, address, created_at, updated_at
         FROM warehouses
         WHERE deleted_at IS NULL AND organization_id = $1
         ${orderClause} LIMIT $2`,
        [orgId, limit]
      );
    } else if (afterId) {
      rows = await sql.unsafe(
        `SELECT id, organization_id, name, code, address, created_at, updated_at
         FROM warehouses
         WHERE deleted_at IS NULL AND id > $1
         ${orderClause} LIMIT $2`,
        [afterId, limit]
      );
    } else {
      rows = await sql.unsafe(
        `SELECT id, organization_id, name, code, address, created_at, updated_at
         FROM warehouses
         WHERE deleted_at IS NULL
         ${orderClause} LIMIT $1`,
        [limit]
      );
    }

    return Response.json(rows);
  });

  // GET /api/warehouses/:id
  router.get("/api/warehouses/:id", async ({ params, user, sql }) => {
    requireAuth(user);

    const [warehouse] = await sql`
      SELECT id, organization_id, name, code, address, three_scene_config, created_at, updated_at
      FROM warehouses
      WHERE id = ${params.id} AND deleted_at IS NULL
    `;
    if (!warehouse) httpError(404, "Warehouse not found");

    const zones = await sql`
      SELECT id, warehouse_id, name, code, type, created_at
      FROM warehouse_zones WHERE warehouse_id = ${params.id}
    `;

    const groups = await sql`
      SELECT id, warehouse_id, name, type
      FROM warehouse_groups WHERE warehouse_id = ${params.id}
    `;

    return Response.json({ ...warehouse, zones, groups });
  });

  // PATCH /api/warehouses/:id
  router.patch("/api/warehouses/:id", async ({ req, params, user, sql }) => {
    requireAuth(user);
    const body = await parseJsonBody(req);

    const [existing] = await sql`
      SELECT id FROM warehouses WHERE id = ${params.id} AND deleted_at IS NULL
    `;
    if (!existing) httpError(404, "Warehouse not found");

    const [warehouse] = await sql`
      UPDATE warehouses SET
        name = COALESCE(${body.name ?? null}, name),
        code = COALESCE(${body.code ?? null}, code),
        address = COALESCE(${body.address ?? null}, address),
        updated_at = now()
      WHERE id = ${params.id}
      RETURNING id, organization_id, name, code, address, created_at, updated_at
    `;

    return Response.json(warehouse);
  });

  // DELETE /api/warehouses/:id
  router.delete("/api/warehouses/:id", async ({ params, user, sql }) => {
    requireAuth(user);

    const [warehouse] = await sql`
      UPDATE warehouses SET deleted_at = now(), updated_at = now()
      WHERE id = ${params.id} AND deleted_at IS NULL
      RETURNING id
    `;
    if (!warehouse) httpError(404, "Warehouse not found");

    return Response.json({ deleted: true });
  });

  // POST /api/warehouses/:id/zones
  router.post("/api/warehouses/:id/zones", async ({ req, params, user, sql }) => {
    requireAuth(user);
    const body = await parseJsonBody(req);
    requireFields(body, ["name", "code", "type"]);

    const [existing] = await sql`
      SELECT id FROM warehouses WHERE id = ${params.id} AND deleted_at IS NULL
    `;
    if (!existing) httpError(404, "Warehouse not found");

    const [zone] = await sql`
      INSERT INTO warehouse_zones (warehouse_id, name, code, type)
      VALUES (${params.id}, ${body.name}, ${body.code}, ${body.type})
      RETURNING id, warehouse_id, name, code, type, created_at
    `;

    return Response.json(zone, { status: 201 });
  });

  // GET /api/warehouses/:id/zones
  router.get("/api/warehouses/:id/zones", async ({ params, user, sql }) => {
    requireAuth(user);

    const zones = await sql`
      SELECT id, warehouse_id, name, code, type, created_at
      FROM warehouse_zones WHERE warehouse_id = ${params.id}
    `;

    return Response.json(zones);
  });

  // POST /api/warehouses/:id/groups
  router.post("/api/warehouses/:id/groups", async ({ req, params, user, sql }) => {
    requireAuth(user);
    const body = await parseJsonBody(req);
    requireFields(body, ["name", "type"]);

    const [existing] = await sql`
      SELECT id FROM warehouses WHERE id = ${params.id} AND deleted_at IS NULL
    `;
    if (!existing) httpError(404, "Warehouse not found");

    const [group] = await sql`
      INSERT INTO warehouse_groups (warehouse_id, name, type)
      VALUES (${params.id}, ${body.name}, ${body.type})
      RETURNING id, warehouse_id, name, type
    `;

    return Response.json(group, { status: 201 });
  });

  // GET /api/warehouses/:id/scene
  router.get("/api/warehouses/:id/scene", async ({ params, user, sql }) => {
    requireAuth(user);

    const [warehouse] = await sql`
      SELECT id, three_scene_config
      FROM warehouses WHERE id = ${params.id} AND deleted_at IS NULL
    `;
    if (!warehouse) httpError(404, "Warehouse not found");

    // Return stored config if it exists
    if (warehouse.three_scene_config) {
      return Response.json(warehouse.three_scene_config);
    }

    // Auto-generate from rack_locations
    const locations = await sql`
      SELECT rl.id, rl.zone_id, rl.aisle, rl.rack, rl.shelf, rl.bin,
             rl.label, rl.x, rl.y, rl.z, rl.width, rl.height, rl.depth,
             wz.name AS zone_name
      FROM rack_locations rl
      LEFT JOIN warehouse_zones wz ON wz.id = rl.zone_id
      WHERE rl.warehouse_id = ${params.id} AND rl.deleted_at IS NULL
    `;

    // Group by zone
    const zoneMap = {};
    let maxX = 0, maxZ = 0;

    for (const loc of locations) {
      const zoneKey = loc.zone_id || "unzoned";
      if (!zoneMap[zoneKey]) {
        zoneMap[zoneKey] = { id: loc.zone_id, name: loc.zone_name || "Unzoned", units: [] };
      }
      zoneMap[zoneKey].units.push({
        id: loc.id,
        type: "rack",
        label: loc.label,
        position: { x: Number(loc.x) || 0, y: Number(loc.y) || 0, z: Number(loc.z) || 0 },
        size: { width: Number(loc.width) || 1, height: Number(loc.height) || 1, depth: Number(loc.depth) || 1 },
      });
      maxX = Math.max(maxX, (Number(loc.x) || 0) + (Number(loc.width) || 1));
      maxZ = Math.max(maxZ, (Number(loc.z) || 0) + (Number(loc.depth) || 1));
    }

    const colors = ["#4a90d9", "#d94a4a", "#4ad97a", "#d9c74a", "#9b4ad9", "#4ad9d9"];
    const zones = Object.values(zoneMap).map((z, i) => ({
      ...z,
      color: colors[i % colors.length],
    }));

    const scene = {
      floor: { width: Math.max(maxX + 2, 10), depth: Math.max(maxZ + 2, 10) },
      zones,
    };

    return Response.json(scene);
  });

  // PUT /api/warehouses/:id/scene
  router.put("/api/warehouses/:id/scene", async ({ req, params, user, sql }) => {
    requireAuth(user);
    const body = await parseJsonBody(req);

    const [warehouse] = await sql`
      UPDATE warehouses SET three_scene_config = ${JSON.stringify(body)}, updated_at = now()
      WHERE id = ${params.id} AND deleted_at IS NULL
      RETURNING id
    `;
    if (!warehouse) httpError(404, "Warehouse not found");

    return Response.json({ updated: true });
  });

  // GET /api/warehouses/:id/object-map
  router.get("/api/warehouses/:id/object-map", async ({ params, user, sql }) => {
    requireAuth(user);

    const [existing] = await sql`
      SELECT id FROM warehouses WHERE id = ${params.id} AND deleted_at IS NULL
    `;
    if (!existing) httpError(404, "Warehouse not found");

    const locations = await sql`
      SELECT rl.id, rl.zone_id, rl.group_id, rl.aisle, rl.rack, rl.shelf, rl.bin,
             rl.label, rl.x, rl.y, rl.z, rl.width, rl.height, rl.depth,
             wz.name AS zone_name, wz.code AS zone_code
      FROM rack_locations rl
      LEFT JOIN warehouse_zones wz ON wz.id = rl.zone_id
      WHERE rl.warehouse_id = ${params.id} AND rl.deleted_at IS NULL
    `;

    const objectMap = {};
    for (const loc of locations) {
      objectMap[loc.id] = {
        x: loc.x,
        y: loc.y,
        z: loc.z,
        width: loc.width,
        height: loc.height,
        depth: loc.depth,
        label: loc.label,
        aisle: loc.aisle,
        rack: loc.rack,
        shelf: loc.shelf,
        bin: loc.bin,
        zone_id: loc.zone_id,
        zone_name: loc.zone_name,
        zone_code: loc.zone_code,
        group_id: loc.group_id,
      };
    }

    return Response.json(objectMap);
  });
}
