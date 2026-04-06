import { layout, escapeHtml, csrfField } from "../template.js";

export function renderMessagesCompose(config, user, extras = {}, prefillTo = "", error = null) {
  const csrfToken = extras.csrfToken;
  let body = `<h1>New Message</h1>`;
  body += `<p><a href="/messages">&lt; Back to Inbox</a></p>`;

  if (error) {
    body += `<div class="alert alert-error">${escapeHtml(error)}</div>`;
  }

  const maxBody = config.messaging?.max_body_length ?? 10000;

  body += `
    <form method="POST" action="/messages/new">
      ${csrfField(csrfToken)}
      <div class="form-group">
        <label for="to">To:</label>
        <input type="text" id="to" name="to" required value="${escapeHtml(prefillTo)}" placeholder="username" autofocus>
      </div>
      <div class="form-group">
        <label for="subject">Subject:</label>
        <input type="text" id="subject" name="subject" required maxlength="256">
      </div>
      <div class="form-group">
        <label for="body">Message:</label>
        <textarea id="body" name="body" required maxlength="${maxBody}" placeholder="Write your message..."></textarea>
        <span class="meta">(max ${maxBody} characters)</span>
      </div>
      <button type="submit" class="btn">Send Message</button>
    </form>`;

  return layout(config, user, "New Message", body, extras);
}
