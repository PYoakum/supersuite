import { requireAuth } from "../middleware.js";
import { parseJsonBody, requireFields, httpError } from "../../lib/validate.js";

export function registerTagRoutes(router, config, sql) {
  // POST /api/tags
  router.post("/api/tags", async ({ req, user, sql }) => {
    requireAuth(user);
    const body = await parseJsonBody(req);
    requireFields(body, ["name"]);

    const [tag] = await sql`
      INSERT INTO item_tags (name, type)
      VALUES (${body.name}, ${body.type || null})
      RETURNING id, name, type
    `;

    return Response.json(tag, { status: 201 });
  });

  // GET /api/tags
  router.get("/api/tags", async ({ url, user, sql }) => {
    requireAuth(user);
    const type = url.searchParams.get("type");

    let rows;
    if (type) {
      rows = await sql`
        SELECT id, name, type FROM item_tags WHERE type = ${type} ORDER BY name ASC
      `;
    } else {
      rows = await sql`
        SELECT id, name, type FROM item_tags ORDER BY name ASC
      `;
    }

    return Response.json(rows);
  });
}
