/**
 * Minimal router for Bun.serve.
 *
 * Supports:
 *  - method + path matching with :params
 *  - middleware chain (global and per-route)
 *  - 404 / 500 fallback
 */
export class Router {
  constructor() {
    this.routes = [];
    this.globalMiddleware = [];
  }

  use(fn) {
    this.globalMiddleware.push(fn);
  }

  get(path, ...handlers) { this._add("GET", path, handlers); }
  post(path, ...handlers) { this._add("POST", path, handlers); }
  put(path, ...handlers) { this._add("PUT", path, handlers); }
  patch(path, ...handlers) { this._add("PATCH", path, handlers); }
  delete(path, ...handlers) { this._add("DELETE", path, handlers); }

  _add(method, path, handlers) {
    const pattern = this._compile(path);
    this.routes.push({ method, path, pattern, handlers });
  }

  _compile(path) {
    const keys = [];
    const src = path
      .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
        keys.push(key);
        return "([^/]+)";
      })
      .replace(/\//g, "\\/");
    return { regex: new RegExp(`^${src}$`), keys };
  }

  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = pathname.match(route.pattern.regex);
      if (!m) continue;
      const params = {};
      route.pattern.keys.forEach((key, i) => {
        params[key] = decodeURIComponent(m[i + 1]);
      });
      return { route, params };
    }
    return null;
  }

  async handle(req) {
    const url = new URL(req.url);
    const method = req.method;
    const pathname = url.pathname;

    // Build context object shared across middleware and handlers
    const ctx = {
      req,
      url,
      method,
      pathname,
      params: {},
      query: Object.fromEntries(url.searchParams),
      state: {},  // middleware can attach data here
      locals: {}, // for template data
    };

    // Run global middleware
    for (const mw of this.globalMiddleware) {
      const result = await mw(ctx);
      if (result instanceof Response) return result;
    }

    // Match route
    const found = this.match(method, pathname);
    if (!found) return null; // signal 404 to caller

    ctx.params = found.params;
    const handlers = found.route.handlers;

    // Run route handlers (middleware + final handler)
    for (const handler of handlers) {
      const result = await handler(ctx);
      if (result instanceof Response) return result;
    }

    return null;
  }
}
