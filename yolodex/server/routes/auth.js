import sql from "../lib/db.js";
import { layout, fieldPartial, htmlResponse, redirect, h } from "../lib/templates.js";
import { setCookie } from "../lib/request.js";
import { validate, required, isEmail } from "../lib/validation.js";
import { createSession, destroySession } from "../middleware/auth.js";

/** Render login page */
export async function loginPage(ctx) {
  if (ctx.state.user) return redirect("/");

  const content = loginForm({ errors: {}, values: {}, csrfToken: ctx.state.csrfToken });
  return htmlResponse(
    layout({ title: "Login — Nonprofit CRM", content, activePath: "/login" })
  );
}

/** Handle login submission */
export async function loginSubmit(ctx) {
  const body = ctx.state.body;
  const errors = validate(body, {
    email: [required("Email is required"), isEmail()],
    password: [required("Password is required")],
  });

  if (errors) {
    const content = loginForm({ errors, values: body, csrfToken: ctx.state.csrfToken });
    return htmlResponse(
      layout({ title: "Login — Nonprofit CRM", content, activePath: "/login" }),
      422
    );
  }

  // Find account
  const rows = await sql`
    SELECT id, email, password_hash, role, is_active
    FROM accounts
    WHERE email = ${body.email.trim().toLowerCase()}
  `;

  if (rows.length === 0) {
    const content = loginForm({
      errors: { email: "Invalid email or password" },
      values: body,
      csrfToken: ctx.state.csrfToken,
    });
    return htmlResponse(
      layout({ title: "Login — Nonprofit CRM", content, activePath: "/login" }),
      422
    );
  }

  const account = rows[0];

  if (!account.is_active) {
    const content = loginForm({
      errors: { email: "This account has been deactivated" },
      values: body,
      csrfToken: ctx.state.csrfToken,
    });
    return htmlResponse(
      layout({ title: "Login — Nonprofit CRM", content, activePath: "/login" }),
      422
    );
  }

  // Verify password
  const valid = await Bun.password.verify(body.password, account.password_hash);
  if (!valid) {
    const content = loginForm({
      errors: { email: "Invalid email or password" },
      values: body,
      csrfToken: ctx.state.csrfToken,
    });
    return htmlResponse(
      layout({ title: "Login — Nonprofit CRM", content, activePath: "/login" }),
      422
    );
  }

  // Create session
  const sessionCookie = await createSession(account.id);
  const csrfToken = ctx.state.csrfToken;

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": [sessionCookie, setCookie("_csrf", csrfToken, { httpOnly: false })].join(", "),
    },
  });
}

/** Handle logout */
export async function logoutSubmit(ctx) {
  const cookie = destroySession();
  return new Response(null, {
    status: 302,
    headers: { Location: "/login", "Set-Cookie": cookie },
  });
}

/** Login form HTML */
function loginForm({ errors = {}, values = {}, csrfToken = "" }) {
  return `
  <div class="auth-container">
    <h1>Sign In</h1>
    <form method="POST" action="/login" class="form">
      <input type="hidden" name="_csrf" value="${h(csrfToken)}">
      ${fieldPartial({ label: "Email", name: "email", type: "email", value: values.email, error: errors.email, required: true })}
      ${fieldPartial({ label: "Password", name: "password", type: "password", value: "", error: errors.password, required: true })}
      <button type="submit" class="btn btn-primary">Sign In</button>
    </form>
  </div>`;
}
