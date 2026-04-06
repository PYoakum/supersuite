import { layout, escapeHtml } from "../template.js";

export function loginPage(config, loggedIn, { error, returnTo } = {}) {
  const errorHtml = error ? `<div class="alert alert-error">${escapeHtml(error)}</div>` : "";

  const body = `
    <h1>Login</h1>
    <p class="meta" style="margin-bottom: 1rem;">Enter the edit password to make changes.</p>
    ${errorHtml}
    <form method="POST" action="/login" style="max-width: 400px;">
      <input type="hidden" name="return" value="${escapeHtml(returnTo || "")}">
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required autofocus>
      </div>
      <button type="submit" class="btn">Login</button>
    </form>
  `;
  return layout(config, loggedIn, "Login", body);
}
