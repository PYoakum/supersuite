import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config';
import { requestLogger } from './middleware/logger';
import { errorHandler } from './middleware/error-handler';
import { authRoutes } from './modules/auth/auth.routes';
import { calendarRoutes } from './modules/calendars/calendars.routes';
import { eventRoutes } from './modules/events/events.routes';
import { reminderRoutes } from './modules/reminders/reminders.routes';
import { importRoutes } from './modules/imports/imports.routes';
import { syncRoutes } from './modules/sync/sync.routes';
import { startReminderEngine, recoverMissedReminders } from './modules/reminders/reminder-engine';
import { startFeedPoller } from './modules/imports/feed-poller';
import { logger } from './lib/logger';

const app = new Hono();

// ── Global Middleware ──────────────────────────────────────
app.use('*', cors({ origin: config.cors.origin }));
app.use('*', requestLogger);

// ── Health Check ───────────────────────────────────────────
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── API Routes ─────────────────────────────────────────────
app.route('/api/auth', authRoutes);
app.route('/api/calendars', calendarRoutes);
app.route('/api/events', eventRoutes);
app.route('/api/reminders', reminderRoutes);
app.route('/api/imports', importRoutes);
app.route('/api/sync', syncRoutes);

// ── Error Handler ──────────────────────────────────────────
app.onError(errorHandler);

// ── Not Found ──────────────────────────────────────────────
app.notFound((c) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404),
);

// ── Background Services ────────────────────────────────────
logger.info({ port: config.port }, `Calendar API starting on port ${config.port}`);

// Recover any reminders missed while the server was down
recoverMissedReminders().catch((err) =>
  logger.error({ err }, 'Failed to recover missed reminders'),
);

// Start background polling loops
startReminderEngine();
startFeedPoller();

export default {
  port: config.port,
  fetch: app.fetch,
};
