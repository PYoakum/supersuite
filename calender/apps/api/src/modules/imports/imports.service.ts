import { eq, and } from 'drizzle-orm';
import { db } from '../../db/client';
import { events, calendars, importSources } from '../../db/schema';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { parseIcs, type ParsedEvent, type IcsParseResult } from './ics-parser';
import type { CreateFeedInput } from './imports.validators';

/** Parse an ICS file and return a preview without importing */
export async function previewIcs(
  userId: string,
  icsData: string,
): Promise<IcsParseResult> {
  const result = parseIcs(icsData);
  return result;
}

/** Import events from ICS data into the user's calendar */
export async function importIcs(
  userId: string,
  icsData: string,
  calendarId?: string,
  filename?: string,
) {
  const parsed = parseIcs(icsData);

  // Resolve target calendar
  const targetCalendarId = calendarId || (await getDefaultCalendarId(userId));
  const calendar = await db.query.calendars.findFirst({
    where: and(eq(calendars.id, targetCalendarId), eq(calendars.userId, userId)),
  });
  if (!calendar) throw new NotFoundError('Calendar');

  // Import each event, deduplicating by UID + source
  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const parsedEvent of parsed.events) {
    try {
      const result = await upsertImportedEvent(
        targetCalendarId,
        parsedEvent,
        'ics_file',
        filename || 'upload',
      );
      if (result === 'created') imported++;
      else if (result === 'updated') updated++;
      else skipped++;
    } catch (err) {
      logger.warn({ uid: parsedEvent.uid, err }, 'Failed to import event');
      skipped++;
    }
  }

  // Record import source
  await db.insert(importSources).values({
    userId,
    calendarId: targetCalendarId,
    sourceType: 'ics_file',
    filename: filename || 'upload',
    status: 'active',
    lastRunAt: new Date(),
    lastSuccessAt: new Date(),
  });

  logger.info({ userId, imported, updated, skipped }, 'ICS import completed');

  return {
    imported,
    updated,
    skipped,
    warnings: parsed.warnings,
    calendarName: parsed.calendarName,
  };
}

/** Create a feed subscription and perform initial sync */
export async function subscribeFeed(userId: string, input: CreateFeedInput) {
  // Resolve target calendar — create one if not specified
  let targetCalendarId = input.calendarId;
  if (!targetCalendarId) {
    const calName = input.name || 'Subscribed Feed';
    const [newCal] = await db
      .insert(calendars)
      .values({
        userId,
        name: calName,
        type: 'subscribed',
        sourceType: 'ics_feed',
        sourceRef: input.url,
      })
      .returning();
    targetCalendarId = newCal.id;
  } else {
    const calendar = await db.query.calendars.findFirst({
      where: and(eq(calendars.id, targetCalendarId), eq(calendars.userId, userId)),
    });
    if (!calendar) throw new NotFoundError('Calendar');
  }

  // Record import source
  const [source] = await db
    .insert(importSources)
    .values({
      userId,
      calendarId: targetCalendarId,
      sourceType: 'ics_feed',
      sourceUrl: input.url,
      pollingInterval: input.pollingInterval || 3600,
      status: 'active',
    })
    .returning();

  // Perform initial sync
  const result = await syncFeed(source.id);

  logger.info({ userId, sourceId: source.id }, 'Feed subscription created');

  return { source, syncResult: result };
}

