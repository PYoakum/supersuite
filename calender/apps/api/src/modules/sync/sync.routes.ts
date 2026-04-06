import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { getChangesSinceVersion } from './sync.service';

export const syncRoutes = new Hono();

syncRoutes.use('*', authMiddleware);

syncRoutes.get('/changes', async (c) => {
  const userId = c.get('userId');
  const since = parseInt(c.req.query('since') || '0', 10);
  const result = await getChangesSinceVersion(userId, since);
  return c.json(result);
});
