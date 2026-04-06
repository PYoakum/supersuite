/**
 * Minimal server-side templating using template literals.
 * No dependencies — just functions that return HTML strings.
 */

/** Escape HTML entities */
export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Short alias */
export const h = escapeHtml;

/** Main layout wrapper */
export function layout({ title = "Nonprofit CRM", content = "", flash = "", user = null, activePath = "" }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${h(title)}</title>
  <link rel="stylesheet" href="/css/app.css">
</head>
<body>
  ${user ? navPartial({ user, activePath }) : ""}
  <main class="container">
    ${flash ? flashPartial(flash) : ""}
    ${content}
  </main>
  <script src="/js/app.js"></script>
</body>
</html>`;
}

/** Navigation bar */
export function navPartial({ user, activePath = "" }) {
  const links = [
    { href: "/", label: "Dashboard" },
    { href: "/contacts", label: "Contacts" },
    { href: "/organizations", label: "Organizations" },
    { href: "/donations", label: "Donations" },
    { href: "/memberships/renewals", label: "Memberships" },
    { href: "/segments", label: "Segments" },
  ];

  if (user?.role === "admin") {
    links.push({ href: "/admin/settings", label: "Admin" });
  }

  const linkHtml = links
    .map(
      (l) =>
        `<a href="${l.href}" class="nav-link${activePath.startsWith(l.href) && l.href !== "/" ? " active" : activePath === l.href ? " active" : ""}">${h(l.label)}</a>`
    )
    .join("\n        ");

  return `
  <nav class="main-nav">
    <div class="nav-brand">Nonprofit CRM</div>
    <div class="nav-links">
      ${linkHtml}
    </div>
    <div class="nav-user">
      <span>${h(user.email)}</span>
      <form method="POST" action="/logout" style="display:inline">
        <button type="submit" class="btn btn-sm btn-outline">Logout</button>
      </form>
    </div>
  </nav>`;
}

/** Flash message */
export function flashPartial(flash) {
  if (!flash) return "";
  const type = flash.type || "info";
  return `<div class="flash flash-${h(type)}">${h(flash.message)}</div>`;
}

/** Generic table partial */
export function tablePartial({ columns, rows, emptyMessage = "No records found." }) {
  if (!rows || rows.length === 0) {
    return `<p class="empty-state">${h(emptyMessage)}</p>`;
  }
  const headerHtml = columns.map((c) => `<th>${h(c.label)}</th>`).join("");
  const bodyHtml = rows
    .map(
      (row) =>
        `<tr>${columns.map((c) => `<td>${c.render ? c.render(row) : h(row[c.key])}</td>`).join("")}</tr>`
    )
    .join("\n");

  return `
  <table class="data-table">
    <thead><tr>${headerHtml}</tr></thead>
    <tbody>${bodyHtml}</tbody>
  </table>`;
}

/** Form field with error display */
export function fieldPartial({ label, name, type = "text", value = "", error = "", required = false, options = null, placeholder = "" }) {
  const id = `field-${name}`;
  let input;

  if (options) {
    const opts = options
      .map((o) => `<option value="${h(o.value)}"${o.value === value ? " selected" : ""}>${h(o.label)}</option>`)
      .join("");
    input = `<select name="${h(name)}" id="${id}"${required ? " required" : ""}>${opts}</select>`;
  } else if (type === "textarea") {
    input = `<textarea name="${h(name)}" id="${id}" rows="4"${required ? " required" : ""} placeholder="${h(placeholder)}">${h(value)}</textarea>`;
  } else {
    input = `<input type="${h(type)}" name="${h(name)}" id="${id}" value="${h(value)}"${required ? " required" : ""} placeholder="${h(placeholder)}">`;
  }

  return `
  <div class="form-group${error ? " has-error" : ""}">
    <label for="${id}">${h(label)}${required ? ' <span class="required">*</span>' : ""}</label>
    ${input}
    ${error ? `<span class="field-error">${h(error)}</span>` : ""}
  </div>`;
}

/** Pagination partial */
export function paginationPartial({ currentPage, totalPages, baseUrl }) {
  if (totalPages <= 1) return "";
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    const sep = baseUrl.includes("?") ? "&" : "?";
    const active = i === currentPage ? ' class="active"' : "";
    pages.push(`<a href="${baseUrl}${sep}page=${i}"${active}>${i}</a>`);
  }
  return `<div class="pagination">${pages.join(" ")}</div>`;
}

/** HTML response helper */
export function htmlResponse(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...headers },
  });
}

/** JSON response helper */
export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Redirect helper */
export function redirect(url, status = 302) {
  return new Response(null, {
    status,
    headers: { Location: url },
  });
}
