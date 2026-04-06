import { z } from 'zod';

export const createFeedSchema = z.object({
  url: z.string().url(),
  name: z.string().optional(),
  calendarId: z.string().uuid().optional(),
  pollingInterval: z.number().int().min(300).optional(),
});
export type CreateFeedInput = z.infer<typeof createFeedSchema>;
