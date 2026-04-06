import { eq, and, gte, lte, inArray } from 'drizzle-orm';
import { db } from '../../db/client';
import { events, calendars, reminders } from '../../db/schema';
import { NotFoundError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { CreateEventInput, UpdateEventInput } from './events.validators';

export async function listEvents(
  userId: string,
  params: { start?: string; end?: string; calendarId?: string },
) {
  const userCalendars = await db.query.calendars.findMany({
    where: eq(calendars.userId, userId),
    columns: { id: true },
  });
  let calendarIds = userCalendars.map((c) => c.id);
  if (calendarIds.length === 0) return [];

  if (params.calendarId) {
    if (!calendarIds.includes(params.calendarId)) return [];
    calendarIds = [params.calendarId];
  }

  const conditions = [inArray(events.calendarId, calendarIds)];
  if (params.start) conditions.push(gte(events.endAt, new Date(params.start)));
  if (params.end) conditions.push(lte(events.startAt, new Date(params.end)));

  return db.query.events.findMany({
    where: and(...conditions),
    orderBy: (e, { asc }) => [asc(e.startAt)],
  });
}

export async function getEvent(userId: string, eventId: string) {
  const event = await db.query.events.findFirst({
    where: eq(events.id, eventId),
  });
  if (!event) throw new NotFoundError('Event');

  const calendar = await db.query.calendars.findFirst({
    where: and(eq(calendars.id, event.calendarId), eq(calendars.userId, userId)),
  });
  if (!calendar) throw new NotFoundError('Event');

  return event;
}

export async function createEvent(userId: string, input: CreateEventInput) {
  // Verify calendar ownership
  const calendar = await db.query.calendars.findFirst({
    where: and(eq(calendars.id, input.calendarId), eq(calendars.userId, userId)),
  });
  if (!calendar) throw new NotFoundError('Calendar');

  const [event] = await db
    .insert(events)
    .values({
      calendarId: input.calendarId,
      title: input.title,
      description: input.description || null,
      location: input.location || null,
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
      timezone: input.timezone || 'UTC',
      allDay: input.allDay,
      recurrenceRule: input.recurrenceRule || null,
    })
    .returning();

  // Auto-create reminders if provided
  if (input.reminders && input.reminders.length > 0) {
    for (const r of input.reminders) {
      const triggerAt = new Date(
        new Date(input.startAt).getTime() - r.offsetMinutes * 60 * 1000,
      );
      await db.insert(reminders).values({
        eventId: event.id,
        triggerType: 'offset',
        offsetMinutes: r.offsetMinutes,
        triggerAt,
        status: 'pending',
      });
    }
  }

  logger.info({ eventId: event.id, calendarId: input.calendarId }, 'Event created');
  return event;
}

export async function updateEvent(userId: string, eventId: string, input: UpdateEventInput) {
  await getEvent(userId, eventId);

  const updates: Record<string, unknown> = {};
  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description;
  if (input.location !== undefined) updates.location = input.location;
  if (input.startAt !== undefined) updates.startAt = new Date(input.startAt);
  if (input.endAt !== undefined) updates.endAt = new Date(input.endAt);
  if (input.allDay !== undefined) updates.allDay = input.allDay;
  if (input.recurrenceRule !== undefined) updates.recurrenceRule = input.recurrenceRule;
  if (input.timezone !== undefined) updates.timezone = input.timezone;
  if (input.calendarId !== undefined) {
    const calendar = await db.query.calendars.findFirst({
      where: and(eq(calendars.id, input.calendarId), eq(calendars.userId, userId)),
    });
    if (!calendar) throw new NotFoundError('Calendar');
    updates.calendarId = input.calendarId;
  }

  if (Object.keys(updates).length === 0) return getEvent(userId, eventId);

  const [updated] = await db
    .update(events)
    .set(updates)
    .where(eq(events.id, eventId))
    .returning();

  return updated;
}

export async function deleteEvent(userId: string, eventId: string) {
  await getEvent(userId, eventId);
  await db.delete(events).where(eq(events.id, eventId));
  logger.info({ eventId }, 'Event deleted');
  return { success: true };
}
