import { layout, escapeHtml } from "../template.js";

export function notFoundPage(config, loggedIn, slug) {
  const body = `
    <h1>Page Not Found</h1>
    <p>The page <code>${escapeHtml(slug || "")}</code> does not exist.</p>
    ${loggedIn && slug ? `<p><a href="/wiki/${escapeHtml(slug)}/edit" class="btn">Create this page</a></p>` : ""}
    <p><a href="/wiki/home">Back to home</a></p>
  `;
  return layout(config, loggedIn, "Not Found", body);
}

export function errorPage(config, loggedIn, message) {
  const body = `
    <h1>Error</h1>
    <div class="alert alert-error">${escapeHtml(message)}</div>
    <p><a href="/wiki/home">Back to home</a></p>
  `;
  return layout(config, loggedIn, "Error", body);
}
