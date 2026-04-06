import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  bigint,
  jsonb,
  date,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// ── Users ──────────────────────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  preferences: jsonb('preferences').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Calendars ──────────────────────────────────────────────
export const calendars = pgTable(
  'calendars',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#3B82F6'),
    isDefault: boolean('is_default').notNull().default(false),
    type: text('type').notNull().default('local'),
    sourceType: text('source_type'),
    sourceRef: text('source_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    syncVersion: bigint('sync_version', { mode: 'number' }).notNull().default(0),
  },
  (table) => [
    index('idx_calendars_user').on(table.userId),
  ],
);

// ── Events ─────────────────────────────────────────────────
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    calendarId: uuid('calendar_id').notNull().references(() => calendars.id, { onDelete: 'cascade' }),
    uid: text('uid'),
    title: text('title').notNull(),
    description: text('description'),
    location: text('location'),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    timezone: text('timezone').notNull().default('UTC'),
    allDay: boolean('all_day').notNull().default(false),
    recurrenceRule: text('recurrence_rule'),
    organizer: text('organizer'),
    inviteStatus: text('invite_status'),
    sourceType: text('source_type'),
    sourceRef: text('source_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    syncVersion: bigint('sync_version', { mode: 'number' }).notNull().default(0),
  },
  (table) => [
    index('idx_events_calendar').on(table.calendarId),
    index('idx_events_range').on(table.startAt, table.endAt),
    index('idx_events_uid_source').on(table.uid, table.sourceType, table.sourceRef),
    index('idx_events_sync').on(table.syncVersion),
  ],
);

// ── Event Exceptions ───────────────────────────────────────
export const eventExceptions = pgTable(
  'event_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentEventId: uuid('parent_event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    recurrenceInstanceDate: date('recurrence_instance_date').notNull(),
    overriddenStartAt: timestamp('overridden_start_at', { withTimezone: true }),
    overriddenEndAt: timestamp('overridden_end_at', { withTimezone: true }),
    overriddenTitle: text('overridden_title'),
    overriddenDescription: text('overridden_description'),
    overriddenLocation: text('overridden_location'),
    cancelled: boolean('cancelled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_exceptions_parent').on(table.parentEventId),
    uniqueIndex('idx_exceptions_unique').on(table.parentEventId, table.recurrenceInstanceDate),
  ],
);

// ── Reminders ──────────────────────────────────────────────
export const reminders = pgTable(
  'reminders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    triggerType: text('trigger_type').notNull().default('offset'),
    offsetMinutes: integer('offset_minutes'),
    triggerAt: timestamp('trigger_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('pending'),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_reminders_event').on(table.eventId),
    index('idx_reminders_pending').on(table.status, table.triggerAt),
  ],
);

// ── Import Sources ─────────────────────────────────────────
export const importSources = pgTable(
  'import_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    calendarId: uuid('calendar_id').notNull().references(() => calendars.id, { onDelete: 'cascade' }),
    sourceType: text('source_type').notNull(),
    sourceUrl: text('source_url'),
    filename: text('filename'),
    pollingInterval: integer('polling_interval').default(3600),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    status: text('status').notNull().default('active'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_imports_user').on(table.userId),
  ],
);

// ── Refresh Tokens ─────────────────────────────────────────
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_refresh_tokens_user').on(table.userId),
  ],
);
