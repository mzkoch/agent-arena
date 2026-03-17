import stripAnsi from 'strip-ansi';

const splitLines = (chunk: string): string[] =>
  chunk.split(/\r?\n/);

export class OutputBuffer {
  private readonly maxLines: number;
  private readonly lines: string[] = [];
  private trailing = '';

  public constructor(maxLines = 2000) {
    this.maxLines = maxLines;
  }

  public append(chunk: string): void {
    const normalizedChunk = chunk.replace(/\r\n/g, '\n');
    const combined = this.trailing + normalizedChunk;
    const parts = splitLines(combined);

    if (!combined.endsWith('\n')) {
      this.trailing = parts.pop() ?? '';
    } else {
      this.trailing = '';
      if (parts.at(-1) === '') {
        parts.pop();
      }
    }

    for (const line of parts) {
      this.lines.push(line);
    }

    while (this.lines.length > this.maxLines) {
      this.lines.shift();
    }
  }

  public getLines(): string[] {
    return [...this.lines, ...(this.trailing ? [this.trailing] : [])];
  }

  public getAnsiText(): string {
    return this.getLines().join('\n');
  }

  public getPlainText(): string {
    return stripAnsi(this.getAnsiText());
  }

  public getLineCount(): number {
    return this.getLines().length;
  }
}
