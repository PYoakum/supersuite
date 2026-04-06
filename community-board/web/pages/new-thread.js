import { layout, escapeHtml, csrfField } from "../template.js";
import { breadcrumb } from "../partials/nav.js";

export function renderNewThread(config, user, category, extras = {}, error = null) {
  const csrfToken = extras.csrfToken;
  let body = breadcrumb([
    { label: "Home", href: "/" },
    { label: category.name, href: `/c/${category.slug}` },
    { label: "New Thread" },
  ]);

  body += `<h1>New Thread in ${escapeHtml(category.name)}</h1>`;

  if (error) {
    body += `<div class="alert alert-error">${escapeHtml(error)}</div>`;
  }

  const allowedTags = config.content_tags?.allowed || [];

  body += `
    <form method="POST" action="/c/${escapeHtml(category.slug)}/new" enctype="multipart/form-data">
      ${csrfField(csrfToken)}
      <div class="form-group">
        <label for="title">Title:</label>
        <input type="text" id="title" name="title" required maxlength="256" autofocus>
      </div>`;

  if (allowedTags.length > 0) {
    body += `
      <div class="form-group">
        <label for="content_tag">Tag:</label>
        <select id="content_tag" name="content_tag">
          <option value="">-- None --</option>
          ${allowedTags.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("")}
        </select>
      </div>`;
  }

  body += `
      <div class="form-group">
        <label for="body">Message:</label>
        <textarea id="body" name="body" required></textarea>
        <span class="meta">Markdown supported</span>
      </div>
      <div class="form-group">
        <label for="images">Attach Images:</label>
        <input type="file" id="images" name="images" multiple accept="image/*">
        <span class="meta">(max 5 images, 5MB each)</span>
      </div>
      <button type="submit" class="btn">Create Thread</button>
    </form>`;

  return layout(config, user, "New Thread", body, extras);
}
