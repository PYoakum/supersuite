import { layout, escapeHtml, csrfField } from "../template.js";

export function renderSettings(config, user, avatar, extras = {}, error = null) {
  const csrfToken = extras.csrfToken;
  let body = `<h1>Settings</h1>`;

  if (error) {
    body += `<div class="alert alert-error">${escapeHtml(error)}</div>`;
  }

  body += `<h2>Avatar</h2>`;

  if (avatar) {
    body += `
      <div style="margin-bottom:1rem;">
        <img src="/avatar/${user.id}" alt="Current avatar" style="width:96px; height:96px; object-fit:cover; border:1px solid #30363d; border-radius:4px;">
      </div>`;
  } else {
    body += `
      <div style="margin-bottom:1rem;">
        <div class="avatar-placeholder" style="width:96px; height:96px; background:#161b22; border:1px solid #30363d; border-radius:4px; display:flex; align-items:center; justify-content:center; color:#484f58; font-size:2rem;">?</div>
      </div>`;
  }

  body += `
    <form method="POST" action="/settings/avatar" enctype="multipart/form-data">
      ${csrfField(csrfToken)}
      <div class="form-group">
        <label for="avatar">Upload Avatar:</label>
        <input type="file" id="avatar" name="avatar" accept="image/*">
        <span class="meta">(max ${config.uploads?.max_avatar_size_mb ?? 2}MB — JPEG, PNG, GIF, WebP)</span>
      </div>
      <button type="submit" class="btn">Upload Avatar</button>
    </form>`;

  if (avatar) {
    body += `
      <form method="POST" action="/settings/avatar/delete" style="margin-top:0.5rem;">
        ${csrfField(csrfToken)}
        <button type="submit" class="btn btn-danger">Delete Avatar</button>
      </form>`;
  }

  return layout(config, user, "Settings", body, extras);
}
