import { requireAuth } from "../middleware.js";
import { parseJsonBody, httpError } from "../../lib/validate.js";
import { generateBarcodeImage } from "../../lib/barcode.js";
import { upload } from "../../lib/storage.js";
import { join } from "path";

export function registerBarcodeRoutes(router, config, sql) {
  // POST /api/items/:id/barcodes
  router.post("/api/items/:id/barcodes", async ({ req, params, config, sql, user }) => {
    requireAuth(user);
    const itemId = params.id;
    const body = await parseJsonBody(req);

    const symbology = body.symbology || "Code128";
    const type = body.type || "internal";

    // Look up item to get SKU for auto-generated value
    const [item] = await sql`SELECT sku FROM items WHERE id = ${itemId}`;
    if (!item) {
      httpError(404, "Item not found");
    }

    const value = body.value || `WH-${item.sku}-${Date.now()}`;

    const [barcode] = await sql`
      INSERT INTO barcodes (item_id, symbology, value, type)
      VALUES (${itemId}, ${symbology}, ${value}, ${type})
      RETURNING *
    `;

    // Fire-and-forget: generate image and upload
    (async () => {
      try {
        const imageBuffer = await generateBarcodeImage(symbology, value);
        const key = `barcodes/${barcode.id}.png`;
        const imageUrl = await upload(config.storage.uploads_dir, key, imageBuffer);
        await sql`UPDATE barcodes SET image_url = ${imageUrl} WHERE id = ${barcode.id}`;
      } catch (err) {
        console.error(`Failed to generate barcode image for ${barcode.id}:`, err);
      }
    })();

    return Response.json(barcode, { status: 201 });
  });

  // GET /api/items/:id/barcodes
  router.get("/api/items/:id/barcodes", async ({ params, sql, user }) => {
    requireAuth(user);
    const itemId = params.id;

    const barcodes = await sql`
      SELECT * FROM barcodes
      WHERE item_id = ${itemId}
      ORDER BY created_at DESC
    `;

    return Response.json(barcodes);
  });

  // GET /api/barcodes/:value
  router.get("/api/barcodes/:value", async ({ params, sql, user }) => {
    requireAuth(user);
    const value = params.value;

    const [barcode] = await sql`
      SELECT b.*, i.name AS item_name, i.sku AS item_sku, i.quantity AS item_quantity
      FROM barcodes b
      JOIN items i ON i.id = b.item_id
      WHERE b.value = ${value}
    `;

    if (!barcode) {
      httpError(404, "Barcode not found");
    }

    return Response.json(barcode);
  });

  // GET /api/barcodes/:value/image - no auth required
  router.get("/api/barcodes/:value/image", async ({ params, config, sql }) => {
    const value = params.value;

    const [barcode] = await sql`
      SELECT image_url FROM barcodes WHERE value = ${value}
    `;

    if (!barcode || !barcode.image_url) {
      httpError(404, "Barcode image not found");
    }

    // image_url is like /uploads/barcodes/{id}.png — resolve to file path
    const relativePath = barcode.image_url.replace(/^\/uploads\//, "");
    const filePath = join(process.cwd(), config.storage.uploads_dir, relativePath);
    const file = Bun.file(filePath);

    if (!(await file.exists())) {
      httpError(404, "Barcode image not found");
    }

    return new Response(file, {
      headers: { "Content-Type": "image/png" },
    });
  });
}
