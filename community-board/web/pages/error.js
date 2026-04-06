import { layout, escapeHtml } from "../template.js";

const messages = {
  404: "The page you're looking for doesn't exist.",
  403: "You don't have permission to access this page.",
  500: "Something went wrong on the server.",
};

export function renderError(config, user, status, title) {
  const description = messages[status] || "An error occurred.";
  const body = `
    <h1>${status} - ${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
    <p class="mt-1"><a href="/">Return to home</a></p>`;
  return layout(config, user, title, body);
}
