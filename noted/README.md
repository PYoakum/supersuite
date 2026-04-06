# Noted — Self-Hosted Document Editor

A self-hosted, Notion-style WYSIWYG document editor with Markdown as the canonical storage format. Built on Node.js with a remote Postgres backend.

## Project Structure

```
noted/
├── config.example.toml          # Copy to config.toml and customize
├── package.json                  # Workspace root
├── test-auth-e2e.js              # E2E auth test suite (17 assertions)
├── test-docs-e2e.js              # E2E document test suite (37 assertions)
├── test-versions-e2e.js          # E2E versioning test suite (39 assertions)
├── test-parser-unit.js           # Parser unit tests (95 assertions)
├── test-editor-unit.js           # Editor model unit tests (70 assertions)
├── test-media-e2e.js             # E2E media upload test suite (40 assertions)
├── test-search-e2e.js            # E2E search + security test suite (32 assertions)
├── test-organize-e2e.js          # E2E tags/folders/backlinks test suite (44 assertions)
├── apps/
│   ├── server/
│   │   └── src/
│   │       ├── index.js          # Entry point — boots server
│   │       ├── config.js         # TOML config loader + validation
│   │       ├── router.js         # Lightweight pattern-matching router
│   │       ├── http.js           # JSON responses, body parsing, cookies
│   │       ├── static.js         # Static file server + dynamic page routes
│   │       ├── auth/
│   │       │   ├── passwords.js  # Argon2id hash + verify
│   │       │   └── sessions.js   # Session create/validate/destroy
│   │       ├── routes/
│   │       │   ├── auth.js       # signup, login, logout, /me
│   │       │   ├── documents.js  # CRUD, list, fetch, metadata update
│   │       │   ├── save.js       # Content save with versioning + concurrency
│   │       │   ├── versions.js   # Version list, fetch, restore
│   │       │   ├── media.js      # Media upload, serve, list, delete
│   │       │   ├── search.js     # Full-text search endpoint
│   │       │   └── organize.js   # Tags, folders, backlinks endpoints
│   │       ├── multipart.js      # Zero-dep multipart/form-data parser
│   │       ├── middleware/
│   │       │   ├── auth.js       # loadUser, requireAuth, requireRole
│   │       │   └── ratelimit.js  # Sliding window rate limiter
│   │       └── db/
│   │           ├── connection.js # Postgres connection pool
│   │           ├── migrate.js    # File-based migration runner
│   │           ├── users.js      # User queries
│   │           ├── documents.js  # Document queries + slug + search
│   │           ├── redirects.js  # Redirect chain resolution
│   │           ├── versions.js   # Version list, fetch, restore queries
│   │           ├── media.js      # Media CRUD queries
│   │           ├── tags.js       # Tags CRUD + document tagging
│   │           ├── folders.js    # Folders CRUD + document assignment
│   │           ├── links.js      # Wiki-link extraction + backlinks
│   │           └── migrations/   # SQL migration files (001-009)
│   └── web/
│       └── public/
│           ├── index.html        # Dashboard — doc list, search, folders, tags
│           ├── login.html        # Login / signup
│           ├── profile.html      # Profile editor
│           ├── viewer.html       # Public document viewer (/d/:slug)
│           ├── editor.html       # Document editor (/e/:slug)
│           ├── editor-core.js    # WYSIWYG block editor engine
│           ├── editor-styles.css # Editor-specific styles
│           ├── command-palette.js # Ctrl+P quick doc switcher
│           ├── panels.css        # Outline, info drawer, diff styles
│           ├── diff.js           # Line-level version diff utility
│           ├── styles.css        # Shared CSS
│           └── app.js            # Shared client JS
└── packages/
    └── shared/src/
            ├── index.js          # Barrel export
            ├── slugify.js        # slugify + uniqueSlug
            ├── markdown.js       # canonicalize + contentHash
            ├── constants.js      # Roles, limits, defaults
            └── parser/           # Markdown parser pipeline
                ├── index.js      # Parser barrel export
                ├── nodes.js      # AST node type factories
                ├── block.js      # Block-level parser (MD → AST)
                ├── inline.js     # Inline parser (bold, links, etc.)
                ├── html.js       # AST → sanitized HTML renderer
                └── serialize.js  # AST → canonical markdown
```

