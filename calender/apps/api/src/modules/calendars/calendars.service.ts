import { eq, and } from 'drizzle-orm';
import { db } from '../../db/client';
import { calendars } from '../../db/schema';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { CreateCalendarInput, UpdateCalendarInput } from './calendars.validators';

export async function listCalendars(userId: string) {
  return db.query.calendars.findMany({
    where: eq(calendars.userId, userId),
    orderBy: (c, { asc }) => [asc(c.createdAt)],
  });
}

export async function getCalendar(userId: string, calendarId: string) {
  const calendar = await db.query.calendars.findFirst({
    where: and(eq(calendars.id, calendarId), eq(calendars.userId, userId)),
  });
  if (!calendar) throw new NotFoundError('Calendar');
  return calendar;
}

export async function createCalendar(userId: string, input: CreateCalendarInput) {
  const [calendar] = await db
    .insert(calendars)
    .values({
      userId,
      name: input.name,
      color: input.color || '#3B82F6',
    })
    .returning();

  logger.info({ calendarId: calendar.id, userId }, 'Calendar created');
  return calendar;
}

export async function updateCalendar(userId: string, calendarId: string, input: UpdateCalendarInput) {
  await getCalendar(userId, calendarId);

  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.color !== undefined) updates.color = input.color;

  if (Object.keys(updates).length === 0) {
    return getCalendar(userId, calendarId);
  }

  const [updated] = await db
    .update(calendars)
    .set(updates)
    .where(eq(calendars.id, calendarId))
    .returning();

  return updated;
}

export async function deleteCalendar(userId: string, calendarId: string) {
  const calendar = await getCalendar(userId, calendarId);

  if (calendar.isDefault) {
    throw new ValidationError('Cannot delete the default calendar');
  }

  await db.delete(calendars).where(eq(calendars.id, calendarId));
  logger.info({ calendarId, userId }, 'Calendar deleted');
  return { success: true };
}
