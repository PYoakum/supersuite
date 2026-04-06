import { layout, escapeHtml } from "../template.js";

export function renderRegister(config, user, error = null) {
  let body = "<h1>Register</h1>";
  if (error) {
    body += `<div class="alert alert-error">${escapeHtml(error)}</div>`;
  }
  body += `
    <form method="POST" action="/register">
      <div class="form-group">
        <label for="username">Username:</label>
        <input type="text" id="username" name="username" required autofocus
               minlength="${config.registration.min_username_length}"
               maxlength="${config.registration.max_username_length}"
               pattern="[a-zA-Z0-9_-]+">
      </div>
      <div class="form-group">
        <label for="password">Password:</label>
        <input type="password" id="password" name="password" required
               minlength="${config.registration.min_password_length}">
      </div>
      <div class="form-group">
        <label for="confirm">Confirm Password:</label>
        <input type="password" id="confirm" name="confirm" required>
      </div>
      <button type="submit" class="btn">Register</button>
    </form>
    <p class="mt-1">Already have an account? <a href="/login">Login</a></p>`;
  return layout(config, user, "Register", body);
}
