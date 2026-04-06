import { layout, escapeHtml } from "../template.js";

export function renderHome(config, user, categories, extras = {}) {
  let body = `<h1>${escapeHtml(config.site.name)}</h1>`;
  body += `<p class="meta">${escapeHtml(config.site.description)}</p>`;

  if (categories.length === 0) {
    body += `<p class="mt-1">No categories yet.${user?.role === "admin" ? ' <a href="/admin">Create one</a>.' : ""}</p>`;
    return layout(config, user, null, body, extras);
  }

  body += `
    <table>
      <thead>
        <tr>
          <th>Category</th>
          <th class="text-right">Threads</th>
          <th class="text-right">Posts</th>
        </tr>
      </thead>
      <tbody>`;

  for (const c of categories) {
    body += `
        <tr>
          <td>
            <a href="/c/${escapeHtml(c.slug)}">${escapeHtml(c.name)}</a>
            ${c.description ? `<br><span class="meta">${escapeHtml(c.description)}</span>` : ""}
          </td>
          <td class="text-right">${c.thread_count}</td>
          <td class="text-right">${c.post_count}</td>
        </tr>`;
  }

  body += `
      </tbody>
    </table>`;

  return layout(config, user, null, body, extras);
}
