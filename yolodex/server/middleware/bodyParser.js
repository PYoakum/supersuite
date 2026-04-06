import { parseBody } from "../lib/request.js";

/**
 * Middleware that parses request body for POST/PUT/PATCH
 * and attaches it to ctx.state.body
 */
export async function bodyParser(ctx) {
  if (["POST", "PUT", "PATCH"].includes(ctx.method)) {
    ctx.state.body = await parseBody(ctx.req);
  } else {
    ctx.state.body = {};
  }
  return undefined;
}
