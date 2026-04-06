import { layout, escapeHtml, formatDate } from "../template.js";

export function renderMessagesInbox(config, user, messages, page, totalMessages, perPage, extras = {}) {
  let body = `<h1>Messages</h1>`;

  body += `<div class="tab-nav">
    <a href="/messages" class="active">Inbox</a>
    <a href="/messages/sent">Sent</a>
    <a href="/messages/new" class="btn" style="margin-left:auto;">+ New Message</a>
  </div>`;

  if (messages.length === 0) {
    body += `<p class="meta">No messages in your inbox.</p>`;
    return layout(config, user, "Inbox", body, extras);
  }

  for (const m of messages) {
    const unread = !m.read_at;
    body += `
      <div class="message-row${unread ? " unread" : ""}">
        <div style="display:flex; justify-content:space-between; flex-wrap:wrap;">
          <span>
            ${unread ? "<strong>" : ""}
            <a href="/messages/${m.id}">${escapeHtml(m.subject)}</a>
            ${unread ? "</strong>" : ""}
          </span>
          <span class="meta">${formatDate(m.created_at)}</span>
        </div>
        <div class="meta">From: <a href="/u/${escapeHtml(m.sender_username)}">${escapeHtml(m.sender_username)}</a></div>
      </div>`;
  }

  // Pagination
  const totalPages = Math.max(1, Math.ceil(totalMessages / perPage));
  if (totalPages > 1) {
    body += '<div style="margin-top:1rem;">';
    if (page > 1) body += `<a href="/messages?page=${page - 1}">[&lt; Prev]</a> `;
    body += `Page ${page} of ${totalPages}`;
    if (page < totalPages) body += ` <a href="/messages?page=${page + 1}">[Next &gt;]</a>`;
    body += '</div>';
  }

  return layout(config, user, "Inbox", body, extras);
}
