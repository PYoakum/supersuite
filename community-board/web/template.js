const entityMap = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, (c) => entityMap[c]);
}

export function csrfField(token) {
  return `<input type="hidden" name="_csrf" value="${escapeHtml(token)}">`;
}

export function formatDate(date) {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().replace("T", " ").substring(0, 19) + " UTC";
}

export function layout(config, user, title, bodyHtml, extras = {}) {
  const { csrfToken, bannerHtml, unreadCount } = typeof extras === "object" && extras !== null ? extras : { csrfToken: extras };
  const siteName = escapeHtml(config.site.name);
  const pageTitle = title ? `${escapeHtml(title)} - ${siteName}` : siteName;

  const messagesLink = user
    ? `<a href="/messages">[Messages${unreadCount ? ` (${unreadCount})` : ""}]</a>`
    : "";

  const bannerBlock = bannerHtml
    ? `<div class="site-banner">${bannerHtml}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <style>${css}</style>
</head>
<body>
  <header>
    <nav>
      <a href="/" class="logo">${siteName}</a>
      <div class="nav-links">
        ${user
          ? `<span class="user-info">[ <a href="/u/${escapeHtml(user.username)}">${escapeHtml(user.username)}</a> ]</span>
             ${messagesLink}
             <a href="/settings">[Settings]</a>
             ${user.role === "admin" ? '<a href="/admin">[Admin]</a>' : ""}
             <form method="POST" action="/logout" class="inline-form">
               ${csrfToken ? csrfField(csrfToken) : ""}
               <button type="submit" class="link-btn">[Logout]</button>
             </form>`
          : `<a href="/login">[Login]</a> <a href="/register">[Register]</a>`
        }
      </div>
    </nav>
  </header>${bannerBlock}
  <main>${bodyHtml}</main>
  <footer>
    <div class="footer-line">--- ${siteName} ---</div>
  </footer>
</body>
</html>`;
}

