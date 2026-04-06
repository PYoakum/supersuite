import { layout, escapeHtml } from "../template.js";

export function renderLogin(config, user, error = null) {
  let body = "<h1>Login</h1>";
  if (error) {
    body += `<div class="alert alert-error">${escapeHtml(error)}</div>`;
  }
  body += `
    <form method="POST" action="/login">
      <div class="form-group">
        <label for="username">Username:</label>
        <input type="text" id="username" name="username" required autofocus>
      </div>
      <div class="form-group">
        <label for="password">Password:</label>
        <input type="password" id="password" name="password" required>
      </div>
      <button type="submit" class="btn">Login</button>
    </form>
    <p class="mt-1">Don't have an account? <a href="/register">Register</a></p>`;
  return layout(config, user, "Login", body);
}
