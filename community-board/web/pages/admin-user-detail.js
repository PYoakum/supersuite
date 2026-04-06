import { layout, escapeHtml, formatDate, csrfField } from "../template.js";

export function renderAdminUserDetail(config, user, target, recentPosts, loginLog, modLog, extras = {}, error = null, success = null) {
  const csrfToken = extras.csrfToken;
  let body = `<h1>User: ${escapeHtml(target.username)}</h1>`;
  body += `<p><a href="/admin/users">&lt; Back to Users</a> | <a href="/u/${escapeHtml(target.username)}">View Profile</a></p>`;

  if (error) {
    body += `<div class="alert alert-error">${escapeHtml(error)}</div>`;
  }
  if (success) {
    body += `<div class="alert alert-success">${escapeHtml(success)}</div>`;
  }

  // User info
  body += `
    <table>
      <tr><td>ID</td><td>${target.id}</td></tr>
      <tr><td>Role</td><td>${escapeHtml(target.role)}</td></tr>
      <tr><td>Posts</td><td>${target.post_count}</td></tr>
      <tr><td>Joined</td><td>${formatDate(target.created_at)}</td></tr>
      <tr><td>Can Post</td><td>${target.can_post ? '<span style="color:#00ff41;">Yes</span>' : '<span style="color:#f85149;">No</span>'}</td></tr>
      <tr><td>Can Create Threads</td><td>${target.can_create_threads ? '<span style="color:#00ff41;">Yes</span>' : '<span style="color:#f85149;">No</span>'}</td></tr>
      <tr><td>Suspended Until</td><td>${target.suspended_until && new Date(target.suspended_until) > new Date() ? `<span style="color:#f85149;">${formatDate(target.suspended_until)}</span>` : '<span style="color:#00ff41;">Not suspended</span>'}</td></tr>
      ${target.suspension_reason ? `<tr><td>Suspension Reason</td><td>${escapeHtml(target.suspension_reason)}</td></tr>` : ""}
    </table>`;

  // Restriction toggles
  body += `
    <h2 class="mt-1">Restrictions</h2>
    <form method="POST" action="/admin/users/${target.id}/restrict" style="display:flex; gap:1rem; flex-wrap:wrap; align-items:center;">
      ${csrfField(csrfToken)}
      <label style="display:flex; align-items:center; gap:0.25rem;">
        <input type="checkbox" name="can_post" value="1" ${target.can_post ? "checked" : ""}> Can Post
      </label>
      <label style="display:flex; align-items:center; gap:0.25rem;">
        <input type="checkbox" name="can_create_threads" value="1" ${target.can_create_threads ? "checked" : ""}> Can Create Threads
      </label>
      <button type="submit" class="btn">Update Restrictions</button>
    </form>`;

  // Suspension form
  const isSuspended = target.suspended_until && new Date(target.suspended_until) > new Date();
  body += `
    <h2 class="mt-1">Suspension</h2>`;

  if (isSuspended) {
    body += `
      <p>Currently suspended until ${formatDate(target.suspended_until)}</p>
      <form method="POST" action="/admin/users/${target.id}/suspend">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="unsuspend">
        <button type="submit" class="btn">Unsuspend User</button>
      </form>`;
  } else {
    body += `
      <form method="POST" action="/admin/users/${target.id}/suspend">
        ${csrfField(csrfToken)}
        <div class="form-group">
          <label for="hours">Suspend for (hours):</label>
          <input type="number" id="hours" name="hours" value="24" min="1" style="width:120px;">
        </div>
        <div class="form-group">
          <label for="reason">Reason:</label>
          <input type="text" id="reason" name="reason" placeholder="Reason for suspension">
        </div>
        <button type="submit" class="btn btn-danger">Suspend User</button>
      </form>`;
  }

  // Recent posts
  if (recentPosts.length > 0) {
    body += `<h2 class="mt-1">Recent Posts</h2>`;
    for (const p of recentPosts) {
      body += `
        <div style="border:1px solid #21262d; margin-bottom:0.5rem; padding:0.5rem;">
          <div class="meta">
            In <a href="/c/${escapeHtml(p.category_slug)}/t/${p.thread_id}">${escapeHtml(p.thread_title)}</a>
            | ${formatDate(p.created_at)}
          </div>
          <div style="white-space:pre-wrap; word-wrap:break-word; margin-top:0.25rem;">${escapeHtml(p.body.substring(0, 200))}${p.body.length > 200 ? "..." : ""}</div>
        </div>`;
    }
  }

  // Login history
  if (loginLog.length > 0) {
    body += `<h2 class="mt-1">Login History</h2>
      <table>
        <thead><tr><th>Time</th><th>IP Address</th></tr></thead>
        <tbody>`;
    for (const l of loginLog) {
      body += `<tr><td class="meta">${formatDate(l.created_at)}</td><td>${escapeHtml(l.ip_address || "unknown")}</td></tr>`;
    }
    body += `</tbody></table>`;
  }

  // Moderation log
  if (modLog.length > 0) {
    body += `<h2 class="mt-1">Moderation Log</h2>
      <table>
        <thead><tr><th>Time</th><th>Admin</th><th>Action</th><th>Details</th></tr></thead>
        <tbody>`;
    for (const m of modLog) {
      body += `<tr>
        <td class="meta">${formatDate(m.created_at)}</td>
        <td>${escapeHtml(m.admin_username)}</td>
        <td>${escapeHtml(m.action)}</td>
        <td>${escapeHtml(m.details || "")}</td>
      </tr>`;
    }
    body += `</tbody></table>`;
  }

  return layout(config, user, `User: ${target.username}`, body, extras);
}
