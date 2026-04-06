import { escapeHtml, formatDate, csrfField } from "../template.js";
import { renderMarkdown } from "../markdown.js";

export function postCard(post, index, currentUser, thread, csrfToken) {
  const canEdit = currentUser && !thread?.is_locked &&
    (post.user_id === currentUser.id || currentUser.role === "admin");

  const editLink = canEdit && thread
    ? ` | <a href="/c/${escapeHtml(thread.category_slug)}/t/${thread.id}/post/${post.id}/edit">[Edit]</a>`
    : "";

  const replyLink = currentUser && thread && !thread.is_locked
    ? ` | <a href="#reply-form" onclick="replyTo(${post.id}, '${escapeHtml(post.username).replace(/'/g, "\\'")}', '${escapeHtml((post.body || "").substring(0, 200)).replace(/'/g, "\\'").replace(/\n/g, " ")}')">[Reply]</a>`
    : "";

  const saveBtn = currentUser && thread
    ? ` | <form method="POST" action="/c/${escapeHtml(thread.category_slug)}/t/${thread.id}/post/${post.id}/save" class="inline-form">${csrfToken ? csrfField(csrfToken) : ""}<button type="submit" class="save-btn">${post._isSaved ? "[Unsave]" : "[Save]"}</button></form>`
    : "";

  const editedTag = post.updated_at
    ? ` <span class="meta">(edited ${formatDate(post.updated_at)})</span>`
    : "";

  const contentTagBadge = post.content_tag
    ? `<span class="content-tag-badge">[${escapeHtml(post.content_tag)}]</span> `
    : "";

  // Quote-tree block for replies
  let quoteBlock = "";
  if (post._parentId && post._parentUsername) {
    const snippet = escapeHtml((post._parentSnippet || "").substring(0, 200));
    quoteBlock = `
      <div class="quote-tree">
        <div class="qt-header">&nbsp;&#9492;&#9472;&#9472; Replying to @${escapeHtml(post._parentUsername)} (#${post._parentId})</div>
        <div class="qt-body">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&gt; ${snippet}${(post._parentSnippet || "").length > 200 ? "..." : ""}</div>
      </div>`;
  }

  return `
    <div class="post-card" id="post-${post.id}" style="border:1px solid #21262d; margin-bottom:1rem;">
      <div class="post-header" style="background:#161b22; padding:0.4rem 0.75rem; display:flex; justify-content:space-between; flex-wrap:wrap; align-items:center;">
        <span style="display:flex; align-items:center; gap:0.5rem;">
          <img src="/avatar/${post.user_id}" alt="" style="width:32px; height:32px; object-fit:cover; border-radius:4px; border:1px solid #30363d;" onerror="this.style.display='none'">
          <a href="/u/${escapeHtml(post.username)}">${escapeHtml(post.username)}</a>
          ${post.role === "admin" ? '<span style="color:#d29922;">[admin]</span>' : ""}
          ${contentTagBadge}
        </span>
        <span class="meta">#${index} | ${formatDate(post.created_at)}${editedTag}${editLink}${replyLink}${saveBtn}</span>
      </div>${quoteBlock}
      <div class="post-body" style="padding:0.75rem; word-wrap:break-word;">${renderMarkdown(post.body)}</div>${
        post.images?.length
          ? `<div class="post-images">${post.images
              .map(
                (img) =>
                  `<a href="/img/${img.id}" target="_blank" rel="noopener"><img src="/img/${img.id}" alt="${escapeHtml(img.filename)}" loading="lazy"></a>`
              )
              .join("")}</div>`
          : ""
      }
    </div>`;
}