const css = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Courier New', Courier, monospace;
    background: #0d1117;
    color: #c9d1d9;
    line-height: 1.6;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  a { color: #00ff41; text-decoration: none; }
  a:hover { text-decoration: underline; }
  header {
    border-bottom: 1px solid #00ff41;
    padding: 0.75rem 1rem;
  }
  nav {
    max-width: 960px;
    margin: 0 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .logo { font-size: 1.2rem; font-weight: bold; color: #00ff41; }
  .nav-links { display: flex; gap: 0.75rem; align-items: center; }
  .user-info { color: #58a6ff; }
  .inline-form { display: inline; }
  .link-btn {
    background: none; border: none; color: #00ff41;
    font-family: inherit; font-size: inherit; cursor: pointer; padding: 0;
  }
  .link-btn:hover { text-decoration: underline; }
  main {
    max-width: 960px;
    width: 100%;
    margin: 0 auto;
    padding: 1rem;
    flex: 1;
  }
  footer {
    border-top: 1px solid #00ff41;
    padding: 0.75rem 1rem;
    text-align: center;
    color: #484f58;
  }
  .footer-line { font-size: 0.85rem; }
  h1, h2, h3 { color: #00ff41; margin-bottom: 0.5rem; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.2rem; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
  }
  th, td {
    text-align: left;
    padding: 0.4rem 0.75rem;
    border: 1px solid #21262d;
  }
  th { background: #161b22; color: #00ff41; }
  tr:hover { background: #161b22; }
  .form-group { margin-bottom: 1rem; }
  .form-group label { display: block; color: #00ff41; margin-bottom: 0.25rem; }
  .form-group input, .form-group textarea, .form-group select {
    width: 100%;
    padding: 0.5rem;
    background: #161b22;
    border: 1px solid #30363d;
    color: #c9d1d9;
    font-family: inherit;
    font-size: 0.95rem;
  }
  .form-group textarea { min-height: 150px; resize: vertical; }
  .form-group input:focus, .form-group textarea:focus {
    outline: none;
    border-color: #00ff41;
  }
  .btn {
    display: inline-block;
    padding: 0.5rem 1rem;
    background: #161b22;
    color: #00ff41;
    border: 1px solid #00ff41;
    font-family: inherit;
    font-size: 0.95rem;
    cursor: pointer;
  }
  .btn:hover { background: #00ff41; color: #0d1117; }
  .btn-danger { border-color: #f85149; color: #f85149; }
  .btn-danger:hover { background: #f85149; color: #0d1117; }
  .alert { padding: 0.75rem; margin-bottom: 1rem; border: 1px solid; }
  .alert-error { border-color: #f85149; color: #f85149; }
  .alert-success { border-color: #00ff41; color: #00ff41; }
  .breadcrumb { margin-bottom: 1rem; color: #484f58; }
  .breadcrumb a { color: #58a6ff; }
  .pinned-tag { color: #d29922; font-size: 0.85rem; }
  .locked-tag { color: #f85149; font-size: 0.85rem; }
  .meta { color: #484f58; font-size: 0.85rem; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .mt-1 { margin-top: 1rem; }
  .post-images {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.75rem;
    border-top: 1px solid #21262d;
  }
  .post-images a {
    display: block;
    border: 1px solid #30363d;
    transition: border-color 0.2s;
  }
  .post-images a:hover { border-color: #00ff41; }
  .post-images img {
    display: block;
    max-width: 200px;
    max-height: 200px;
    object-fit: contain;
  }
  .form-group input[type="file"] {
    padding: 0.4rem;
    border: 1px dashed #30363d;
    background: #161b22;
    cursor: pointer;
  }
  .post-body h1, .post-body h2, .post-body h3,
  .post-body h4, .post-body h5, .post-body h6 {
    color: #00ff41;
    margin: 0.75rem 0 0.25rem;
  }
  .post-body h1 { font-size: 1.3rem; }
  .post-body h2 { font-size: 1.15rem; }
  .post-body h3 { font-size: 1.05rem; }
  .post-body p { margin: 0.4rem 0; }
  .post-body code {
    background: #161b22;
    padding: 0.15rem 0.35rem;
    border-radius: 3px;
    font-size: 0.9em;
    border: 1px solid #30363d;
  }
  .post-body pre {
    background: #161b22;
    padding: 0.75rem;
    border: 1px solid #30363d;
    overflow-x: auto;
    margin: 0.5rem 0;
  }
  .post-body pre code {
    background: none;
    padding: 0;
    border: none;
  }
  .post-body blockquote {
    border-left: 3px solid #00ff41;
    padding: 0.25rem 0.75rem;
    margin: 0.5rem 0;
    color: #8b949e;
  }
  .post-body ul, .post-body ol {
    margin: 0.4rem 0;
    padding-left: 1.5rem;
  }
  .post-body li { margin: 0.2rem 0; }
  .post-body table {
    border-collapse: collapse;
    margin: 0.5rem 0;
    width: auto;
  }
  .post-body th, .post-body td {
    border: 1px solid #30363d;
    padding: 0.3rem 0.6rem;
  }
  .post-body th { background: #161b22; color: #00ff41; }
  .post-body hr {
    border: none;
    border-top: 1px solid #30363d;
    margin: 0.75rem 0;
  }
  .post-body img { max-width: 100%; }
  .site-banner {
    max-width: 960px;
    margin: 0 auto;
    padding: 0.75rem 1rem;
    background: #1c2128;
    border-bottom: 1px solid #d29922;
    color: #d29922;
  }
  .site-banner p { margin: 0.25rem 0; }
  .content-tag-badge {
    display: inline-block;
    padding: 0.1rem 0.4rem;
    font-size: 0.8rem;
    color: #58a6ff;
    border: 1px solid #58a6ff;
    border-radius: 3px;
  }
  .quote-tree {
    border-left: 2px solid #00ff41;
    padding: 0.4rem 0.75rem;
    margin-bottom: 0.5rem;
    color: #8b949e;
    font-size: 0.9rem;
  }
  .quote-tree .qt-header { color: #58a6ff; margin-bottom: 0.25rem; }
  .quote-tree .qt-body { white-space: pre-wrap; word-wrap: break-word; }
  .tab-nav { display: flex; gap: 0; margin-bottom: 1rem; border-bottom: 1px solid #21262d; }
  .tab-nav a {
    padding: 0.5rem 1rem;
    border: 1px solid transparent;
    border-bottom: none;
    color: #8b949e;
    margin-bottom: -1px;
  }
  .tab-nav a.active {
    color: #00ff41;
    border-color: #21262d;
    background: #0d1117;
  }
  .tab-nav a:hover { color: #00ff41; text-decoration: none; }
  .message-row { border: 1px solid #21262d; margin-bottom: 0.5rem; padding: 0.5rem 0.75rem; }
  .message-row.unread { border-left: 3px solid #58a6ff; }
  .save-btn { background: none; border: none; color: #d29922; font-family: inherit; font-size: 0.85rem; cursor: pointer; padding: 0; }
  .save-btn:hover { text-decoration: underline; }
`;
