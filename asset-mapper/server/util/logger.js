// server/util/logger.js
import config from '../config.js';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const current = LEVELS[config.logLevel] ?? 1;

function log(level, ...args) {
  if (LEVELS[level] >= current) {
    const ts = new Date().toISOString();
    console[level === 'error' ? 'error' : 'log'](`[${ts}] [${level.toUpperCase()}]`, ...args);
  }
}

export const logger = {
  debug: (...a) => log('debug', ...a),
  info:  (...a) => log('info',  ...a),
  warn:  (...a) => log('warn',  ...a),
  error: (...a) => log('error', ...a),
};

export default logger;
