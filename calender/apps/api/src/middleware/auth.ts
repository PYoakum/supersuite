import type { MiddlewareHandler } from 'hono';
import { verifyToken } from '../lib/jwt';
import { UnauthorizedError } from '../lib/errors';

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or invalid authorization header');
  }

  const token = header.slice(7);
  try {
    const payload = await verifyToken(token);
    c.set('userId', payload.sub);
    c.set('email', payload.email);
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }

  await next();
};
