export async function parseJsonBody(req) {
  try {
    return await req.json();
  } catch {
    const err = new Error("Invalid JSON body");
    err.status = 400;
    err.expose = true;
    throw err;
  }
}

export function requireFields(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === "");
  if (missing.length > 0) {
    const err = new Error(`Missing required fields: ${missing.join(", ")}`);
    err.status = 422;
    err.expose = true;
    throw err;
  }
}

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  throw err;
}
