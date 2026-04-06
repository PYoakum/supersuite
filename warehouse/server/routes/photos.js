import { requireAuth } from "../middleware.js";
import { parseJsonBody, httpError } from "../../lib/validate.js";
import { upload, remove } from "../../lib/storage.js";
import { generateThumbnail } from "../../lib/photos.js";

export function registerPhotoRoutes(router, config, sql) {
  // POST /api/items/:id/photos
  router.post("/api/items/:id/photos", async ({ req, params, config, sql, user }) => {
    requireAuth(user);
    const itemId = params.id;

    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      httpError(400, "No file uploaded");
    }

    const altText = formData.get("alt_text") || null;
    const buffer = Buffer.from(await file.arrayBuffer());

    // Get next sort_order
    const [maxOrder] = await sql`
      SELECT COALESCE(MAX(sort_order), -1)::int + 1 AS next_order
      FROM item_photos WHERE item_id = ${itemId}
    `;

    const [photo] = await sql`
      INSERT INTO item_photos (item_id, url, alt_text, sort_order)
      VALUES (${itemId}, '', ${altText}, ${maxOrder.next_order})
      RETURNING *
    `;

    // Upload original
    const photoKey = `photos/${itemId}/${photo.id}.png`;
    const photoUrl = await upload(config.storage.uploads_dir, photoKey, buffer);

    await sql`UPDATE item_photos SET url = ${photoUrl} WHERE id = ${photo.id}`;
    photo.url = photoUrl;

    // Fire-and-forget: generate thumbnail
    (async () => {
      try {
        const thumbBuffer = await generateThumbnail(buffer);
        const thumbKey = `thumbnails/${photo.id}.png`;
        const thumbUrl = await upload(config.storage.uploads_dir, thumbKey, thumbBuffer);
        await sql`UPDATE item_photos SET thumbnail_url = ${thumbUrl} WHERE id = ${photo.id}`;
      } catch (err) {
        console.error(`Failed to generate thumbnail for photo ${photo.id}:`, err);
      }
    })();

    return Response.json(photo, { status: 201 });
  });

  // GET /api/items/:id/photos
  router.get("/api/items/:id/photos", async ({ params, sql, user }) => {
    requireAuth(user);
    const itemId = params.id;

    const photos = await sql`
      SELECT * FROM item_photos
      WHERE item_id = ${itemId}
      ORDER BY sort_order ASC
    `;

    return Response.json(photos);
  });

  // DELETE /api/photos/:id
  router.delete("/api/photos/:id", async ({ params, config, sql, user }) => {
    requireAuth(user);
    const photoId = params.id;

    const [photo] = await sql`
      SELECT * FROM item_photos WHERE id = ${photoId}
    `;

    if (!photo) {
      httpError(404, "Photo not found");
    }

    // Remove files
    if (photo.url) {
      const photoKey = photo.url.replace(/^\/uploads\//, "");
      await remove(config.storage.uploads_dir, photoKey);
    }
    if (photo.thumbnail_url) {
      const thumbKey = photo.thumbnail_url.replace(/^\/uploads\//, "");
      await remove(config.storage.uploads_dir, thumbKey);
    }

    await sql`DELETE FROM item_photos WHERE id = ${photoId}`;

    return Response.json({ success: true });
  });

  // PATCH /api/items/:id/photos/reorder
  router.patch("/api/items/:id/photos/reorder", async ({ req, params, sql, user }) => {
    requireAuth(user);
    const itemId = params.id;
    const body = await parseJsonBody(req);

    if (!Array.isArray(body.photo_ids)) {
      httpError(400, "photo_ids must be an array");
    }

    const photoIds = body.photo_ids;

    for (let i = 0; i < photoIds.length; i++) {
      await sql`
        UPDATE item_photos
        SET sort_order = ${i}
        WHERE id = ${photoIds[i]} AND item_id = ${itemId}
      `;
    }

    return Response.json({ success: true });
  });
}
