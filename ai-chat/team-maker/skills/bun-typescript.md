# Bun + TypeScript Development

## Runtime
- Use `Bun.serve()` for HTTP servers, not Express or Hono
- Use `bun run` and `bun test` — never npm/node
- Import from `bun` directly: `Bun.file()`, `Bun.write()`, `Bun.spawn()`
- Use `bun install` for dependencies (generates `bun.lock`)

## Server Pattern
```typescript
const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  async fetch(req) {
    const url = new URL(req.url);
    // route matching here
  },
});
```

## Frontend Pattern
- SPA template in `web/template.js` exporting an HTML string
- Static files served from `public/`
- No build step — vanilla JS in the browser

## Config
- Use environment variables via `process.env`
- TOML configs with `.example` pattern (real config gitignored)

## Database
- PostgreSQL via `postgres` package (not pg)
- Auth tokens via `jose` (JWT)

## Testing
- `bun test` with built-in test runner
- `describe()`, `it()`, `expect()` — same API as Jest