## Quick Start

```bash
# Install dependencies
npm install

# Copy and edit config
cp config.example.toml config.toml

# Run migrations (requires Postgres)
npm run migrate

# Start development server
npm run dev
```

## Database Migrations

Six initial migrations create the core schema:

| # | Migration | Description |
|---|-----------|-------------|
| 001 | Extensions | uuid-ossp, pgcrypto |
| 002 | Users | users table |
| 003 | Sessions | sessions table |
| 004 | Documents | documents, document_versions tables |
| 005 | Redirects | document_redirects table |
| 006 | Media | media table |
| 007 | Relax hash | Non-unique index on version content_hash (enables restore) |

## Current Status

### Milestone 1 — Repository + Tooling ✅
- Project scaffolded as npm workspaces monorepo
- TOML config loader with validation and defaults
- Database migration system (file-based, transactional)
- Full initial schema (6 migrations)
- HTTP server with lightweight router + JSON helpers
- Shared package: slugify, markdown canonicalization, content hashing

### Milestone 2 — Auth + Users ✅
- Argon2id password hashing (passwords.js)
- Session management: create, validate, destroy, cleanup (sessions.js)
- Auth middleware: loadUser (cookie → user on request), requireAuth, requireRole
- Auth routes: POST signup, POST login, POST logout, GET /api/me, PUT /api/me
- User queries: findByEmail, findById, create, update, list
- Static file server for client pages (clean URLs)
- Client pages: login (with signup toggle), dashboard shell, profile editor
- Shared client JS: API client, alerts, auth redirects
- E2E test suite: 17/17 assertions passing (test-auth-e2e.js)

### Milestone 3 — Documents CRUD + Slugs + Redirects ✅
- Document DB queries: create (with initial version), list, fetch by slug, update, delete
- Slug generation: `uniqueSlug()` appends -2, -3 etc. for duplicates; checks both documents and redirects
- Redirect system: automatic redirect creation on title/slug change, chain resolution (up to 10 hops)
- Document routes: POST create, GET list, GET fetch (with 301 redirect support), PUT update metadata, DELETE
- Save endpoint: content save with canonicalization, SHA-256 hash dedup, optimistic concurrency (409 on stale base_version_id)
- Access control: private docs require auth + ownership; public docs readable without auth
- Viewer page (`/d/:slug`): client-side markdown renderer, auto-redirect on old slugs, public/private gating
- Editor shell (`/e/:slug`): textarea with autosave (800ms debounce), title editing with live slug update, visibility toggle, unsaved changes warning
- Static server updated with dynamic page routing (`/d/*`, `/e/*`)
- E2E test suite: 37/37 assertions passing (test-docs-e2e.js)

### Milestone 4 — Versioning + Save Semantics ✅
- Version DB queries: list (paginated, newest-first), fetch specific version with content, restore (creates new version from old)
- Version routes: GET list with pagination (limit/offset), GET fetch by version ID, POST restore by version ID
- Save semantics hardened: canonicalize → hash → skip if unchanged → create version → update pointer (all in transaction)
- Restore semantics: always creates a new version (preserves lineage), auto-summary "Restored from version …", no-op if content matches current
- Migration 007: relaxed unique constraint on (document_id, content_hash) so restores can create distinct version entries for the same content
- Editor UI: version history slide-out panel with version list (time, author, size, hash prefix, restore summary), click-to-preview, restore button
- E2E test suite: 39/39 assertions (test-versions-e2e.js) — covers listing, pagination, fetch, restore, no-change dedup, metadata
- Total test assertions across all suites: 93

