import { layout, escapeHtml, formatDate } from "../template.js";

export function listPage(config, loggedIn, pages) {
  const rows = pages.map(p => `
    <tr>
      <td><a href="/wiki/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a></td>
      <td class="meta">${formatDate(p.modified)}</td>
    </tr>
  `).join("");

  const body = `
    <h1>All Pages</h1>
    <table>
      <thead><tr><th>Page</th><th>Last Modified</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="2">No pages yet.</td></tr>'}</tbody>
    </table>
  `;
  return layout(config, loggedIn, "All Pages", body);
}
