import { createUser, findUserByUsername, getUserCount } from "../../db/users.js";
import { createSession, deleteSession } from "../../db/sessions.js";
import { logLogin } from "../../db/moderation.js";
import { redirect, html, sessionCookie, deriveCsrfToken } from "../middleware.js";
import { renderLogin } from "../../web/pages/login.js";
import { renderRegister } from "../../web/pages/register.js";
import { formatDate } from "../../web/template.js";

async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(buf).toString("hex");
}

function getClientIp(req) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || null;
}

export function registerAuthRoutes(router, config, sql) {
  router.get("/login", async (ctx) => {
    if (ctx.user) return redirect("/");
    return html(renderLogin(config, null));
  });

  router.post("/login", async (ctx) => {
    const form = await ctx.req.formData();
    const username = form.get("username")?.trim();
    const password = form.get("password");

    if (!username || !password) {
      return html(renderLogin(config, null, "Username and password are required"));
    }

    const user = await findUserByUsername(sql, username);
    if (!user) {
      return html(renderLogin(config, null, "Invalid username or password"));
    }

    const valid = await Bun.password.verify(password, user.password_hash);
    if (!valid) {
      return html(renderLogin(config, null, "Invalid username or password"));
    }

    // Check suspension
    if (user.suspended_until && new Date(user.suspended_until) > new Date()) {
      const reason = user.suspension_reason ? ` Reason: ${user.suspension_reason}` : "";
      return html(renderLogin(config, null, `Your account is suspended until ${formatDate(user.suspended_until)}.${reason}`));
    }

    // Create session
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
    const tokenHash = await hashToken(token);
    const expiresAt = new Date(Date.now() + config.session.lifetime_hours * 60 * 60 * 1000);
    await createSession(sql, user.id, tokenHash, expiresAt);

    // Log login
    const ip = getClientIp(ctx.req);
    await logLogin(sql, user.id, ip);

    const maxAge = config.session.lifetime_hours * 60 * 60;
    return redirect("/", {
      "Set-Cookie": sessionCookie(config, token, maxAge),
    });
  });

  router.get("/register", async (ctx) => {
    if (ctx.user) return redirect("/");
    if (!config.registration.enabled) {
      return html(renderRegister(config, null, "Registration is currently disabled"));
    }
    return html(renderRegister(config, null));
  });

  router.post("/register", async (ctx) => {
    if (!config.registration.enabled) {
      return html(renderRegister(config, null, "Registration is currently disabled"));
    }

    const form = await ctx.req.formData();
    const username = form.get("username")?.trim();
    const password = form.get("password");
    const confirm = form.get("confirm");

    // Validate
    if (!username || !password) {
      return html(renderRegister(config, null, "All fields are required"));
    }
    if (username.length < config.registration.min_username_length) {
      return html(renderRegister(config, null, `Username must be at least ${config.registration.min_username_length} characters`));
    }
    if (username.length > config.registration.max_username_length) {
      return html(renderRegister(config, null, `Username must be at most ${config.registration.max_username_length} characters`));
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return html(renderRegister(config, null, "Username may only contain letters, numbers, hyphens, and underscores"));
    }
    if (password.length < config.registration.min_password_length) {
      return html(renderRegister(config, null, `Password must be at least ${config.registration.min_password_length} characters`));
    }
    if (password !== confirm) {
      return html(renderRegister(config, null, "Passwords do not match"));
    }

    // Check uniqueness
    const existing = await findUserByUsername(sql, username);
    if (existing) {
      return html(renderRegister(config, null, "Username is already taken"));
    }

    // First user is admin
    const count = await getUserCount(sql);
    const role = count === 0 ? "admin" : "user";

    const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });
    const user = await createUser(sql, username, passwordHash, role);

    // Auto-login
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
    const tokenHash = await hashToken(token);
    const expiresAt = new Date(Date.now() + config.session.lifetime_hours * 60 * 60 * 1000);
    await createSession(sql, user.id, tokenHash, expiresAt);

    // Log login
    const ip = getClientIp(ctx.req);
    await logLogin(sql, user.id, ip);

    const maxAge = config.session.lifetime_hours * 60 * 60;
    return redirect("/", {
      "Set-Cookie": sessionCookie(config, token, maxAge),
    });
  });

  router.post("/logout", async (ctx) => {
    if (ctx.user && ctx.user._sessionToken) {
      const tokenHash = await hashToken(ctx.user._sessionToken);
      await deleteSession(sql, tokenHash);
    }
    return redirect("/", {
      "Set-Cookie": sessionCookie(config, "", 0),
    });
  });
}
