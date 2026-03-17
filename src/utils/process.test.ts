import { afterEach, describe, expect, it, vi } from 'vitest';
import { terminateProcessTree } from './process';

describe('terminateProcessTree', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('terminates unix process groups with a graceful fallback', async () => {
    if (process.platform === 'win32') {
      expect(true).toBe(true);
      return;
    }

    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const termination = terminateProcessTree(321);
    await vi.advanceTimersByTimeAsync(300);
    await termination;

    expect(killSpy).toHaveBeenNthCalledWith(1, -321, 'SIGTERM');
    expect(killSpy).toHaveBeenNthCalledWith(2, 321, 'SIGTERM');
  });
});
