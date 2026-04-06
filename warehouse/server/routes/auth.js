import { hashPassword, comparePassword, signAccessToken, signRefreshToken, verifyToken } from "../../lib/auth.js";
import { parseJsonBody, requireFields, httpError } from "../../lib/validate.js";

export function registerAuthRoutes(router, config, sql) {
  // POST /api/auth/register
  router.post("/api/auth/register", async ({ req, config, sql }) => {
    const body = await parseJsonBody(req);
    requireFields(body, ["email", "name", "password", "organization_id"]);

    const { email, name, password, organization_id } = body;

    // Check email not taken
    const existing = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (existing.length > 0) {
      httpError(409, "Email already registered");
    }

    const password_hash = await hashPassword(password, config.auth.bcrypt_rounds);

    const [user] = await sql`
      INSERT INTO users (email, name, password_hash, organization_id)
      VALUES (${email}, ${name}, ${password_hash}, ${organization_id})
      RETURNING id, email, name, organization_id
    `;

    const tokenPayload = { sub: user.id, email: user.email, organization_id: user.organization_id };
    const accessToken = await signAccessToken(tokenPayload, config.auth.jwt_secret, config.auth.jwt_expiry);
    const refreshToken = await signRefreshToken(tokenPayload, config.auth.jwt_refresh_secret, config.auth.jwt_refresh_expiry);

    return Response.json({
      user: { id: user.id, email: user.email, name: user.name, organization_id: user.organization_id },
      accessToken,
      refreshToken,
    }, { status: 201 });
  });

  // POST /api/auth/login
  router.post("/api/auth/login", async ({ req, config, sql }) => {
    const body = await parseJsonBody(req);
    requireFields(body, ["email", "password"]);

    const { email, password } = body;

    const [user] = await sql`
      SELECT id, email, name, password_hash, organization_id
      FROM users WHERE email = ${email}
    `;
    if (!user) {
      httpError(401, "Invalid email or password");
    }

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      httpError(401, "Invalid email or password");
    }

    const tokenPayload = { sub: user.id, email: user.email, organization_id: user.organization_id };
    const accessToken = await signAccessToken(tokenPayload, config.auth.jwt_secret, config.auth.jwt_expiry);
    const refreshToken = await signRefreshToken(tokenPayload, config.auth.jwt_refresh_secret, config.auth.jwt_refresh_expiry);

    return Response.json({
      user: { id: user.id, email: user.email, name: user.name, organization_id: user.organization_id },
      accessToken,
      refreshToken,
    });
  });

  // POST /api/auth/refresh
  router.post("/api/auth/refresh", async ({ req, config, sql }) => {
    const body = await parseJsonBody(req);
    requireFields(body, ["refreshToken"]);

    let payload;
    try {
      payload = await verifyToken(body.refreshToken, config.auth.jwt_refresh_secret);
    } catch {
      httpError(401, "Invalid or expired refresh token");
    }

    const [user] = await sql`
      SELECT id, email, name, organization_id
      FROM users WHERE id = ${payload.sub}
    `;
    if (!user) {
      httpError(401, "User not found");
    }

    const tokenPayload = { sub: user.id, email: user.email, organization_id: user.organization_id };
    const accessToken = await signAccessToken(tokenPayload, config.auth.jwt_secret, config.auth.jwt_expiry);
    const refreshToken = await signRefreshToken(tokenPayload, config.auth.jwt_refresh_secret, config.auth.jwt_refresh_expiry);

    return Response.json({ accessToken, refreshToken });
  });
}
