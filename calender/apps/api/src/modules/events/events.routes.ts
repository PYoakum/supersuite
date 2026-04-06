import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { createEventSchema, updateEventSchema } from './events.validators';
import * as eventService from './events.service';

export const eventRoutes = new Hono();

eventRoutes.use('*', authMiddleware);

eventRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const { start, end, calendarId } = c.req.query();
  const events = await eventService.listEvents(userId, { start, end, calendarId });
  return c.json(events);
});

eventRoutes.get('/:id', async (c) => {
  const userId = c.get('userId');
  const event = await eventService.getEvent(userId, c.req.param('id'));
  return c.json(event);
});

eventRoutes.post('/', async (c) => {
  const userId = c.get('userId');
  const body = createEventSchema.parse(await c.req.json());
  const event = await eventService.createEvent(userId, body);
  return c.json(event, 201);
});

eventRoutes.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const body = updateEventSchema.parse(await c.req.json());
  const event = await eventService.updateEvent(userId, c.req.param('id'), body);
  return c.json(event);
});

eventRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const result = await eventService.deleteEvent(userId, c.req.param('id'));
  return c.json(result);
});
