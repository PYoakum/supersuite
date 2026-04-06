import { z } from 'zod';

export const createEventSchema = z.object({
  calendarId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  startAt: z.string(),
  endAt: z.string(),
  allDay: z.boolean().default(false),
  recurrenceRule: z.string().optional(),
  timezone: z.string().optional(),
  reminders: z.array(z.object({ offsetMinutes: z.number() })).optional(),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = z.object({
  calendarId: z.string().uuid().optional(),
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  allDay: z.boolean().optional(),
  recurrenceRule: z.string().nullable().optional(),
  timezone: z.string().optional(),
});
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
