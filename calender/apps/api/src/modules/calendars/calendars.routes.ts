import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { createCalendarSchema, updateCalendarSchema } from './calendars.validators';
import * as calendarService from './calendars.service';

export const calendarRoutes = new Hono();

calendarRoutes.use('*', authMiddleware);

calendarRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const calendars = await calendarService.listCalendars(userId);
  return c.json(calendars);
});

calendarRoutes.get('/:id', async (c) => {
  const userId = c.get('userId');
  const calendar = await calendarService.getCalendar(userId, c.req.param('id'));
  return c.json(calendar);
});

calendarRoutes.post('/', async (c) => {
  const userId = c.get('userId');
  const body = createCalendarSchema.parse(await c.req.json());
  const calendar = await calendarService.createCalendar(userId, body);
  return c.json(calendar, 201);
});

calendarRoutes.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const body = updateCalendarSchema.parse(await c.req.json());
  const calendar = await calendarService.updateCalendar(userId, c.req.param('id'), body);
  return c.json(calendar);
});

calendarRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const result = await calendarService.deleteCalendar(userId, c.req.param('id'));
  return c.json(result);
});
