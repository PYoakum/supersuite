export function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    const paramNames = [];
    const regexStr = pattern.replace(/:([a-zA-Z_]+)/g, (_, name) => {
      paramNames.push(name);
      return "([^/]+)";
    });
    const regex = new RegExp(`^${regexStr}$`);
    routes.push({ method, regex, paramNames, handler });
  }

  return {
    get(pattern, handler) { add("GET", pattern, handler); },
    post(pattern, handler) { add("POST", pattern, handler); },
    put(pattern, handler) { add("PUT", pattern, handler); },
    delete(pattern, handler) { add("DELETE", pattern, handler); },

    match(method, pathname) {
      for (const route of routes) {
        if (route.method !== method) continue;
        const m = pathname.match(route.regex);
        if (!m) continue;
        const params = {};
        route.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(m[i + 1]);
        });
        return { handler: route.handler, params };
      }
      return null;
    },
  };
}
