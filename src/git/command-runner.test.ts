import { describe, expect, it } from 'vitest';
import { NodeCommandRunner } from './command-runner';

describe('NodeCommandRunner', () => {
  const runner = new NodeCommandRunner();

  it('runs a command and returns stdout, stderr, and exitCode', async () => {
    const result = await runner.run(process.execPath, ['-e', 'console.log("hello")']);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('returns non-zero exitCode for failing commands', async () => {
    const result = await runner.run(process.execPath, ['-e', 'process.exit(42)']);
    expect(result.exitCode).toBe(42);
    expect(result.timedOut).toBe(false);
  });

  it('captures stderr', async () => {
    const result = await runner.run(process.execPath, ['-e', 'process.stderr.write("err\\n")']);
    expect(result.stderr.trim()).toBe('err');
    expect(result.timedOut).toBe(false);
  });

  it('kills the process and sets timedOut when timeoutMs is exceeded', async () => {
    const result = await runner.run(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], { timeoutMs: 100 });
    expect(result.timedOut).toBe(true);
  }, 5_000);

  it('does not set timedOut when command finishes before timeout', async () => {
    const result = await runner.run(process.execPath, ['-e', 'console.log("fast")'], { timeoutMs: 5_000 });
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
  });
});
