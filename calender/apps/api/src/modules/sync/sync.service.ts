import { gt, eq, and, inArray } from 'drizzle-orm';
import { db } from '../../db/client';
import { calendars, events, reminders } from '../../db/schema';

export async function getChangesSinceVersion(userId: string, sinceVersion: number) {
  // Get user's calendar IDs
  const userCalendars = await db.query.calendars.findMany({
    where: eq(calendars.userId, userId),
    columns: { id: true },
  });
  const calendarIds = userCalendars.map((c) => c.id);

  // Fetch changed calendars
  const changedCalendars = await db.query.calendars.findMany({
    where: and(
      eq(calendars.userId, userId),
      gt(calendars.syncVersion, sinceVersion),
    ),
  });

  // Fetch changed events
  let changedEvents: typeof events.$inferSelect[] = [];
  if (calendarIds.length > 0) {
    changedEvents = await db.query.events.findMany({
      where: and(
        inArray(events.calendarId, calendarIds),
        gt(events.syncVersion, sinceVersion),
      ),
    });
  }

  // Fetch reminders for changed events
  const changedEventIds = changedEvents.map((e) => e.id);
  let changedReminders: typeof reminders.$inferSelect[] = [];
  if (changedEventIds.length > 0) {
    changedReminders = await db.query.reminders.findMany({
      where: inArray(reminders.eventId, changedEventIds),
    });
  }

  // Compute current max version across all entities
  const allVersions = [
    ...changedCalendars.map((c) => c.syncVersion),
    ...changedEvents.map((e) => e.syncVersion),
  ];
  const currentVersion = allVersions.length > 0 ? Math.max(...allVersions) : sinceVersion;

  return {
    changes: {
      calendars: { upserted: changedCalendars, deleted: [] as string[] },
      events: { upserted: changedEvents, deleted: [] as string[] },
      reminders: { upserted: changedReminders, deleted: [] as string[] },
    },
    currentVersion,
  };
}
