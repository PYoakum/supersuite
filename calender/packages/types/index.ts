export interface User {
  id: string;
  email: string;
  name: string;
  timezone: string;
  preferences: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Calendar {
  id: string;
  userId: string;
  name: string;
  color: string;
  isDefault: boolean;
  type: string;
  sourceType?: string | null;
  sourceRef?: string | null;
  createdAt: string;
  updatedAt: string;
  syncVersion: number;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  uid?: string | null;
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: string;
  endAt: string;
  timezone: string;
  allDay: boolean;
  recurrenceRule?: string | null;
  organizer?: string | null;
  inviteStatus?: string | null;
  sourceType?: string | null;
  sourceRef?: string | null;
  createdAt: string;
  updatedAt: string;
  syncVersion: number;
}

export interface Reminder {
  id: string;
  eventId: string;
  triggerType: string;
  offsetMinutes?: number | null;
  triggerAt: string;
  status: string;
  snoozedUntil?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PendingReminder extends Reminder {
  event: CalendarEvent;
}

export interface ImportSource {
  id: string;
  userId: string;
  calendarId: string;
  sourceType: string;
  sourceUrl?: string | null;
  filename?: string | null;
  pollingInterval?: number | null;
  lastRunAt?: string | null;
  lastSuccessAt?: string | null;
  status: string;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const REMINDER_PRESETS = [
  { minutes: 0, label: 'At time of event' },
  { minutes: 5, label: '5 minutes before' },
  { minutes: 10, label: '10 minutes before' },
  { minutes: 15, label: '15 minutes before' },
  { minutes: 30, label: '30 minutes before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 1440, label: '1 day before' },
] as const;
