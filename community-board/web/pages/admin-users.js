import { layout, escapeHtml, formatDate } from "../template.js";

export function renderAdminUsers(config, user, users, query, page, totalUsers, perPage, extras = {}) {
  let body = `<h1>User Moderation</h1>`;
  body += `<p><a href="/admin">&lt; Back to Admin</a></p>`;

  // Search form
  body += `
    <form method="GET" action="/admin/users" style="margin:1rem 0; display:flex; gap:0.5rem;">
      <input type="text" name="q" value="${escapeHtml(query || "")}" placeholder="Search by username..." style="padding:0.5rem; background:#161b22; border:1px solid #30363d; color:#c9d1d9; font-family:inherit; flex:1;">
      <button type="submit" class="btn">Search</button>
    </form>`;

  if (users.length === 0) {
    body += `<p class="meta">No users found.</p>`;
    return layout(config, user, "User Moderation", body, extras);
  }

  body += `
    <table>
      <thead>
        <tr>
          <th>Username</th>
          <th>Role</th>
          <th class="text-right">Posts</th>
          <th>Status</th>
          <th>Joined</th>
        </tr>
      </thead>
      <tbody>`;

  for (const u of users) {
    const flags = [];
    if (!u.can_post) flags.push('<span style="color:#f85149;">no-post</span>');
    if (!u.can_create_threads) flags.push('<span style="color:#f85149;">no-threads</span>');
    if (u.suspended_until && new Date(u.suspended_until) > new Date()) {
      flags.push('<span style="color:#f85149;">suspended</span>');
    }

    body += `
        <tr>
          <td><a href="/admin/users/${u.id}">${escapeHtml(u.username)}</a></td>
          <td>${escapeHtml(u.role)}</td>
          <td class="text-right">${u.post_count}</td>
          <td>${flags.length ? flags.join(", ") : '<span style="color:#00ff41;">active</span>'}</td>
          <td class="meta">${formatDate(u.created_at)}</td>
        </tr>`;
  }

  body += `
      </tbody>
    </table>`;

  // Pagination
  const totalPages = Math.max(1, Math.ceil(totalUsers / perPage));
  if (totalPages > 1) {
    const baseUrl = query ? `/admin/users?q=${encodeURIComponent(query)}` : "/admin/users";
    const sep = query ? "&" : "?";
    body += '<div style="margin-top:1rem;">';
    if (page > 1) body += `<a href="${baseUrl}${sep}page=${page - 1}">[&lt; Prev]</a> `;
    body += `Page ${page} of ${totalPages}`;
    if (page < totalPages) body += ` <a href="${baseUrl}${sep}page=${page + 1}">[Next &gt;]</a>`;
    body += '</div>';
  }

  return layout(config, user, "User Moderation", body, extras);
}