### Milestone 5 — Markdown Parser + Renderer + Directives ✅
- Full markdown parser pipeline: MD → AST → sanitized HTML, and AST → canonical MD (round-trip stable)
- **Block parser** (`parser/block.js`): headings (with stable disambiguated IDs), paragraphs, bullet/ordered/nested lists, task lists (checklists), fenced code blocks (with language), tables (with column alignment), blockquotes, thematic breaks, directive blocks, TOC placeholder
- **Inline parser** (`parser/inline.js`): bold, italic, inline code, links (with title), images (with title), wiki-links (`[[target]]` and `[[target|display]]`), escaped characters
- **HTML renderer** (`parser/html.js`): sanitized output with XSS protection (escapes `<script>`, blocks `javascript:` and `data:` URLs), TOC generation from headings, callout/embed/unknown directive rendering, wiki-link resolution
- **Serializer** (`parser/serialize.js`): AST → canonical markdown, stable output for hashing/versioning
- **Directives**: `:::callout type="..." title="..."`, `:::embed url="..."`, `[[toc]]`, `[[wiki-link]]`
- Server integration: `/api/docs/:slug` returns `content_html` and `headings` alongside `content_markdown`
- Viewer updated: uses server-rendered HTML, new CSS for TOC nav, callout boxes (info/warning/danger/success), task lists, wiki-links
- Unit test suite: 95/95 assertions (test-parser-unit.js) — covers all block types, inline formatting, directives, XSS, heading IDs, round-trip serialization, edge cases
- Total test assertions across all suites: 188

### Milestone 6 — WYSIWYG Editor (Single Container) ✅
- **Block-based editor** (`editor-core.js`): full WYSIWYG editing in a single contentEditable container
- Block types: paragraph, heading (1–6), bullet list, ordered list, task list (checkbox), code block (with language), blockquote, divider
- **Auto-formatting**: typing `# ` converts to heading, `- ` to bullet, `1. ` to ordered, `- [ ] ` to task, ``` to code block, `> ` to blockquote, `---` to divider
- **Key behaviors**: Enter splits blocks (preserves list type), Backspace at start merges/converts, Tab outdents lists, arrow keys navigate between blocks
- **Inline formatting**: Ctrl+B bold, Ctrl+I italic, Ctrl+E code, Ctrl+K link insertion, live inline preview (bold/italic/code/links/images/wiki-links rendered in-place)
- **Slash command menu**: type `/` on empty line to get block type picker with keyboard navigation
- **Toolbar**: block type selector dropdown, bold/italic/code/link buttons, divider button
- **Paste handling**: multi-line paste parsed as markdown blocks, URL paste auto-linked, image URL paste creates image embed, code block paste as plain text
- **Mode toggle**: switch between WYSIWYG and raw markdown editing, content syncs bidirectionally
- **Model ↔ Markdown**: `markdownToModel()` parses markdown into block array, `modelToMarkdown()` serializes back to canonical markdown, DOM ↔ model sync via `_syncBlockFromDom()`/`_domToInlineMarkdown()`
- **Autosave**: 800ms debounce on content changes, status indicator (Unsaved/Saving/Saved/No changes/Error/Conflict), beforeunload warning
- **Version history panel**: preserved from Milestone 4, works with both WYSIWYG and raw modes
- Editor styles in `editor-styles.css`: clean block rendering, code blocks with lang label, task checkboxes, list markers, slash menu
- Unit test suite: 70/70 assertions (test-editor-unit.js) — model parsing, serialization, round-trip for all block types
- Total test assertions across all suites: 258

### Milestone 7 — Media Upload + Embeds ✅
- **Multipart parser** (`multipart.js`): zero-dependency multipart/form-data parser with 50MB streaming limit, boundary parsing, header extraction
- **Media routes** (`routes/media.js`):
  - `POST /api/media/upload` — multipart upload with MIME validation (PNG, JPEG, GIF, WebP, SVG, AVIF, MP4, WebM, OGG, MOV), 20MB file limit, date-partitioned storage (`YYYY/MM/uuid.ext`), automatic PNG/JPEG dimension extraction
  - `GET /media/:id` — public file serving with `Cache-Control: immutable`, streaming via `createReadStream`, content-type headers
  - `GET /api/media` — list user's media with pagination (`limit`, `offset`) and kind filter (`?kind=image`)
  - `DELETE /api/media/:id` — delete media record + file from disk
- **Media DB** (`db/media.js`): create, get by ID, list with filtering/pagination, delete with owner authorization
- **Editor integration**: image upload button in toolbar, drag-and-drop on editor area, auto-inserts markdown image/video syntax, works in both WYSIWYG and raw modes
- **Storage**: configurable `media_path` in config.toml, auto-created directory structure, UUID filenames prevent collisions
- **Server-side rendering**: images in markdown render as `<img>` tags in the HTML viewer with proper sanitization
- E2E test suite: 40/40 assertions (test-media-e2e.js) — upload, serve, list, filter, delete, auth checks, type validation, embed in document, pagination
- Total test assertions across all suites: 298

### Milestone 8 — Polish + Hardening ✅ (MVP Complete)
- **Full-text search** (`routes/search.js`, migration `008_search.sql`):
  - Postgres `tsvector` with GIN index, weighted ranking (title=A, content=B)
  - `GET /api/search?q=...&limit=...&offset=...` — returns ranked results with highlighted snippets (`ts_headline`)
  - Multi-word AND queries, pagination, query length validation
  - Dashboard search bar with 300ms debounce, live results, Escape to clear
- **Organization** (`routes/organize.js`, migration `009_tags_folders_links.sql`):
  - **Tags**: create, rename, delete, tag/untag documents, list with counts, bulk fetch for doc list, idempotent create-or-get, normalized names
  - **Folders**: create, rename, delete, move documents between folders, nested parent support, doc count
  - **Backlinks**: wiki-link extraction on save (`[[target]]`, `[[target|display]]`), `document_links` table with slug + resolved ID, bidirectional: outgoing links + backlinks per document
  - All routes auth-guarded with owner verification
- **Security hardening**:
  - Rate limiting (`middleware/ratelimit.js`): in-memory sliding window per IP, 10 login/min, 5 signup/min, 30 upload/min per user
  - Security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`
  - CORS enforcement: same-origin only (rejects cross-origin requests with non-matching Origin)
  - Request body size limit: 10MB for non-media routes
  - `Retry-After` header on 429 responses
  - `headersSent` guards on all error paths (prevents double-write with streaming)
