import { requireAuth } from "../middleware.js";
import { parseJsonBody, requireFields, httpError } from "../../lib/validate.js";
import { parsePagination, buildOrderClause } from "../../lib/pagination.js";

export function registerOrganizationRoutes(router, config, sql) {
  // POST /api/organizations
  router.post("/api/organizations", async ({ req, user, sql }) => {
    requireAuth(user);
    const body = await parseJsonBody(req);
    requireFields(body, ["name", "code"]);

    const { name, code, parent_organization_id } = body;

    const [org] = await sql`
      INSERT INTO organizations (name, code, parent_organization_id)
      VALUES (${name}, ${code}, ${parent_organization_id || null})
      RETURNING id, name, code, parent_organization_id, created_at, updated_at
    `;

    return Response.json(org, { status: 201 });
  });

  // GET /api/organizations
  router.get("/api/organizations", async ({ url, user, sql }) => {
    requireAuth(user);
    const { limit, afterId, sort, order } = parsePagination(url);
    const orderClause = buildOrderClause(sort, order);

    let rows;
    if (afterId) {
      rows = await sql.unsafe(
        `SELECT id, name, code, parent_organization_id, created_at, updated_at
         FROM organizations
         WHERE deleted_at IS NULL AND id > $1
         ${orderClause} LIMIT $2`,
        [afterId, limit]
      );
    } else {
      rows = await sql.unsafe(
        `SELECT id, name, code, parent_organization_id, created_at, updated_at
         FROM organizations
         WHERE deleted_at IS NULL
         ${orderClause} LIMIT $1`,
        [limit]
      );
    }

    return Response.json(rows);
  });

  // GET /api/organizations/:id
  router.get("/api/organizations/:id", async ({ params, user, sql }) => {
    requireAuth(user);

    const [org] = await sql`
      SELECT id, name, code, parent_organization_id, created_at, updated_at
      FROM organizations
      WHERE id = ${params.id} AND deleted_at IS NULL
    `;
    if (!org) httpError(404, "Organization not found");

    return Response.json(org);
  });

  // PATCH /api/organizations/:id
  router.patch("/api/organizations/:id", async ({ req, params, user, sql }) => {
    requireAuth(user);
    const body = await parseJsonBody(req);

    const [existing] = await sql`
      SELECT id FROM organizations WHERE id = ${params.id} AND deleted_at IS NULL
    `;
    if (!existing) httpError(404, "Organization not found");

    const [org] = await sql`
      UPDATE organizations SET
        name = COALESCE(${body.name ?? null}, name),
        code = COALESCE(${body.code ?? null}, code),
        parent_organization_id = COALESCE(${body.parent_organization_id ?? null}, parent_organization_id),
        updated_at = now()
      WHERE id = ${params.id}
      RETURNING id, name, code, parent_organization_id, created_at, updated_at
    `;

    return Response.json(org);
  });

  // DELETE /api/organizations/:id
  router.delete("/api/organizations/:id", async ({ params, user, sql }) => {
    requireAuth(user);

    const [org] = await sql`
      UPDATE organizations SET deleted_at = now(), updated_at = now()
      WHERE id = ${params.id} AND deleted_at IS NULL
      RETURNING id
    `;
    if (!org) httpError(404, "Organization not found");

    return Response.json({ deleted: true });
  });
}
