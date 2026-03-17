import { describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger';

describe('createLogger', () => {
  it('writes JSON logs and suppresses debug when verbose is off', () => {
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const quietLogger = createLogger(false);
    quietLogger.debug('hidden');
    quietLogger.info('shown', { scope: 'test' });

    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(String(writeSpy.mock.calls[0]?.[0])).toContain('"scope":"test"');
    writeSpy.mockRestore();
  });

  it('emits debug logs when verbose is on', () => {
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = createLogger(true);
    logger.debug('visible');

    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(String(writeSpy.mock.calls[0]?.[0])).toContain('"level":"debug"');
    writeSpy.mockRestore();
  });
});