/** Sync a single feed subscription now */
export async function syncFeed(sourceId: string) {
  const source = await db.query.importSources.findFirst({
    where: eq(importSources.id, sourceId),
  });
  if (!source || source.sourceType !== 'ics_feed' || !source.sourceUrl) {
    throw new NotFoundError('Feed source');
  }

  try {
    // Fetch feed data
    const response = await fetch(source.sourceUrl);
    if (!response.ok) {
      throw new Error(`Feed returned HTTP ${response.status}`);
    }
    const icsData = await response.text();

    const parsed = parseIcs(icsData);

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (const parsedEvent of parsed.events) {
      try {
        const result = await upsertImportedEvent(
          source.calendarId,
          parsedEvent,
          'ics_feed',
          source.sourceUrl,
        );
        if (result === 'created') imported++;
        else if (result === 'updated') updated++;
        else skipped++;
      } catch {
        skipped++;
      }
    }

    // Update source status
    await db
      .update(importSources)
      .set({
        lastRunAt: new Date(),
        lastSuccessAt: new Date(),
        status: 'active',
        errorMessage: null,
      })
      .where(eq(importSources.id, sourceId));

    logger.info({ sourceId, imported, updated, skipped }, 'Feed sync completed');

    return { imported, updated, skipped, warnings: parsed.warnings };
  } catch (error: any) {
    // Record error
    await db
      .update(importSources)
      .set({
        lastRunAt: new Date(),
        status: 'error',
        errorMessage: error.message || 'Unknown error',
      })
      .where(eq(importSources.id, sourceId));

    logger.error({ sourceId, error: error.message }, 'Feed sync failed');
    throw error;
  }
}

/** Delete a feed subscription */
export async function deleteFeed(userId: string, sourceId: string) {
  const source = await db.query.importSources.findFirst({
    where: and(eq(importSources.id, sourceId), eq(importSources.userId, userId)),
  });
  if (!source) throw new NotFoundError('Feed source');

  await db.delete(importSources).where(eq(importSources.id, sourceId));
  logger.info({ sourceId, userId }, 'Feed subscription deleted');
  return { success: true };
}

/** List all import sources for a user */
export async function listImportSources(userId: string) {
  return db.query.importSources.findMany({
    where: eq(importSources.userId, userId),
    orderBy: (s, { desc }) => [desc(s.createdAt)],
  });
}

/** Get import history/details for a specific source */
export async function getImportSource(userId: string, sourceId: string) {
  const source = await db.query.importSources.findFirst({
    where: and(eq(importSources.id, sourceId), eq(importSources.userId, userId)),
  });
  if (!source) throw new NotFoundError('Import source');
  return source;
}

// ── Internal helpers ───────────────────────────────────────

/**
 * Upsert an imported event — deduplicates by UID + source identity.
 * Returns 'created', 'updated', or 'skipped'.
 */
async function upsertImportedEvent(
  calendarId: string,
  parsed: ParsedEvent,
  sourceType: string,
  sourceRef: string,
): Promise<'created' | 'updated' | 'skipped'> {
  // Check for existing event with same UID and source
  const existing = await db.query.events.findFirst({
    where: and(
      eq(events.calendarId, calendarId),
      eq(events.uid, parsed.uid),
      eq(events.sourceType, sourceType),
      eq(events.sourceRef, sourceRef),
    ),
  });

  const eventData = {
    calendarId,
    uid: parsed.uid,
    title: parsed.summary,
    description: parsed.description || null,
    location: parsed.location || null,
    startAt: new Date(parsed.dtstart),
    endAt: parsed.dtend ? new Date(parsed.dtend) : new Date(parsed.dtstart),
    timezone: 'UTC',
    allDay: parsed.allDay,
    recurrenceRule: parsed.rrule || null,
    organizer: parsed.organizer || null,
    sourceType,
    sourceRef,
  };

  if (existing) {
    // Update if content has changed
    const changed =
      existing.title !== eventData.title ||
      existing.description !== eventData.description ||
      existing.location !== eventData.location ||
      existing.startAt.getTime() !== eventData.startAt.getTime() ||
      existing.endAt.getTime() !== eventData.endAt.getTime() ||
      existing.recurrenceRule !== eventData.recurrenceRule;

    if (changed) {
      await db.update(events).set(eventData).where(eq(events.id, existing.id));
      return 'updated';
    }
    return 'skipped';
  }

  // Create new event
  await db.insert(events).values(eventData);
  return 'created';
}

async function getDefaultCalendarId(userId: string): Promise<string> {
  const defaultCal = await db.query.calendars.findFirst({
    where: and(eq(calendars.userId, userId), eq(calendars.isDefault, true)),
  });
  if (defaultCal) return defaultCal.id;

  // Fallback to first calendar
  const firstCal = await db.query.calendars.findFirst({
    where: eq(calendars.userId, userId),
  });
  if (firstCal) return firstCal.id;

  throw new NotFoundError('No calendars found');
}
