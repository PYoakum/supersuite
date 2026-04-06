import { layout, escapeHtml, formatDate, csrfField } from "../template.js";
import { renderMarkdown } from "../markdown.js";

export function renderMessageView(config, user, message, extras = {}) {
  const csrfToken = extras.csrfToken;
  const isSender = user.id === message.sender_id;
  const isRecipient = user.id === message.recipient_id;

  let body = `<h1>${escapeHtml(message.subject)}</h1>`;
  body += `<p><a href="/messages">&lt; Back to Inbox</a></p>`;

  body += `
    <div style="border:1px solid #21262d; margin-bottom:1rem;">
      <div style="background:#161b22; padding:0.5rem 0.75rem; display:flex; justify-content:space-between; flex-wrap:wrap;">
        <span>
          From: <a href="/u/${escapeHtml(message.sender_username)}">${escapeHtml(message.sender_username)}</a>
          &rarr; To: <a href="/u/${escapeHtml(message.recipient_username)}">${escapeHtml(message.recipient_username)}</a>
        </span>
        <span class="meta">${formatDate(message.created_at)}</span>
      </div>
      <div class="post-body" style="padding:0.75rem; word-wrap:break-word;">${renderMarkdown(message.body)}</div>
    </div>`;

  // Actions
  body += `<div style="display:flex; gap:0.5rem; flex-wrap:wrap;">`;

  if (isRecipient) {
    body += `<a href="/messages/new?to=${encodeURIComponent(message.sender_username)}" class="btn">Reply</a>`;
  }

  body += `
    <form method="POST" action="/messages/${message.id}/delete" class="inline-form">
      ${csrfField(csrfToken)}
      <button type="submit" class="btn btn-danger" onclick="return confirm('Delete this message?')">Delete</button>
    </form>`;

  body += `</div>`;

  return layout(config, user, message.subject, body, extras);
}
