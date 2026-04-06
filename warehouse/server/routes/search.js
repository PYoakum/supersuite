import { requireAuth } from "../middleware.js";
import { httpError } from "../../lib/validate.js";

export function registerSearchRoutes(router, config, sql) {
  // GET /api/search
  router.get("/api/search", async ({ url, sql, user }) => {
    requireAuth(user);

    const q = url.searchParams.get("q");
    const organizationId = url.searchParams.get("organization_id");
    const status = url.searchParams.get("status");
    const condition = url.searchParams.get("condition");
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10), 1), 200);
    const afterId = url.searchParams.get("afterId") || null;

    if (!q) {
      httpError(400, "Search query (q) is required");
    }

    const pattern = `%${q}%`;

    const items = await sql`
      SELECT i.*
      FROM items i
      WHERE (
        i.name ILIKE ${pattern}
        OR i.sku ILIKE ${pattern}
        OR i.description ILIKE ${pattern}
      )
      ${organizationId ? sql`AND i.organization_id = ${organizationId}` : sql``}
      ${status ? sql`AND i.status = ${status}` : sql``}
      ${condition ? sql`AND i.condition = ${condition}` : sql``}
      ${afterId ? sql`AND i.id > ${afterId}` : sql``}
      AND i.deleted_at IS NULL
      ORDER BY i.id ASC
      LIMIT ${limit}
    `;

    // Fetch assignments for each item
    const itemIds = items.map((i) => i.id);
    let assignments = [];
    if (itemIds.length > 0) {
      assignments = await sql`
        SELECT
          ia.*,
          w.name AS warehouse_name,
          rl.label AS rack_location_label
        FROM inventory_assignments ia
        JOIN rack_locations rl ON rl.id = ia.rack_location_id
        JOIN warehouses w ON w.id = ia.warehouse_id
        WHERE ia.item_id = ANY(${itemIds})
      `;
    }

    // Group assignments by item_id
    const assignmentsByItem = {};
    for (const a of assignments) {
      if (!assignmentsByItem[a.item_id]) {
        assignmentsByItem[a.item_id] = [];
      }
      assignmentsByItem[a.item_id].push(a);
    }

    const results = items.map((item) => ({
      ...item,
      assignments: assignmentsByItem[item.id] || [],
    }));

    return Response.json(results);
  });

  // GET /api/search/barcode/:value
  router.get("/api/search/barcode/:value", async ({ params, sql, user }) => {
    requireAuth(user);
    const value = params.value;

    const [barcode] = await sql`
      SELECT b.*, i.name AS item_name, i.sku AS item_sku
      FROM barcodes b
      JOIN items i ON i.id = b.item_id
      WHERE b.value = ${value}
    `;

    if (!barcode) {
      httpError(404, "Barcode not found");
    }

    // Fetch the full item with assignments
    const [item] = await sql`
      SELECT * FROM items WHERE id = ${barcode.item_id}
    `;

    const assignments = await sql`
      SELECT
        ia.*,
        w.name AS warehouse_name,
        rl.label AS rack_location_label
      FROM inventory_assignments ia
      JOIN rack_locations rl ON rl.id = ia.rack_location_id
      JOIN warehouses w ON w.id = ia.warehouse_id
      WHERE ia.item_id = ${barcode.item_id}
    `;

    return Response.json({
      barcode,
      item: {
        ...item,
        assignments,
      },
    });
  });
}
