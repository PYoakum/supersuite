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

export function formatDate(date) {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().replace("T", " ").substring(0, 19) + " UTC";
}

export function layout(config, loggedIn, title, bodyHtml, { sidebar = "" } = {}) {
  const siteName = escapeHtml(config.site.name);
  const pageTitle = title ? `${escapeHtml(title)} - ${siteName}` : siteName;

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
      <a href="/wiki/home" class="logo">${siteName}</a>
      <div class="nav-links">
        <a href="/pages">[All Pages]</a>
        <a href="/search">[Search]</a>
        ${loggedIn
          ? `<a href="/new">[New Page]</a>
             <form method="POST" action="/logout" class="inline-form">
               <button type="submit" class="link-btn">[Logout]</button>
             </form>`
          : `<a href="/login">[Login]</a>`
        }
      </div>
    </nav>
  </header>
  <div class="page-wrapper">
    ${sidebar ? `<aside class="sidebar">${sidebar}</aside>` : ""}
    <main>${bodyHtml}</main>
  </div>
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
    max-width: 1100px;
    margin: 0 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .logo { font-size: 1.2rem; font-weight: bold; color: #00ff41; }
  .nav-links { display: flex; gap: 0.75rem; align-items: center; }
  .inline-form { display: inline; }
  .link-btn {
    background: none; border: none; color: #00ff41;
    font-family: inherit; font-size: inherit; cursor: pointer; padding: 0;
  }
  .link-btn:hover { text-decoration: underline; }
  .page-wrapper {
    max-width: 1100px;
    width: 100%;
    margin: 0 auto;
    display: flex;
    gap: 1.5rem;
    padding: 1rem;
    flex: 1;
  }
  .sidebar {
    width: 200px;
    flex-shrink: 0;
    border-right: 1px solid #21262d;
    padding-right: 1rem;
  }
  .sidebar h3 { color: #00ff41; font-size: 0.9rem; margin-bottom: 0.5rem; }
  .sidebar ul { list-style: none; }
  .sidebar li { margin-bottom: 0.25rem; }
  .sidebar a { color: #58a6ff; font-size: 0.85rem; }
  .sidebar .active-page a { color: #00ff41; font-weight: bold; }
  main {
    flex: 1;
    min-width: 0;
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
  .form-group textarea { min-height: 300px; resize: vertical; }
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
  .btn-secondary { border-color: #484f58; color: #484f58; }
  .btn-secondary:hover { background: #484f58; color: #0d1117; }
  .alert { padding: 0.75rem; margin-bottom: 1rem; border: 1px solid; }
  .alert-error { border-color: #f85149; color: #f85149; }
  .alert-success { border-color: #00ff41; color: #00ff41; }
  .meta { color: #484f58; font-size: 0.85rem; }
  .wiki-body h1, .wiki-body h2, .wiki-body h3,
  .wiki-body h4, .wiki-body h5, .wiki-body h6 {
    color: #00ff41;
    margin: 0.75rem 0 0.25rem;
  }
  .wiki-body h1 { font-size: 1.3rem; }
  .wiki-body h2 { font-size: 1.15rem; }
  .wiki-body h3 { font-size: 1.05rem; }
  .wiki-body p { margin: 0.4rem 0; }
  .wiki-body code {
    background: #161b22;
    padding: 0.15rem 0.35rem;
    border-radius: 3px;
    font-size: 0.9em;
    border: 1px solid #30363d;
  }
  .wiki-body pre {
    background: #161b22;
    padding: 0.75rem;
    border: 1px solid #30363d;
    overflow-x: auto;
    margin: 0.5rem 0;
  }
  .wiki-body pre code {
    background: none;
    padding: 0;
    border: none;
  }
  .wiki-body blockquote {
    border-left: 3px solid #00ff41;
    padding: 0.25rem 0.75rem;
    margin: 0.5rem 0;
    color: #8b949e;
  }
  .wiki-body ul, .wiki-body ol {
    margin: 0.4rem 0;
    padding-left: 1.5rem;
  }
  .wiki-body li { margin: 0.2rem 0; }
  .wiki-body table {
    border-collapse: collapse;
    margin: 0.5rem 0;
    width: auto;
  }
  .wiki-body th, .wiki-body td {
    border: 1px solid #30363d;
    padding: 0.3rem 0.6rem;
  }
  .wiki-body th { background: #161b22; color: #00ff41; }
  .wiki-body hr {
    border: none;
    border-top: 1px solid #30363d;
    margin: 0.75rem 0;
  }
  .wiki-body img { max-width: 100%; }
  .wiki-body a { color: #58a6ff; }
  .editor-container { display: flex; gap: 1rem; }
  .editor-pane { flex: 1; min-width: 0; }
  .preview-pane {
    flex: 1;
    min-width: 0;
    border: 1px solid #30363d;
    padding: 0.75rem;
    background: #161b22;
    overflow-y: auto;
    max-height: 500px;
  }
  .page-actions { margin-bottom: 1rem; display: flex; gap: 0.5rem; }
  .search-highlight { background: #d2992244; padding: 0.1rem; }
  .snippet { color: #8b949e; font-size: 0.9rem; margin-top: 0.25rem; }
  @media (max-width: 768px) {
    .page-wrapper { flex-direction: column; }
    .sidebar { width: 100%; border-right: none; border-bottom: 1px solid #21262d; padding-right: 0; padding-bottom: 0.75rem; }
    .editor-container { flex-direction: column; }
  }
`;
