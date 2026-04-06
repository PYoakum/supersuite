export function pagination(basePath, currentPage, totalItems, perPage) {
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  if (totalPages <= 1) return "";

  let html = '<div class="pagination" style="margin-top:1rem;">';
  if (currentPage > 1) {
    html += `<a href="${basePath}?page=${currentPage - 1}">[&lt; Prev]</a> `;
  }
  html += `Page ${currentPage} of ${totalPages}`;
  if (currentPage < totalPages) {
    html += ` <a href="${basePath}?page=${currentPage + 1}">[Next &gt;]</a>`;
  }
  html += "</div>";
  return html;
}
