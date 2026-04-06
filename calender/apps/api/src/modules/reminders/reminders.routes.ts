import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { createReminderSchema, updateReminderSchema, snoozeReminderSchema } from './reminders.validators';
import * as reminderService from './reminders.service';

export const reminderRoutes = new Hono();

reminderRoutes.use('*', authMiddleware);

reminderRoutes.get('/pending', async (c) => {
  const userId = c.get('userId');
  const pending = await reminderService.getPendingReminders(userId);
  return c.json(pending);
});

reminderRoutes.get('/event/:eventId', async (c) => {
  const userId = c.get('userId');
  const reminders = await reminderService.listRemindersForEvent(userId, c.req.param('eventId'));
  return c.json(reminders);
});

reminderRoutes.post('/', async (c) => {
  const userId = c.get('userId');
  const body = createReminderSchema.parse(await c.req.json());
  const reminder = await reminderService.createReminder(userId, body);
  return c.json(reminder, 201);
});

reminderRoutes.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const body = updateReminderSchema.parse(await c.req.json());
  const reminder = await reminderService.updateReminder(userId, c.req.param('id'), body);
  return c.json(reminder);
});

reminderRoutes.post('/:id/snooze', async (c) => {
  const userId = c.get('userId');
  const body = snoozeReminderSchema.parse(await c.req.json());
  const reminder = await reminderService.snoozeReminder(userId, c.req.param('id'), body);
  return c.json(reminder);
});

reminderRoutes.post('/:id/dismiss', async (c) => {
  const userId = c.get('userId');
  const reminder = await reminderService.dismissReminder(userId, c.req.param('id'));
  return c.json(reminder);
});

reminderRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const result = await reminderService.deleteReminder(userId, c.req.param('id'));
  return c.json(result);
});
