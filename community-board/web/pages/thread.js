import { layout, escapeHtml, csrfField } from "../template.js";
import { breadcrumb } from "../partials/nav.js";
import { pagination } from "../partials/pagination.js";
import { postCard } from "../partials/post-card.js";

export function renderThread(config, user, thread, posts, page, totalPosts, perPage, extras = {}) {
  const csrfToken = extras.csrfToken;
  let body = breadcrumb([
    { label: "Home", href: "/" },
    { label: thread.category_name, href: `/c/${thread.category_slug}` },
    { label: thread.title },
  ]);

  const tags = [
    thread.is_pinned ? '<span class="pinned-tag">[PINNED]</span>' : "",
    thread.is_locked ? '<span class="locked-tag">[LOCKED]</span>' : "",
  ].filter(Boolean).join(" ");

  body += `<h1>${tags} ${escapeHtml(thread.title)}</h1>`;

  const startIndex = (page - 1) * perPage + 1;
  for (let i = 0; i < posts.length; i++) {
    body += postCard(posts[i], startIndex + i, user, thread, csrfToken);
  }

  body += pagination(`/c/${thread.category_slug}/t/${thread.id}`, page, totalPosts, perPage);

  // Reply form
  if (user && !thread.is_locked) {
    body += `
      <h2 class="mt-1" id="reply-heading">Reply</h2>
      <form method="POST" action="/c/${escapeHtml(thread.category_slug)}/t/${thread.id}/reply" enctype="multipart/form-data" id="reply-form">
        ${csrfField(csrfToken)}
        <input type="hidden" name="parent_post_id" id="parent_post_id" value="">
        <div id="reply-context" style="display:none; margin-bottom:0.5rem; padding:0.5rem; border-left:2px solid #00ff41; color:#8b949e;">
        </div>
        <div class="form-group">
          <textarea name="body" id="reply-body" required placeholder="Write your reply..."></textarea>
          <span class="meta">Markdown supported</span>
        </div>
        <div class="form-group">
          <label for="images">Attach Images:</label>
          <input type="file" id="images" name="images" multiple accept="image/*">
          <span class="meta">(max 5 images, 5MB each)</span>
        </div>
        <button type="submit" class="btn">Post Reply</button>
        <button type="button" class="btn" id="cancel-reply" style="display:none; margin-left:0.5rem;" onclick="cancelReply()">Cancel Reply</button>
      </form>
      <script>
        function replyTo(postId, username, snippet) {
          document.getElementById('parent_post_id').value = postId;
          var ctx = document.getElementById('reply-context');
          ctx.style.display = 'block';
          ctx.innerHTML = '<strong>Replying to @' + username + ' (#' + postId + ')</strong><br>' + snippet;
          document.getElementById('cancel-reply').style.display = 'inline-block';
          var ta = document.getElementById('reply-body');
          ta.value = '> @' + username + ' wrote:\\n> ' + snippet.substring(0, 200).replace(/\\n/g, '\\n> ') + '\\n\\n';
          ta.focus();
          document.getElementById('reply-heading').scrollIntoView({ behavior: 'smooth' });
        }
        function cancelReply() {
          document.getElementById('parent_post_id').value = '';
          document.getElementById('reply-context').style.display = 'none';
          document.getElementById('cancel-reply').style.display = 'none';
          document.getElementById('reply-body').value = '';
        }
      </script>`;
  } else if (thread.is_locked) {
    body += `<p class="meta mt-1">This thread is locked. No new replies can be posted.</p>`;
  } else {
    body += `<p class="mt-1"><a href="/login">Login</a> to reply.</p>`;
  }

  return layout(config, user, thread.title, body, extras);
}
