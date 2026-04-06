import { layout, escapeHtml, formatDate } from "../template.js";
import { breadcrumb } from "../partials/nav.js";
import { pagination } from "../partials/pagination.js";

export function renderCategory(config, user, category, threads, page, totalThreads, perPage, extras = {}) {
  let body = breadcrumb([
    { label: "Home", href: "/" },
    { label: category.name },
  ]);

  body += `<h1>${escapeHtml(category.name)}</h1>`;
  if (category.description) {
    body += `<p class="meta">${escapeHtml(category.description)}</p>`;
  }

  if (user) {
    body += `<p class="mt-1"><a href="/c/${escapeHtml(category.slug)}/new" class="btn">+ New Thread</a></p>`;
  }

  if (threads.length === 0) {
    body += `<p class="mt-1">No threads yet. Be the first to post!</p>`;
    return layout(config, user, category.name, body, extras);
  }

  body += `
    <table>
      <thead>
        <tr>
          <th>Thread</th>
          <th>Author</th>
          <th class="text-right">Replies</th>
          <th>Last Post</th>
        </tr>
      </thead>
      <tbody>`;

  for (const t of threads) {
    const tags = [
      t.is_pinned ? '<span class="pinned-tag">[PIN]</span>' : "",
      t.is_locked ? '<span class="locked-tag">[LOCK]</span>' : "",
    ].filter(Boolean).join(" ");

    body += `
        <tr>
          <td>
            ${tags}
            <a href="/c/${escapeHtml(category.slug)}/t/${t.id}">${escapeHtml(t.title)}</a>
          </td>
          <td><a href="/u/${escapeHtml(t.author)}">${escapeHtml(t.author)}</a></td>
          <td class="text-right">${t.reply_count}</td>
          <td class="meta">${formatDate(t.last_post_at)}</td>
        </tr>`;
  }

  body += `
      </tbody>
    </table>`;

  body += pagination(`/c/${category.slug}`, page, totalThreads, perPage);

  return layout(config, user, category.name, body, extras);
}
