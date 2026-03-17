import type { Logger } from '../domain/types';

const writeLog = (
  level: string,
  message: string,
  context?: Record<string, unknown>
): void => {
  const payload = {
    level,
    message,
    ...context
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
};

export const createLogger = (verbose: boolean): Logger => ({
  debug(message, context) {
    if (verbose) {
      writeLog('debug', message, context);
    }
  },
  info(message, context) {
    writeLog('info', message, context);
  },
  warn(message, context) {
    writeLog('warn', message, context);
  },
  error(message, context) {
    writeLog('error', message, context);
  }
});
