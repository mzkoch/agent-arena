import { mkdirSync } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '../domain/types';
import type { ArenaLogger, ArenaSummary } from './types';
import { createNullLogger } from '../utils/logger';

export class FileArenaLogger implements ArenaLogger {
  private readonly sessionLogPath: string;
  private readonly ptyLogPaths = new Map<string, string>();
  private readonly pendingWrites = new Set<Promise<void>>();
  private readonly errors: string[] = [];
  private readonly warnings: string[] = [];
  private sessionHandlePromise?: Promise<FileHandle> | undefined;
  private readonly ptyHandlePromises = new Map<string, Promise<FileHandle>>();
  private closed = false;

  public constructor(
    private readonly logDir: string,
    private readonly consoleLogger: Logger = createNullLogger()
  ) {
    this.sessionLogPath = path.join(logDir, 'session.jsonl');
    try {
      mkdirSync(logDir, { recursive: true });
    } catch (error) {
      this.reportFailure('Failed to create arena log directory', logDir, error);
    }
  }

  public debug(message: string, context?: Record<string, unknown>): void {
    this.consoleLogger.debug(message, context);
  }

  public info(message: string, context?: Record<string, unknown>): void {
    this.consoleLogger.info(message, context);
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    this.warnings.push(this.formatSummaryMessage(message, context));
    this.consoleLogger.warn(message, context);
    this.logEvent('warning', { message, ...(context ?? {}) });
  }

  public error(message: string, context?: Record<string, unknown>): void {
    this.errors.push(this.formatSummaryMessage(message, context));
    this.consoleLogger.error(message, context);
    this.logEvent('error', { message, ...(context ?? {}) });
  }

  public logEvent(event: string, data: Record<string, unknown> = {}): void {
    if (this.closed) {
      return;
    }

    let line: string;
    try {
      line = `${JSON.stringify({
        ts: new Date().toISOString(),
        event,
        ...data
      })}\n`;
    } catch (error) {
      this.reportFailure('Failed to serialize log event', event, error);
      return;
    }
    this.trackWrite(this.appendToFile(this.getSessionHandle.bind(this), line, this.sessionLogPath));
  }

  public logPty(variant: string, chunk: string): void {
    if (this.closed) {
      return;
    }

    const line = `[${new Date().toISOString()}] ${chunk}`;
    this.trackWrite(this.appendToFile(() => this.getPtyHandle(variant), line, this.getPtyLogPath(variant)));
  }

  public writeSummary(summary: ArenaSummary): void {
    if (this.closed) {
      return;
    }

    this.logEvent('arena.summary', {
      agents: summary.agents,
      errors: summary.errors.length > 0 ? summary.errors : [...this.errors],
      warnings: summary.warnings.length > 0 ? summary.warnings : [...this.warnings]
    });
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    await Promise.allSettled([...this.pendingWrites]);

    const handles = await Promise.allSettled([
      ...this.ptyHandlePromises.values(),
      ...(this.sessionHandlePromise ? [this.sessionHandlePromise] : [])
    ]);

    await Promise.allSettled(
      handles.map(async (result) => {
        if (result.status === 'fulfilled') {
          await result.value.close();
        }
      })
    );

    this.ptyHandlePromises.clear();
    this.sessionHandlePromise = undefined;
  }

  private getPtyLogPath(variant: string): string {
    const existingPath = this.ptyLogPaths.get(variant);
    if (existingPath) {
      return existingPath;
    }

    const logPath = path.join(this.logDir, `${variant}.log`);
    this.ptyLogPaths.set(variant, logPath);
    return logPath;
  }

  private getSessionHandle(): Promise<FileHandle> {
    if (!this.sessionHandlePromise) {
      this.sessionHandlePromise = this.openHandle(this.sessionLogPath, () => {
        this.sessionHandlePromise = undefined;
      });
    }
    return this.sessionHandlePromise;
  }

  private getPtyHandle(variant: string): Promise<FileHandle> {
    const existingHandle = this.ptyHandlePromises.get(variant);
    if (existingHandle) {
      return existingHandle;
    }

    const handlePromise = this.openHandle(this.getPtyLogPath(variant), () => {
      this.ptyHandlePromises.delete(variant);
    });
    this.ptyHandlePromises.set(variant, handlePromise);
    return handlePromise;
  }

  private async openHandle(
    filePath: string,
    resetHandle: () => void
  ): Promise<FileHandle> {
    try {
      return await open(filePath, 'a');
    } catch (error) {
      resetHandle();
      throw error;
    }
  }

  private trackWrite(write: Promise<void>): void {
    this.pendingWrites.add(write);
    void write.finally(() => {
      this.pendingWrites.delete(write);
    });
  }

  private async appendToFile(
    getHandle: () => Promise<FileHandle>,
    content: string,
    target: string
  ): Promise<void> {
    try {
      const handle = await getHandle();
      await handle.appendFile(content, 'utf8');
    } catch (error) {
      this.reportFailure('Failed to write arena log', target, error);
    }
  }

  private reportFailure(message: string, target: string, error: unknown): void {
    this.consoleLogger.error(message, {
      target,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  private formatSummaryMessage(
    message: string,
    context?: Record<string, unknown>
  ): string {
    if (!context || Object.keys(context).length === 0) {
      return message;
    }
    try {
      return `${message} ${JSON.stringify(context)}`;
    } catch {
      return message;
    }
  }
}
