import { z } from 'zod';

export const createReminderSchema = z.object({
  eventId: z.string().uuid(),
  offsetMinutes: z.number().int().min(0),
});
export type CreateReminderInput = z.infer<typeof createReminderSchema>;

export const updateReminderSchema = z.object({
  offsetMinutes: z.number().int().min(0).optional(),
  triggerAt: z.string().optional(),
});
export type UpdateReminderInput = z.infer<typeof updateReminderSchema>;

export const snoozeReminderSchema = z.object({
  minutes: z.number().int().min(1),
});
export type SnoozeReminderInput = z.infer<typeof snoozeReminderSchema>;
