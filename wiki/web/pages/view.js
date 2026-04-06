import { layout, escapeHtml, formatDate } from "../template.js";
import { renderMarkdown } from "../markdown.js";

export function viewPage(config, loggedIn, page, sidebar) {
  const actions = loggedIn
    ? `<div class="page-actions"><a href="/wiki/${escapeHtml(page.slug)}/edit" class="btn">Edit</a></div>`
    : "";

  const body = `
    ${actions}
    <div class="wiki-body">${renderMarkdown(page.content)}</div>
    <p class="meta" style="margin-top: 1rem;">Last modified: ${formatDate(page.modified)}</p>
  `;
  return layout(config, loggedIn, page.title, body, { sidebar });
}
