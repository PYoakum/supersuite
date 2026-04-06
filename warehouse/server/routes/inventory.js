import { requireAuth } from "../middleware.js";
import { parseJsonBody, requireFields, httpError } from "../../lib/validate.js";

export function registerInventoryRoutes(router, config, sql) {
  // POST /api/items/:id/assignments
  router.post("/api/items/:id/assignments", async ({ req, params, sql, user }) => {
    requireAuth(user);
    const body = await parseJsonBody(req);
    requireFields(body, ["warehouse_id", "rack_location_id", "quantity"]);

    const itemId = params.id;
    const { warehouse_id, rack_location_id, quantity } = body;

    if (quantity <= 0) {
      httpError(400, "Quantity must be positive");
    }

    const assignment = await sql.begin(async (tx) => {
      const [existing] = await tx`
        SELECT id, quantity FROM inventory_assignments
        WHERE item_id = ${itemId} AND rack_location_id = ${rack_location_id}
      `;

      let result;
      if (existing) {
        [result] = await tx`
          UPDATE inventory_assignments
          SET quantity = quantity + ${quantity}
          WHERE id = ${existing.id}
          RETURNING *
        `;
      } else {
        [result] = await tx`
          INSERT INTO inventory_assignments (item_id, warehouse_id, rack_location_id, quantity)
          VALUES (${itemId}, ${warehouse_id}, ${rack_location_id}, ${quantity})
          RETURNING *
        `;
      }

      await tx`
        INSERT INTO inventory_transactions (item_id, type, to_location_id, quantity, actor_user_id)
        VALUES (${itemId}, 'check_in', ${rack_location_id}, ${quantity}, ${user.sub})
      `;

      await tx`
        UPDATE items SET quantity = quantity + ${quantity} WHERE id = ${itemId}
      `;

      return result;
    });

    return Response.json(assignment, { status: 201 });
  });

  // GET /api/items/:id/assignments
  router.get("/api/items/:id/assignments", async ({ params, sql, user }) => {
    requireAuth(user);
    const itemId = params.id;

    const assignments = await sql`
      SELECT
        ia.*,
        w.name AS warehouse_name,
        rl.label AS rack_location_label,
        rl.zone_id
      FROM inventory_assignments ia
      JOIN rack_locations rl ON rl.id = ia.rack_location_id
      JOIN warehouses w ON w.id = ia.warehouse_id
      WHERE ia.item_id = ${itemId}
      ORDER BY ia.placed_at DESC
    `;

    return Response.json(assignments);
  });

  // POST /api/items/:id/transfers
  router.post("/api/items/:id/transfers", async ({ req, params, sql, user }) => {
    requireAuth(user);
    const body = await parseJsonBody(req);
    requireFields(body, ["from_location_id", "to_location_id", "quantity"]);

    const itemId = params.id;
    const { from_location_id, to_location_id, quantity, note } = body;

    if (quantity <= 0) {
      httpError(400, "Quantity must be positive");
    }

    await sql.begin(async (tx) => {
      // Find source assignment
      const [source] = await tx`
        SELECT id, quantity FROM inventory_assignments
        WHERE item_id = ${itemId} AND rack_location_id = ${from_location_id}
      `;

      if (!source || source.quantity < quantity) {
        httpError(400, "Insufficient quantity");
      }

      // Decrement or delete source
      const newSourceQty = source.quantity - quantity;
      if (newSourceQty === 0) {
        await tx`DELETE FROM inventory_assignments WHERE id = ${source.id}`;
      } else {
        await tx`
          UPDATE inventory_assignments SET quantity = ${newSourceQty} WHERE id = ${source.id}
        `;
      }

      // Find or create destination assignment
      const [destLocation] = await tx`
        SELECT warehouse_id FROM rack_locations WHERE id = ${to_location_id}
      `;
      if (!destLocation) {
        httpError(404, "Destination rack location not found");
      }

      const [existingDest] = await tx`
        SELECT id FROM inventory_assignments
        WHERE item_id = ${itemId} AND rack_location_id = ${to_location_id}
      `;

      if (existingDest) {
        await tx`
          UPDATE inventory_assignments
          SET quantity = quantity + ${quantity}
          WHERE id = ${existingDest.id}
        `;
      } else {
        await tx`
          INSERT INTO inventory_assignments (item_id, warehouse_id, rack_location_id, quantity)
          VALUES (${itemId}, ${destLocation.warehouse_id}, ${to_location_id}, ${quantity})
        `;
      }

      // Record transaction
      await tx`
        INSERT INTO inventory_transactions (item_id, type, from_location_id, to_location_id, quantity, actor_user_id, note)
        VALUES (${itemId}, 'transfer', ${from_location_id}, ${to_location_id}, ${quantity}, ${user.sub}, ${note || null})
      `;
    });

    return Response.json({ success: true });
  });

  // POST /api/items/:id/adjustments
  router.post("/api/items/:id/adjustments", async ({ req, params, sql, user }) => {
    requireAuth(user);
    const body = await parseJsonBody(req);
    requireFields(body, ["rack_location_id", "quantity"]);

    const itemId = params.id;
    const { rack_location_id, quantity, note } = body;

    await sql.begin(async (tx) => {
      // Find or create assignment
      let [assignment] = await tx`
        SELECT id, quantity FROM inventory_assignments
        WHERE item_id = ${itemId} AND rack_location_id = ${rack_location_id}
      `;

      if (assignment) {
        const newQty = assignment.quantity + quantity;
        if (newQty < 0) {
          httpError(400, "Adjustment would result in negative quantity");
        }
        await tx`
          UPDATE inventory_assignments SET quantity = ${newQty} WHERE id = ${assignment.id}
        `;
      } else {
        if (quantity < 0) {
          httpError(400, "Adjustment would result in negative quantity");
        }
        // Look up warehouse_id from rack_location
        const [rl] = await tx`
          SELECT warehouse_id FROM rack_locations WHERE id = ${rack_location_id}
        `;
        if (!rl) {
          httpError(404, "Rack location not found");
        }
        await tx`
          INSERT INTO inventory_assignments (item_id, warehouse_id, rack_location_id, quantity)
          VALUES (${itemId}, ${rl.warehouse_id}, ${rack_location_id}, ${quantity})
        `;
      }

      // Record transaction
      await tx`
        INSERT INTO inventory_transactions (item_id, type, from_location_id, quantity, actor_user_id, note)
        VALUES (${itemId}, 'adjustment', ${rack_location_id}, ${quantity}, ${user.sub}, ${note || null})
      `;

      // Update item total quantity
      await tx`
        UPDATE items SET quantity = quantity + ${quantity} WHERE id = ${itemId}
      `;
    });

    return Response.json({ success: true });
  });

  // GET /api/inventory/dashboard
  router.get("/api/inventory/dashboard", async ({ url, sql, user }) => {
    requireAuth(user);
    const organizationId = url.searchParams.get("organization_id");
    if (!organizationId) {
      httpError(400, "organization_id is required");
    }

    const [counts] = await sql`
      SELECT
        COUNT(*)::int AS total_items,
        COALESCE(SUM(quantity), 0)::int AS total_quantity
      FROM items
      WHERE organization_id = ${organizationId} AND deleted_at IS NULL
    `;

    const [locationCount] = await sql`
      SELECT COUNT(DISTINCT ia.rack_location_id)::int AS locations_in_use
      FROM inventory_assignments ia
      JOIN items i ON i.id = ia.item_id
      WHERE i.organization_id = ${organizationId} AND ia.quantity > 0
    `;

    const recentTransactions = await sql`
      SELECT
        it.*,
        i.name AS item_name,
        fl.label AS from_location_label,
        tl.label AS to_location_label
      FROM inventory_transactions it
      JOIN items i ON i.id = it.item_id
      LEFT JOIN rack_locations fl ON fl.id = it.from_location_id
      LEFT JOIN rack_locations tl ON tl.id = it.to_location_id
      WHERE i.organization_id = ${organizationId}
      ORDER BY it.created_at DESC
      LIMIT 10
    `;

    const lowStockItems = await sql`
      SELECT id, name, sku, quantity
      FROM items
      WHERE organization_id = ${organizationId}
        AND quantity <= 5
        AND status = 'active'
        AND deleted_at IS NULL
      ORDER BY quantity ASC
    `;

    return Response.json({
      total_items: counts.total_items,
      total_quantity: counts.total_quantity,
      locations_in_use: locationCount.locations_in_use,
      recent_transactions: recentTransactions,
      low_stock_items: lowStockItems,
    });
  });
}
