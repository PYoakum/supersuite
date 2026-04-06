import { layout, escapeHtml, csrfField } from "../template.js";

export function renderAdmin(config, user, categories, extras = {}, error = null, success = null, currentBanner = null) {
  const csrfToken = extras.csrfToken;
  let body = `<h1>Admin Panel</h1>`;

  body += `<p><a href="/admin/users">[User Moderation]</a></p>`;

  if (error) {
    body += `<div class="alert alert-error">${escapeHtml(error)}</div>`;
  }
  if (success) {
    body += `<div class="alert alert-success">${escapeHtml(success)}</div>`;
  }

  // Notification banner section
  body += `
    <h2>Notification Banner</h2>
    <form method="POST" action="/admin/banner">
      ${csrfField(csrfToken)}
      <div class="form-group">
        <label for="banner">Banner text (Markdown supported):</label>
        <textarea id="banner" name="banner" style="min-height:80px;">${currentBanner ? escapeHtml(currentBanner) : ""}</textarea>
      </div>
      <button type="submit" class="btn">Save Banner</button>
      ${currentBanner ? `<button type="submit" name="action" value="clear" class="btn btn-danger" style="margin-left:0.5rem;">Clear Banner</button>` : ""}
    </form>`;

  // Create category form
  body += `
    <h2 class="mt-1">Create Category</h2>
    <form method="POST" action="/admin/categories">
      ${csrfField(csrfToken)}
      <div class="form-group">
        <label for="slug">Slug (URL-friendly):</label>
        <input type="text" id="slug" name="slug" required pattern="[a-z0-9-]+" placeholder="general">
      </div>
      <div class="form-group">
        <label for="name">Name:</label>
        <input type="text" id="name" name="name" required placeholder="General Discussion">
      </div>
      <div class="form-group">
        <label for="description">Description:</label>
        <input type="text" id="description" name="description" placeholder="A place for general chat">
      </div>
      <div class="form-group">
        <label for="position">Position (sort order):</label>
        <input type="number" id="position" name="position" value="0">
      </div>
      <button type="submit" class="btn">Create Category</button>
    </form>`;

  // Existing categories
  if (categories.length > 0) {
    body += `<h2 class="mt-1">Existing Categories</h2>`;
    for (const c of categories) {
      body += `
        <div style="border:1px solid #21262d; margin-bottom:0.75rem; padding:0.75rem;">
          <div><strong>${escapeHtml(c.name)}</strong> (/c/${escapeHtml(c.slug)}) - ${c.thread_count} threads, ${c.post_count} posts</div>
          <form method="POST" action="/admin/categories/${c.id}" style="margin-top:0.5rem; display:flex; gap:0.5rem; flex-wrap:wrap; align-items:end;">
            ${csrfField(csrfToken)}
            <div class="form-group" style="margin-bottom:0;">
              <label>Name:</label>
              <input type="text" name="name" value="${escapeHtml(c.name)}" style="width:auto;">
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label>Description:</label>
              <input type="text" name="description" value="${escapeHtml(c.description)}" style="width:auto;">
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label>Position:</label>
              <input type="number" name="position" value="${c.position}" style="width:80px;">
            </div>
            <button type="submit" class="btn">Update</button>
          </form>
          <form method="POST" action="/admin/categories/${c.id}" style="margin-top:0.25rem;">
            ${csrfField(csrfToken)}
            <input type="hidden" name="action" value="delete">
            <button type="submit" class="btn btn-danger" onclick="return confirm('Delete this category and all its threads?')">Delete</button>
          </form>
        </div>`;
    }
  }

  return layout(config, user, "Admin", body, extras);
}
