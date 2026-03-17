import treeKill from 'tree-kill';

/**
 * Ring buffer that keeps the last N lines of output per agent.
 */
export class OutputBuffer {
  private lines: string[] = [];
  private maxLines: number;

  constructor(maxLines: number = 2000) {
    this.maxLines = maxLines;
  }

  push(line: string): void {
    this.lines.push(line);
    if (this.lines.length > this.maxLines) {
      this.lines.shift();
    }
  }

  getLines(): string[] {
    return [...this.lines];
  }

  getLastN(n: number): string[] {
    return this.lines.slice(-n);
  }

  clear(): void {
    this.lines = [];
  }

  get length(): number {
    return this.lines.length;
  }
}

/**
 * Format elapsed time from milliseconds to a human-readable string.
 * e.g., "2m 34s", "1h 05m", "45s"
 */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

/**
 * Kill a process tree by PID. Returns a promise that resolves when done.
 * Cross-platform: works on Windows, macOS, Linux.
 */
export function killProcessTree(pid: number, signal: string = 'SIGTERM'): Promise<void> {
  return new Promise((resolve, reject) => {
    treeKill(pid, signal, (err) => {
      if (err) {
        // Ignore "no such process" errors (already exited)
        if ((err as NodeJS.ErrnoException).code === 'ESRCH' || 
            err.message?.includes('No such process')) {
          resolve();
        } else {
          reject(err);
        }
      } else {
        resolve();
      }
    });
  });
}
