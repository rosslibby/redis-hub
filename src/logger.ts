import pino from 'pino';
import { HubLogger } from './types';

const NOOP_LOGGER: HubLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

let defaultLogger: HubLogger | null = null;

/**
 * Plain JSON pino output — no `transport` here on purpose. pino's transport
 * workers need `pino-pretty` resolvable in the *consumer's* node_modules,
 * which isn't guaranteed. For colorized local dev output, pipe stdout
 * through `pino-pretty` yourself (pino's own recommended pattern):
 *   node app.js | npx pino-pretty
 */
function getDefaultLogger(): HubLogger {
  if (!defaultLogger) {
    defaultLogger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
  }
  return defaultLogger;
}

export function resolveLogger(logger?: HubLogger | false): HubLogger {
  if (logger === false) {
    return NOOP_LOGGER;
  }
  if (logger) {
    return logger;
  }
  return getDefaultLogger();
}

export function childLogger(logger: HubLogger, bindings: Record<string, unknown>): HubLogger {
  const maybeChild = (logger as { child?: (bindings: Record<string, unknown>) => HubLogger }).child;
  if (typeof maybeChild === 'function') {
    return maybeChild.call(logger, bindings);
  }
  return logger;
}
