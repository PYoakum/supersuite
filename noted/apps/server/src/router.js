/**
 * Lightweight router for Node's built-in HTTP server.
 * Supports path parameters like :slug and :id.
 *
 * Usage:
 *   const router = createRouter();
 *   router.get('/api/docs/:slug', handler);
 *   router.post('/api/docs', handler);
 *   // In request handler:
 *   const matched = router.match(method, pathname);
 *   if (matched) matched.handler(req, res, matched.params);
 */

/**
 * Convert a route pattern like '/api/docs/:slug/versions/:id'
 * into a regex and param name list.
 */
function compilePattern(pattern) {
  const paramNames = [];
  const regexStr = pattern
    .replace(/:([a-zA-Z_]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
  return {
    regex: new RegExp(`^${regexStr}$`),
    paramNames,
  };
}

export function createRouter() {
  const routes = [];

  function addRoute(method, pattern, handler) {
    const compiled = compilePattern(pattern);
    routes.push({ method: method.toUpperCase(), pattern, ...compiled, handler });
  }

  function match(method, pathname) {
    const upperMethod = method.toUpperCase();
    for (const route of routes) {
      if (route.method !== upperMethod) continue;
      const m = pathname.match(route.regex);
      if (!m) continue;
      const params = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(m[i + 1]);
      });
      return { handler: route.handler, params };
    }
    return null;
  }

  return {
    get: (p, h) => addRoute('GET', p, h),
    post: (p, h) => addRoute('POST', p, h),
    put: (p, h) => addRoute('PUT', p, h),
    delete: (p, h) => addRoute('DELETE', p, h),
    patch: (p, h) => addRoute('PATCH', p, h),
    match,
  };
}
