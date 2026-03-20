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

  it('ignores ESRCH on first kill (process group already gone)', async () => {
    if (process.platform === 'win32') return;

    vi.useFakeTimers();
    const esrchError = Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    const killSpy = vi.spyOn(process, 'kill')
      .mockImplementationOnce(() => { throw esrchError; })
      .mockImplementation(() => true);

    const termination = terminateProcessTree(999);
    await vi.advanceTimersByTimeAsync(300);
    await termination;

    expect(killSpy).toHaveBeenCalledTimes(2);
  });

  it('ignores ESRCH on second kill (process already gone)', async () => {
    if (process.platform === 'win32') return;

    vi.useFakeTimers();
    const esrchError = Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    const killSpy = vi.spyOn(process, 'kill')
      .mockImplementationOnce(() => true)
      .mockImplementationOnce(() => { throw esrchError; });

    const termination = terminateProcessTree(888);
    await vi.advanceTimersByTimeAsync(300);
    await termination;

    expect(killSpy).toHaveBeenCalledTimes(2);
  });

  it('rethrows non-ESRCH errors from first kill', async () => {
    if (process.platform === 'win32') return;

    vi.useFakeTimers();
    const epermError = Object.assign(new Error('EPERM'), { code: 'EPERM' });
    vi.spyOn(process, 'kill').mockImplementationOnce(() => { throw epermError; });

    await expect(terminateProcessTree(777)).rejects.toThrow('EPERM');
  });

  it('rethrows non-ESRCH errors from second kill', async () => {
    if (process.platform === 'win32') return;

    vi.useFakeTimers();
    const epermError = Object.assign(new Error('EPERM'), { code: 'EPERM' });
    vi.spyOn(process, 'kill')
      .mockImplementationOnce(() => true)
      .mockImplementationOnce(() => { throw epermError; });

    const termination = terminateProcessTree(666);
    await vi.advanceTimersByTimeAsync(300);
    await expect(termination).rejects.toThrow('EPERM');
  });
});
