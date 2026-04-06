import { layout, escapeHtml, formatDate } from "../template.js";

export function renderMessagesSent(config, user, messages, page, totalMessages, perPage, extras = {}) {
  let body = `<h1>Messages</h1>`;

  body += `<div class="tab-nav">
    <a href="/messages">Inbox</a>
    <a href="/messages/sent" class="active">Sent</a>
    <a href="/messages/new" class="btn" style="margin-left:auto;">+ New Message</a>
  </div>`;

  if (messages.length === 0) {
    body += `<p class="meta">No sent messages.</p>`;
    return layout(config, user, "Sent Messages", body, extras);
  }

  for (const m of messages) {
    body += `
      <div class="message-row">
        <div style="display:flex; justify-content:space-between; flex-wrap:wrap;">
          <span><a href="/messages/${m.id}">${escapeHtml(m.subject)}</a></span>
          <span class="meta">${formatDate(m.created_at)}</span>
        </div>
        <div class="meta">To: <a href="/u/${escapeHtml(m.recipient_username)}">${escapeHtml(m.recipient_username)}</a>${m.read_at ? ' <span style="color:#00ff41;">(read)</span>' : ' <span style="color:#484f58;">(unread)</span>'}</div>
      </div>`;
  }

  // Pagination
  const totalPages = Math.max(1, Math.ceil(totalMessages / perPage));
  if (totalPages > 1) {
    body += '<div style="margin-top:1rem;">';
    if (page > 1) body += `<a href="/messages/sent?page=${page - 1}">[&lt; Prev]</a> `;
    body += `Page ${page} of ${totalPages}`;
    if (page < totalPages) body += ` <a href="/messages/sent?page=${page + 1}">[Next &gt;]</a>`;
    body += '</div>';
  }

  return layout(config, user, "Sent Messages", body, extras);
}
