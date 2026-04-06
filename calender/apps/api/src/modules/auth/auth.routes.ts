import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { registerSchema, loginSchema, updateProfileSchema } from './auth.validators';
import * as authService from './auth.service';

export const authRoutes = new Hono();

authRoutes.post('/register', async (c) => {
  const body = registerSchema.parse(await c.req.json());
  const result = await authService.register(body);
  return c.json(result, 201);
});

authRoutes.post('/login', async (c) => {
  const body = loginSchema.parse(await c.req.json());
  const result = await authService.login(body);
  return c.json(result);
});

authRoutes.post('/refresh', async (c) => {
  const { refreshToken } = await c.req.json();
  const result = await authService.refresh(refreshToken);
  return c.json(result);
});

authRoutes.post('/logout', authMiddleware, async (c) => {
  const header = c.req.header('Authorization') || '';
  const token = header.slice(7);
  await authService.logout(token);
  return c.json({ success: true });
});

authRoutes.get('/me', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const user = await authService.getCurrentUser(userId);
  return c.json(user);
});

authRoutes.patch('/me', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const body = updateProfileSchema.parse(await c.req.json());
  const user = await authService.updateProfile(userId, body);
  return c.json(user);
});
