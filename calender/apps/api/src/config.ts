export const config = {
  port: parseInt(process.env.API_PORT || '3100', 10),
  cors: {
    origin: (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:5174').split(',').map(s => s.trim()),
  },
  db: {
    url: process.env.DATABASE_URL || 'postgres://calendar:calendar@localhost:5432/calendar',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    accessExpiresIn: '15m',
    refreshExpiresIn: '7d',
    refreshExpiresInMs: 7 * 24 * 60 * 60 * 1000,
  },
  reminder: {
    pollIntervalMs: parseInt(process.env.REMINDER_POLL_MS || '15000', 10),
  },
  feed: {
    defaultPollingInterval: 3600,
  },
};