- **Performance**:
  - DB indexes: `idx_documents_owner_updated`, `idx_documents_public`, `idx_documents_search` (GIN), `idx_document_links_target`, `idx_document_tags_tag`, `idx_folders_owner`
  - Static file ETag caching for conditional requests
  - Tiered cache-control: HTML no-cache, CSS/JS 1h, fonts/images 1 week
  - Media files: `Cache-Control: immutable` (1 year)
  - Bulk tag fetch for document list (single query for all docs)
- **UI polish**:
  - HTML 404 page with navigation for browser requests (JSON 404 for API)
  - **Dashboard**: folder sidebar with counts, tag filter pills, sort options (recent/newest/title), search with highlighted snippets, responsive layout
  - **Editor**: info drawer with tags (add/remove), backlinks (linked pages), document metadata (created, updated, slug); outline panel for heading navigation; command palette; diff viewer for version history
- E2E test suites:
  - `test-search-e2e.js`: 32/32 — search by title, content, snippets, multi-word, pagination, auth, rate limiting, security headers, ranking
  - `test-organize-e2e.js`: 44/44 — tags CRUD, document tagging, folder CRUD, move/unfolder docs, wiki-link extraction, outgoing links, backlinks, auth guards
- **Total test assertions across all suites: 374**

---

## MVP Definition of Done ✅
- [x] Authenticated editor can create/edit docs with WYSIWYG single container
- [x] Viewer can read public docs at stable slug URLs; redirects work
- [x] Markdown parsing handles lists/checklists/TOC/code blocks/tables reliably
- [x] Autosave syncs to Postgres; versions created only on real changes
- [x] Media upload + embedding works for images and video
- [x] All configuration is TOML-driven
- [x] Full-text search across title + content
- [x] Tags, folders, and bidirectional wiki-link backlinks
- [x] Security hardened: rate limiting, security headers, XSS protection, CORS
- [x] Dashboard: folder sidebar, tag filters, sort options, search
- [x] Editor: tag management, backlinks panel, outline, command palette, diff viewer
- [x] 374 automated test assertions across 8 suites, 0 failures

## Configuration

All settings live in `config.toml`. See `config.example.toml` for all options with documentation.

## Runtime

Designed for Node.js 22+ (originally planned for Bun; architecture is runtime-agnostic).
