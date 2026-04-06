import { eq, and, lte, or, inArray } from 'drizzle-orm';
import { db } from '../../db/client';
import { reminders, events, calendars } from '../../db/schema';
import { NotFoundError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { CreateReminderInput, UpdateReminderInput, SnoozeReminderInput } from './reminders.validators';

/** Create a reminder for an event */
export async function createReminder(userId: string, input: CreateReminderInput) {
  // Verify event ownership via calendar
  const event = await db.query.events.findFirst({
    where: eq(events.id, input.eventId),
  });
  if (!event) throw new NotFoundError('Event');

  const calendar = await db.query.calendars.findFirst({
    where: and(eq(calendars.id, event.calendarId), eq(calendars.userId, userId)),
  });
  if (!calendar) throw new NotFoundError('Event');

  const triggerAt = new Date(
    new Date(event.startAt).getTime() - input.offsetMinutes * 60 * 1000,
  );

  const [reminder] = await db
    .insert(reminders)
    .values({
      eventId: input.eventId,
      triggerType: 'offset',
      offsetMinutes: input.offsetMinutes,
      triggerAt,
      status: 'pending',
    })
    .returning();

  logger.info({ reminderId: reminder.id, eventId: input.eventId }, 'Reminder created');
  return reminder;
}

/** Update a reminder */
export async function updateReminder(
  userId: string,
  reminderId: string,
  input: UpdateReminderInput,
) {
  const reminder = await getOwnedReminder(userId, reminderId);

  const updates: Record<string, unknown> = {};
  if (input.offsetMinutes !== undefined) {
    updates.offsetMinutes = input.offsetMinutes;
    // Recalculate trigger_at from event start
    const event = await db.query.events.findFirst({
      where: eq(events.id, reminder.eventId),
    });
    if (event) {
      updates.triggerAt = new Date(
        new Date(event.startAt).getTime() - input.offsetMinutes * 60 * 1000,
      );
    }
  }
  if (input.triggerAt !== undefined) {
    updates.triggerAt = new Date(input.triggerAt);
    updates.triggerType = 'absolute';
  }

  if (Object.keys(updates).length === 0) return reminder;

  const [updated] = await db
    .update(reminders)
    .set(updates)
    .where(eq(reminders.id, reminderId))
    .returning();

  return updated;
}

/** Delete a reminder */
export async function deleteReminder(userId: string, reminderId: string) {
  await getOwnedReminder(userId, reminderId);
  await db.delete(reminders).where(eq(reminders.id, reminderId));
  logger.info({ reminderId }, 'Reminder deleted');
  return { success: true };
}

/** Snooze a reminder by N minutes from now */
export async function snoozeReminder(
  userId: string,
  reminderId: string,
  input: SnoozeReminderInput,
) {
  await getOwnedReminder(userId, reminderId);

  const snoozedUntil = new Date(Date.now() + input.minutes * 60 * 1000);

  const [updated] = await db
    .update(reminders)
    .set({
      status: 'snoozed',
      snoozedUntil,
    })
    .where(eq(reminders.id, reminderId))
    .returning();

  logger.info({ reminderId, snoozedUntil }, 'Reminder snoozed');
  return updated;
}

/** Dismiss a reminder */
export async function dismissReminder(userId: string, reminderId: string) {
  await getOwnedReminder(userId, reminderId);

  const [updated] = await db
    .update(reminders)
    .set({ status: 'dismissed' })
    .where(eq(reminders.id, reminderId))
    .returning();

  logger.info({ reminderId }, 'Reminder dismissed');
  return updated;
}

/**
 * Fetch all pending/fired reminders for a user that are ready for delivery.
 * Called by the Electron client on a polling interval.
 */
export async function getPendingReminders(userId: string) {
  const now = new Date();

  // Get user's calendar IDs
  const userCalendars = await db.query.calendars.findMany({
    where: eq(calendars.userId, userId),
    columns: { id: true },
  });
  const calendarIds = userCalendars.map((c) => c.id);
  if (calendarIds.length === 0) return [];

  // Get events owned by the user
  const userEvents = await db.query.events.findMany({
    where: inArray(events.calendarId, calendarIds),
    columns: { id: true },
  });
  const eventIds = userEvents.map((e) => e.id);
  if (eventIds.length === 0) return [];

  // Get reminders that are due
  const pendingReminders = await db.query.reminders.findMany({
    where: and(
      inArray(reminders.eventId, eventIds),
      or(
        // Pending reminders whose trigger time has passed
        and(eq(reminders.status, 'pending'), lte(reminders.triggerAt, now)),
        // Snoozed reminders whose snooze period has elapsed
        and(eq(reminders.status, 'snoozed'), lte(reminders.snoozedUntil, now)),
        // Already fired but not yet dismissed (for re-delivery after restart)
        eq(reminders.status, 'fired'),
      ),
    ),
  });

  // Mark pending ones as fired
  const pendingIds = pendingReminders
    .filter((r) => r.status === 'pending')
    .map((r) => r.id);

  const snoozedIds = pendingReminders
    .filter((r) => r.status === 'snoozed')
    .map((r) => r.id);

  const toFire = [...pendingIds, ...snoozedIds];
  if (toFire.length > 0) {
    await db
      .update(reminders)
      .set({ status: 'fired' })
      .where(inArray(reminders.id, toFire));
  }

  // Enrich with event data for notification display
  const enriched = [];
  for (const reminder of pendingReminders) {
    const event = await db.query.events.findFirst({
      where: eq(events.id, reminder.eventId),
    });
    if (event) {
      enriched.push({ ...reminder, event });
    }
  }

  return enriched;
}

/** List all reminders for a specific event */
export async function listRemindersForEvent(userId: string, eventId: string) {
  // Verify ownership
  const event = await db.query.events.findFirst({
    where: eq(events.id, eventId),
  });
  if (!event) throw new NotFoundError('Event');

  const calendar = await db.query.calendars.findFirst({
    where: and(eq(calendars.id, event.calendarId), eq(calendars.userId, userId)),
  });
  if (!calendar) throw new NotFoundError('Event');

  return db.query.reminders.findMany({
    where: eq(reminders.eventId, eventId),
    orderBy: (r, { asc }) => [asc(r.triggerAt)],
  });
}

// ── Internal helper ────────────────────────────────────────

async function getOwnedReminder(userId: string, reminderId: string) {
  const reminder = await db.query.reminders.findFirst({
    where: eq(reminders.id, reminderId),
  });
  if (!reminder) throw new NotFoundError('Reminder');

  // Verify ownership chain: reminder → event → calendar → user
  const event = await db.query.events.findFirst({
    where: eq(events.id, reminder.eventId),
  });
  if (!event) throw new NotFoundError('Reminder');

  const calendar = await db.query.calendars.findFirst({
    where: and(eq(calendars.id, event.calendarId), eq(calendars.userId, userId)),
  });
  if (!calendar) throw new NotFoundError('Reminder');

  return reminder;
}
