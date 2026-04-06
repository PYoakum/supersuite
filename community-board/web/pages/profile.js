import { layout, escapeHtml, formatDate } from "../template.js";

export function renderProfile(config, user, profile, recentPosts, extras = {}, tab = "posts", savedPosts = []) {
  const isOwner = user && user.id === profile.id;

  let body = `
    <div style="display:flex; align-items:center; gap:1rem; margin-bottom:0.5rem;">
      <img src="/avatar/${profile.id}" alt="" style="width:96px; height:96px; object-fit:cover; border-radius:4px; border:1px solid #30363d;" onerror="this.style.display='none'">
      <h1 style="margin:0;">${escapeHtml(profile.username)}</h1>
    </div>`;

  body += `
    <table>
      <tr><td>Role</td><td>${escapeHtml(profile.role)}</td></tr>
      <tr><td>Posts</td><td>${profile.post_count}</td></tr>
      <tr><td>Joined</td><td>${formatDate(profile.created_at)}</td></tr>
    </table>`;

  // Tab navigation
  body += `<div class="tab-nav mt-1">`;
  body += `<a href="/u/${escapeHtml(profile.username)}" class="${tab === "posts" ? "active" : ""}">Recent Posts</a>`;
  if (isOwner) {
    body += `<a href="/u/${escapeHtml(profile.username)}?tab=saved" class="${tab === "saved" ? "active" : ""}">Saved Posts</a>`;
  }
  body += `</div>`;

  if (tab === "saved" && isOwner) {
    if (savedPosts.length === 0) {
      body += `<p class="meta">No saved posts yet.</p>`;
    } else {
      for (const p of savedPosts) {
        body += `
          <div style="border:1px solid #21262d; margin-bottom:0.5rem; padding:0.5rem;">
            <div class="meta">
              <a href="/u/${escapeHtml(p.username)}">${escapeHtml(p.username)}</a>
              in <a href="/c/${escapeHtml(p.category_slug)}/t/${p.thread_id}">${escapeHtml(p.thread_title)}</a>
              | saved ${formatDate(p.saved_at)}
            </div>
            <div style="white-space:pre-wrap; word-wrap:break-word; margin-top:0.25rem;">${escapeHtml(p.body.substring(0, 200))}${p.body.length > 200 ? "..." : ""}</div>
          </div>`;
      }
    }
  } else {
    if (recentPosts.length === 0) {
      body += `<p class="meta">No posts yet.</p>`;
    } else {
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
  }

  return layout(config, user, profile.username, body, extras);
}
