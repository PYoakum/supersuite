import { layout, escapeHtml, csrfField } from "../template.js";
import { breadcrumb } from "../partials/nav.js";

export function renderEditPost(config, user, thread, post, extras = {}, error = null) {
  const csrfToken = extras.csrfToken;
  let body = breadcrumb([
    { label: "Home", href: "/" },
    { label: thread.category_name, href: `/c/${thread.category_slug}` },
    { label: thread.title, href: `/c/${thread.category_slug}/t/${thread.id}` },
    { label: "Edit Post" },
  ]);

  body += `<h1>Edit Post</h1>`;

  if (error) {
    body += `<div class="alert alert-error">${escapeHtml(error)}</div>`;
  }

  const allowedTags = config.content_tags?.allowed || [];

  body += `
    <form method="POST" action="/c/${escapeHtml(thread.category_slug)}/t/${thread.id}/post/${post.id}/edit">
      ${csrfField(csrfToken)}`;

  if (allowedTags.length > 0) {
    body += `
      <div class="form-group">
        <label for="content_tag">Tag:</label>
        <select id="content_tag" name="content_tag">
          <option value="">-- None --</option>
          ${allowedTags.map((t) => `<option value="${escapeHtml(t)}"${post.content_tag === t ? " selected" : ""}>${escapeHtml(t)}</option>`).join("")}
        </select>
      </div>`;
  }

  body += `
      <div class="form-group">
        <label for="body">Message:</label>
        <textarea id="body" name="body" required>${escapeHtml(post.body)}</textarea>
        <span class="meta">Markdown supported</span>
      </div>
      <button type="submit" class="btn">Save Changes</button>
      <a href="/c/${escapeHtml(thread.category_slug)}/t/${thread.id}" style="margin-left:1rem;">Cancel</a>
    </form>`;

  return layout(config, user, "Edit Post", body, extras);
}
