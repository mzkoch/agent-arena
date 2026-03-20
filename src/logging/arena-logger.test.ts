import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../domain/types';
import { FileArenaLogger } from './arena-logger';

const FIXED_TIMESTAMP = '2026-01-02T03:04:05.000Z';

interface ConsoleLoggerSpies {
  logger: Logger;
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

const createConsoleLogger = (): ConsoleLoggerSpies => {
  const debug = vi.fn();
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();

  return {
    logger: { debug, info, warn, error },
    debug,
    info,
    warn,
    error
  };
};

const readSessionEvents = async (logDir: string): Promise<Record<string, unknown>[]> => {
  const content = await readFile(path.join(logDir, 'session.jsonl'), 'utf8');
  return content
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

const readPtyLog = async (logDir: string, variant: string): Promise<string> =>
  readFile(path.join(logDir, `${variant}.log`), 'utf8');

describe('FileArenaLogger', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_TIMESTAMP));
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-logger-'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('creates the log directory recursively on construction', async () => {
    const logDir = path.join(tempDir, 'nested', 'logs');
    new FileArenaLogger(logDir);

    const directoryStats = await stat(logDir);
    expect(directoryStats.isDirectory()).toBe(true);
  });

  it('writes arena lifecycle events to session.jsonl', async () => {
    const logDir = path.join(tempDir, 'logs');
    const logger = new FileArenaLogger(logDir);

    logger.logEvent('arena.start', {
      variants: ['alpha', 'beta'],
      maxContinues: 5,
      agentTimeoutMs: 120_000
    });
    await logger.close();

    await expect(readSessionEvents(logDir)).resolves.toEqual([
      {
        ts: FIXED_TIMESTAMP,
        event: 'arena.start',
        variants: ['alpha', 'beta'],
        maxContinues: 5,
        agentTimeoutMs: 120_000
      }
    ]);
  });

  it('preserves agent spawn metadata in structured events', async () => {
    const logDir = path.join(tempDir, 'logs');
    const logger = new FileArenaLogger(logDir);

    logger.logEvent('agent.spawn', {
      variant: 'alpha',
      pid: 1234,
      command: 'copilot',
      args: ['--model', 'gpt-5.4'],
      model: 'gpt-5.4',
      worktreePath: '/tmp/alpha'
    });
    await logger.close();

    const [event] = await readSessionEvents(logDir);
    expect(event).toMatchObject({
      event: 'agent.spawn',
      variant: 'alpha',
      pid: 1234,
      command: 'copilot',
      args: ['--model', 'gpt-5.4'],
      model: 'gpt-5.4',
      worktreePath: '/tmp/alpha'
    });
  });

  it('records agent state transitions with from/to values', async () => {
    const logDir = path.join(tempDir, 'logs');
    const logger = new FileArenaLogger(logDir);

    logger.logEvent('agent.state', {
      variant: 'alpha',
      from: 'pending',
      to: 'running'
    });
    await logger.close();

    const [event] = await readSessionEvents(logDir);
    expect(event).toMatchObject({
      event: 'agent.state',
      variant: 'alpha',
      from: 'pending',
      to: 'running'
    });
  });

  it('records agent exit events with duration and signal fields', async () => {
    const logDir = path.join(tempDir, 'logs');
    const logger = new FileArenaLogger(logDir);

    logger.logEvent('agent.exit', {
      variant: 'alpha',
      exitCode: 1,
      durationMs: 7_500,
      signal: 15
    });
    await logger.close();

    const [event] = await readSessionEvents(logDir);
    expect(event).toMatchObject({
      event: 'agent.exit',
      variant: 'alpha',
      exitCode: 1,
      durationMs: 7_500,
      signal: 15
    });
  });

  it('records agent completion reasons', async () => {
    const logDir = path.join(tempDir, 'logs');
    const logger = new FileArenaLogger(logDir);

    logger.logEvent('agent.complete', {
      variant: 'alpha',
      reason: 'done_marker',
      exitCode: 0
    });
    await logger.close();

    const [event] = await readSessionEvents(logDir);
    expect(event).toMatchObject({
      event: 'agent.complete',
      variant: 'alpha',
      reason: 'done_marker',
      exitCode: 0
    });
  });

  it('records idle check counts', async () => {
    const logDir = path.join(tempDir, 'logs');
    const logger = new FileArenaLogger(logDir);

    logger.logEvent('agent.idle_check', {
      variant: 'alpha',
      checksPerformed: 2
    });
    await logger.close();

    const [event] = await readSessionEvents(logDir);
    expect(event).toMatchObject({
      event: 'agent.idle_check',
      variant: 'alpha',
      checksPerformed: 2
    });
  });

  it('records idle response marker matches including null values', async () => {
    const logDir = path.join(tempDir, 'logs');
    const logger = new FileArenaLogger(logDir);

    logger.logEvent('agent.idle_response', { variant: 'alpha', markerMatched: 'done' });
    logger.logEvent('agent.idle_response', { variant: 'alpha', markerMatched: 'continue' });
    logger.logEvent('agent.idle_response', { variant: 'alpha', markerMatched: null });
    await logger.close();

    const events = await readSessionEvents(logDir);
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.markerMatched)).toEqual(
      expect.arrayContaining(['done', 'continue', null])
    );
  });

  it('logs error events and forwards them through the fallback logger', async () => {
    const logDir = path.join(tempDir, 'logs');
    const consoleLogger = createConsoleLogger();
    const logger = new FileArenaLogger(logDir, consoleLogger.logger);

    logger.error('Agent failed', { variant: 'alpha', exitCode: 1 });
    await logger.close();

    const [event] = await readSessionEvents(logDir);
    expect(event).toMatchObject({
      event: 'error',
      message: 'Agent failed',
      variant: 'alpha',
      exitCode: 1
    });
    expect(consoleLogger.error).toHaveBeenCalledWith('Agent failed', {
      variant: 'alpha',
      exitCode: 1
    });
  });

  it('logs warning events and forwards them through the fallback logger', async () => {
    const logDir = path.join(tempDir, 'logs');
    const consoleLogger = createConsoleLogger();
    const logger = new FileArenaLogger(logDir, consoleLogger.logger);

    logger.warn('Slow agent response', { variant: 'alpha' });
    await logger.close();

    const [event] = await readSessionEvents(logDir);
    expect(event).toMatchObject({
      event: 'warning',
      message: 'Slow agent response',
      variant: 'alpha'
    });
    expect(consoleLogger.warn).toHaveBeenCalledWith('Slow agent response', {
      variant: 'alpha'
    });
  });

  it('captures PTY output with a timestamp prefix', async () => {
    const logDir = path.join(tempDir, 'logs');
    const logger = new FileArenaLogger(logDir);

    logger.logPty('alpha', 'working\n');
    await logger.close();

    await expect(readPtyLog(logDir, 'alpha')).resolves.toBe(`[${FIXED_TIMESTAMP}] working\n`);
  });

  it('writes PTY output to separate files per variant', async () => {
    const logDir = path.join(tempDir, 'logs');
    const logger = new FileArenaLogger(logDir);

    logger.logPty('alpha', 'alpha-output\n');
    logger.logPty('beta', 'beta-output\n');
    await logger.close();

    await expect(readPtyLog(logDir, 'alpha')).resolves.toContain('alpha-output');
    await expect(readPtyLog(logDir, 'beta')).resolves.toContain('beta-output');
  });

  it('writes completion summaries as arena.summary events', async () => {
    const logDir = path.join(tempDir, 'logs');
    const logger = new FileArenaLogger(logDir);

    logger.writeSummary({
      agents: [
        {
          variant: 'alpha',
          status: 'completed',
          durationMs: 10_000,
          exitCode: 0,
          completionReason: 'done_marker',
          changedFiles: 3,
          linesAdded: 42
        }
      ],
      errors: ['Agent beta failed'],
      warnings: ['Agent alpha was idle once']
    });
    await logger.close();

    const [event] = await readSessionEvents(logDir);
    expect(event).toMatchObject({
      event: 'arena.summary',
      agents: [
        {
          variant: 'alpha',
          status: 'completed',
          durationMs: 10_000,
          exitCode: 0,
          completionReason: 'done_marker',
          changedFiles: 3,
          linesAdded: 42
        }
      ],
      errors: ['Agent beta failed'],
      warnings: ['Agent alpha was idle once']
    });
  });

  it('writes valid JSONL records with ts and event fields on every line', async () => {
    const logDir = path.join(tempDir, 'logs');
    const logger = new FileArenaLogger(logDir);

    logger.logEvent('arena.start', { variants: ['alpha'] });
    logger.warn('Agent warning', { variant: 'alpha' });
    logger.error('Agent error', { variant: 'beta' });
    logger.writeSummary({ agents: [], errors: [], warnings: [] });
    await logger.close();

    const rawContent = await readFile(path.join(logDir, 'session.jsonl'), 'utf8');
    const lines = rawContent.split('\n').filter(Boolean);

    expect(lines.length).toBe(4);
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed.ts).toBe(FIXED_TIMESTAMP);
      expect(typeof parsed.event).toBe('string');
    }
  });

  it('does not write additional session events after close', async () => {
    const logDir = path.join(tempDir, 'logs');
    const logger = new FileArenaLogger(logDir);

    logger.logEvent('arena.start', { variants: ['alpha'] });
    await logger.close();
    const before = await readFile(path.join(logDir, 'session.jsonl'), 'utf8');

    logger.logEvent('agent.spawn', { variant: 'alpha' });
    const after = await readFile(path.join(logDir, 'session.jsonl'), 'utf8');

    expect(after).toBe(before);
  });

  it('does not write PTY output after close', async () => {
    const logDir = path.join(tempDir, 'logs');
    const logger = new FileArenaLogger(logDir);

    logger.logPty('alpha', 'first\n');
    await logger.close();
    const before = await readPtyLog(logDir, 'alpha');

    logger.logPty('alpha', 'second\n');
    const after = await readPtyLog(logDir, 'alpha');

    expect(after).toBe(before);
  });

  it('reuses captured warning and error summaries when writeSummary receives empty arrays', async () => {
    const logDir = path.join(tempDir, 'logs');
    const logger = new FileArenaLogger(logDir);

    logger.warn('Slow agent response', { variant: 'alpha' });
    logger.error('Agent failed', { variant: 'beta', exitCode: 1 });
    logger.writeSummary({
      agents: [],
      errors: [],
      warnings: []
    });
    await logger.close();

    const events = await readSessionEvents(logDir);
    const summaryEvent = events.find((event) => event.event === 'arena.summary');
    expect(summaryEvent).toMatchObject({
      event: 'arena.summary',
      errors: ['Agent failed {"variant":"beta","exitCode":1}'],
      warnings: ['Slow agent response {"variant":"alpha"}']
    });
  });

  it('handles JSON serialization failures in logEvent gracefully', async () => {
    const consoleLogger = createConsoleLogger();
    const logDir = path.join(tempDir, 'serial-fail');
    const logger = new FileArenaLogger(logDir, consoleLogger.logger);

    // Create a circular reference that JSON.stringify cannot handle
    const circular: Record<string, unknown> = { key: 'value' };
    circular['self'] = circular;

    expect(() => {
      logger.logEvent('agent.spawn', circular);
    }).not.toThrow();

    // The error should have been reported via the fallback logger
    await logger.close();
    expect(consoleLogger.error).toHaveBeenCalled();
  });

  it('handles JSON serialization failures in formatSummaryMessage gracefully', async () => {
    const consoleLogger = createConsoleLogger();
    const logDir = path.join(tempDir, 'summary-serial-fail');
    const logger = new FileArenaLogger(logDir, consoleLogger.logger);

    // Create a circular reference for the context
    const circular: Record<string, unknown> = { variant: 'test' };
    circular['self'] = circular;

    expect(() => {
      logger.warn('test warning', circular);
    }).not.toThrow();

    await logger.close();
  });

  it('swallows file system failures without throwing', async () => {
    const invalidLogDir = path.join(tempDir, 'not-a-directory');
    await writeFile(invalidLogDir, 'occupied');
    const consoleLogger = createConsoleLogger();
    const logger = new FileArenaLogger(invalidLogDir, consoleLogger.logger);

    expect(() => {
      logger.logEvent('arena.start', { variants: ['alpha'] });
      logger.logPty('alpha', 'working\n');
      logger.warn('Still running', { variant: 'alpha' });
    }).not.toThrow();

    await logger.close();
    expect(consoleLogger.error).toHaveBeenCalled();
    await expect(access(path.join(invalidLogDir, 'session.jsonl'))).rejects.toThrow();
  });
});
