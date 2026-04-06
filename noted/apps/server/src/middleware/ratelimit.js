/**
 * In-memory rate limiter using sliding window counters.
 * Keyed by IP address. Configurable per-route limits.
 */

const buckets = new Map();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entries] of buckets) {
    const fresh = entries.filter(t => now - t < 60_000);
    if (fresh.length === 0) buckets.delete(key);
    else buckets.set(key, fresh);
  }
}, 300_000);

/**
 * Check rate limit. Throws 429 if exceeded.
 * @param {string} key - rate limit key (e.g., IP + route)
 * @param {number} maxPerMinute - max requests per minute
 * @param {import('../http.js').HttpError} HttpError
 */
export function rateLimit(key, maxPerMinute, HttpError) {
  const now = Date.now();
  let entries = buckets.get(key);

  if (!entries) {
    entries = [];
    buckets.set(key, entries);
  }

  // Remove entries older than 1 minute
  const cutoff = now - 60_000;
  while (entries.length > 0 && entries[0] < cutoff) entries.shift();

  if (entries.length >= maxPerMinute) {
    const err = new HttpError(429, 'Too many requests. Please try again later.');
    err.retryAfter = Math.ceil((entries[0] + 60_000 - now) / 1000);
    throw err;
  }

  entries.push(now);
}

/**
 * Get client IP from request.
 * Respects X-Forwarded-For if present.
 */
export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || '127.0.0.1';
}
