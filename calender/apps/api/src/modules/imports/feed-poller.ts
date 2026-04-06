import { eq, and, lte, or } from 'drizzle-orm';
import { db } from '../../db/client';
import { importSources } from '../../db/schema';
import { logger } from '../../lib/logger';
import { syncFeed } from './imports.service';

/**
 * Feed Poller
 *
 * Runs as a background loop on the API server. Every 60 seconds, it
 * checks for feed subscriptions that are due for polling (based on
 * their last_run_at + polling_interval). For each due feed, it
 * triggers a sync.
 *
 * For production at scale, replace with BullMQ repeating jobs
 * per feed subscription.
 */

const POLL_CHECK_INTERVAL_MS = 60_000; // Check every 60 seconds
let pollTimer: ReturnType<typeof setInterval> | null = null;

export function startFeedPoller() {
  if (pollTimer) return;

  logger.info('Feed poller starting');
  pollTimer = setInterval(checkFeeds, POLL_CHECK_INTERVAL_MS);

  // Initial check after a short delay
  setTimeout(checkFeeds, 5000);
}

export function stopFeedPoller() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    logger.info('Feed poller stopped');
  }
}

async function checkFeeds() {
  try {
    const now = new Date();

    // Find active feed subscriptions that are due for polling
    const activeFeedSources = await db.query.importSources.findMany({
      where: and(
        eq(importSources.sourceType, 'ics_feed'),
        eq(importSources.status, 'active'),
      ),
    });

    for (const source of activeFeedSources) {
      // Determine if this feed is due
      const intervalMs = (source.pollingInterval || 3600) * 1000;
      const lastRun = source.lastRunAt ? new Date(source.lastRunAt) : new Date(0);
      const nextDue = new Date(lastRun.getTime() + intervalMs);

      if (now < nextDue) continue; // Not yet due

      // Sync this feed
      try {
        logger.debug({ sourceId: source.id, url: source.sourceUrl }, 'Polling feed');
        await syncFeed(source.id);
      } catch (error: any) {
        // Error is already recorded in syncFeed; just log here
        logger.warn(
          { sourceId: source.id, error: error.message },
          'Feed poll error (will retry next interval)',
        );
      }
    }

    // Also retry errored feeds periodically (every 4 intervals)
    const erroredFeeds = await db.query.importSources.findMany({
      where: and(
        eq(importSources.sourceType, 'ics_feed'),
        eq(importSources.status, 'error'),
      ),
    });

    for (const source of erroredFeeds) {
      const retryIntervalMs = (source.pollingInterval || 3600) * 4 * 1000;
      const lastRun = source.lastRunAt ? new Date(source.lastRunAt) : new Date(0);
      const nextRetry = new Date(lastRun.getTime() + retryIntervalMs);

      if (now < nextRetry) continue;

      try {
        logger.debug({ sourceId: source.id }, 'Retrying errored feed');
        await syncFeed(source.id);
      } catch {
        // Will remain in error status
      }
    }
  } catch (error) {
    logger.error({ error }, 'Feed poller check error');
  }
}
