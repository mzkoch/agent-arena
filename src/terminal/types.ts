export interface TerminalCursor {
  row: number;
  col: number;
  visible: boolean;
}

export interface TerminalSnapshot {
  cols: number;
  rows: number;
  scrollback: number;
  lines: string[];
  cursor: TerminalCursor;
  version: number;
}

export interface TerminalDelta {
  version: number;
  changedLines: Array<{ row: number; content: string }>;
  cursor?: TerminalCursor | undefined;
}
