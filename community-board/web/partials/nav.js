import { escapeHtml } from "../template.js";

export function breadcrumb(parts) {
  const items = parts.map((p, i) => {
    if (i === parts.length - 1) {
      return escapeHtml(p.label);
    }
    return `<a href="${escapeHtml(p.href)}">${escapeHtml(p.label)}</a>`;
  });
  return `<div class="breadcrumb">${items.join(" &gt; ")}</div>`;
}
