import { lte, or, and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { reminders, events } from '../../db/schema';
import { logger } from '../../lib/logger';
import { config } from '../../config';

/**
 * Reminder Engine
 *
 * Runs as a background polling loop on the API server.
 * Every `pollIntervalMs`, it scans for reminders whose trigger_at (or
 * snoozed_until) has elapsed and marks them as "fired". The Electron
 * client then picks up fired reminders via GET /api/reminders/pending.
 *
 * This central scheduling approach ensures reminders fire even if
 * the client is offline; the client picks them up on reconnect.
 *
 * For production at scale, replace this polling loop with a
 * Redis sorted-set or BullMQ delayed-job approach.
 */

let pollTimer: ReturnType<typeof setInterval> | null = null;

export function startReminderEngine() {
  if (pollTimer) return;

  logger.info(
    { intervalMs: config.reminder.pollIntervalMs },
    'Reminder engine starting',
  );

  pollTimer = setInterval(processReminders, config.reminder.pollIntervalMs);

  // Run an initial pass immediately
  processReminders();
}

export function stopReminderEngine() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    logger.info('Reminder engine stopped');
  }
}

async function processReminders() {
  const now = new Date();

  try {
    // Find all pending reminders whose trigger time has passed
    const dueReminders = await db.query.reminders.findMany({
      where: or(
        and(eq(reminders.status, 'pending'), lte(reminders.triggerAt, now)),
        and(eq(reminders.status, 'snoozed'), lte(reminders.snoozedUntil, now)),
      ),
    });

    if (dueReminders.length === 0) return;

    // Mark them all as fired
    const ids = dueReminders.map((r) => r.id);
    for (const id of ids) {
      await db
        .update(reminders)
        .set({ status: 'fired' })
        .where(eq(reminders.id, id));
    }

    logger.info(
      { count: dueReminders.length },
      `Fired ${dueReminders.length} reminder(s)`,
    );
  } catch (error) {
    logger.error({ error }, 'Reminder engine error');
  }
}

/**
 * Recovery scan: on server startup, check for any reminders that should
 * have fired while the server was down. Mark them as fired so the
 * client can pick them up.
 */
export async function recoverMissedReminders() {
  const now = new Date();

  try {
    const missed = await db.query.reminders.findMany({
      where: or(
        and(eq(reminders.status, 'pending'), lte(reminders.triggerAt, now)),
        and(eq(reminders.status, 'snoozed'), lte(reminders.snoozedUntil, now)),
      ),
    });

    if (missed.length > 0) {
      for (const r of missed) {
        await db
          .update(reminders)
          .set({ status: 'fired' })
          .where(eq(reminders.id, r.id));
      }
      logger.info(
        { count: missed.length },
        `Recovered ${missed.length} missed reminder(s)`,
      );
    }
  } catch (error) {
    logger.error({ error }, 'Reminder recovery error');
  }
}
