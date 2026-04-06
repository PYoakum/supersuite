import { z } from 'zod';

export const createCalendarSchema = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
});
export type CreateCalendarInput = z.infer<typeof createCalendarSchema>;

export const updateCalendarSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().optional(),
});
export type UpdateCalendarInput = z.infer<typeof updateCalendarSchema>;
