import { layout, escapeHtml } from "../template.js";

export function searchPage(config, loggedIn, query, results) {
  const resultsHtml = results === null
    ? ""
    : results.length === 0
      ? `<p>No results found for "${escapeHtml(query)}".</p>`
      : results.map(r => `
          <div style="margin-bottom: 1rem;">
            <a href="/wiki/${escapeHtml(r.slug)}">${escapeHtml(r.title)}</a>
            ${r.snippet ? `<div class="snippet">${escapeHtml(r.snippet)}</div>` : ""}
          </div>
        `).join("");

  const body = `
    <h1>Search</h1>
    <form method="GET" action="/search" style="margin-bottom: 1rem;">
      <div style="display: flex; gap: 0.5rem;">
        <input type="text" name="q" value="${escapeHtml(query || "")}"
               placeholder="Search pages..." style="flex:1; padding:0.5rem; background:#161b22; border:1px solid #30363d; color:#c9d1d9; font-family:inherit;">
        <button type="submit" class="btn">Search</button>
      </div>
    </form>
    ${resultsHtml}
  `;
  return layout(config, loggedIn, "Search", body);
}
