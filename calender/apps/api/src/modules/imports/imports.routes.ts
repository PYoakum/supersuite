import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { createFeedSchema } from './imports.validators';
import * as importService from './imports.service';

export const importRoutes = new Hono();

importRoutes.use('*', authMiddleware);

importRoutes.post('/preview', async (c) => {
  const userId = c.get('userId');
  const { icsData } = await c.req.json();
  const result = await importService.previewIcs(userId, icsData);
  return c.json({
    events: result.events,
    warnings: result.warnings,
    sourceInfo: {
      calendarName: result.calendarName,
      eventCount: result.events.length,
    },
  });
});

importRoutes.post('/upload', async (c) => {
  const userId = c.get('userId');
  const { icsData, calendarId, filename } = await c.req.json();
  const result = await importService.importIcs(userId, icsData, calendarId, filename);
  return c.json(result);
});

importRoutes.post('/feeds', async (c) => {
  const userId = c.get('userId');
  const body = createFeedSchema.parse(await c.req.json());
  const result = await importService.subscribeFeed(userId, body);
  return c.json(result, 201);
});

importRoutes.post('/feeds/:id/sync', async (c) => {
  const result = await importService.syncFeed(c.req.param('id'));
  return c.json(result);
});

importRoutes.get('/sources', async (c) => {
  const userId = c.get('userId');
  const sources = await importService.listImportSources(userId);
  return c.json(sources);
});

importRoutes.get('/sources/:id', async (c) => {
  const userId = c.get('userId');
  const source = await importService.getImportSource(userId, c.req.param('id'));
  return c.json(source);
});

importRoutes.delete('/feeds/:id', async (c) => {
  const userId = c.get('userId');
  const result = await importService.deleteFeed(userId, c.req.param('id'));
  return c.json(result);
});
