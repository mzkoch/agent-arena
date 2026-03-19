import type { Terminal as TerminalType } from '@xterm/headless';
import type { SerializeAddon as SerializeAddonType } from '@xterm/addon-serialize';
import xtermHeadless from '@xterm/headless';
import xtermSerialize from '@xterm/addon-serialize';
const { Terminal } = xtermHeadless;
const { SerializeAddon } = xtermSerialize;
import stripAnsi from 'strip-ansi';
import type { TerminalCursor, TerminalDelta, TerminalSnapshot } from '../terminal/types';

export class VirtualTerminal {
  private readonly terminal: TerminalType;
  private readonly serializer: SerializeAddonType;
  private readonly dirtyRows = new Set<number>();
  private readonly lastEmitted = new Map<number, string>();
  private readonly plainTextChunks: string[] = [];
  private plainTextLength = 0;
  private static readonly MAX_PLAIN_TEXT_LENGTH = 1_000_000;

  private writeQueue: Promise<void> = Promise.resolve();
  private version = 0;
  private snapshotDirty = true;
  private cachedSnapshot: TerminalSnapshot | null = null;

  public constructor(cols = 120, rows = 40, scrollback = 1000) {
    this.terminal = new Terminal({ cols, rows, scrollback, allowProposedApi: true });
    this.serializer = new SerializeAddon();
    this.terminal.loadAddon(this.serializer);
  }

  public write(data: string): Promise<void> {
    const plain = stripAnsi(data);
    this.plainTextChunks.push(plain);
    this.plainTextLength += plain.length;

    // Bound the accumulator to prevent unbounded memory growth
    while (this.plainTextLength > VirtualTerminal.MAX_PLAIN_TEXT_LENGTH && this.plainTextChunks.length > 1) {
      const removed = this.plainTextChunks.shift()!;
      this.plainTextLength -= removed.length;
    }

    this.writeQueue = this.writeQueue.then(
      () =>
        new Promise<void>((resolve) => {
          this.terminal.write(data, () => {
            this.snapshotDirty = true;
            this.version += 1;
            for (let i = 0; i < this.terminal.rows; i++) {
              this.dirtyRows.add(i);
            }
            resolve();
          });
        })
    );
    return this.writeQueue;
  }

  public getSnapshot(): TerminalSnapshot {
    if (!this.snapshotDirty && this.cachedSnapshot) {
      return this.cachedSnapshot;
    }

    const lines: string[] = [];
    for (let i = 0; i < this.terminal.rows; i++) {
      lines.push(this.serializeRow(i));
    }

    this.cachedSnapshot = {
      cols: this.terminal.cols,
      rows: this.terminal.rows,
      scrollback: this.terminal.options.scrollback ?? 1000,
      lines,
      cursor: this.getCursor(),
      version: this.version,
    };
    this.snapshotDirty = false;
    return this.cachedSnapshot;
  }

  public getDelta(): TerminalDelta {
    const changedLines: Array<{ row: number; content: string }> = [];

    for (const row of this.dirtyRows) {
      const content = this.serializeRow(row);
      const previous = this.lastEmitted.get(row);
      if (content !== previous) {
        changedLines.push({ row, content });
        this.lastEmitted.set(row, content);
      }
    }

    this.dirtyRows.clear();

    return {
      version: this.version,
      changedLines,
      cursor: this.getCursor(),
    };
  }

  public getPlainText(): string {
    return this.plainTextChunks.join('');
  }

  public resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows);
    this.snapshotDirty = true;
    this.version += 1;
    for (let i = 0; i < rows; i++) {
      this.dirtyRows.add(i);
    }
  }

  public dispose(): void {
    this.terminal.dispose();
  }

  public getVersion(): number {
    return this.version;
  }

  private getCursor(): TerminalCursor {
    const buffer = this.terminal.buffer.active;
    return {
      row: buffer.cursorY,
      col: buffer.cursorX,
      visible: true,
    };
  }

  private serializeRow(row: number): string {
    return this.serializer.serialize({ range: { start: row, end: row } });
  }
}
