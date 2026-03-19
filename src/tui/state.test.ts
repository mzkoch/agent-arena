import { describe, expect, it } from 'vitest';
import type { ArenaSnapshot } from '../domain/types';
import type { TerminalSnapshot } from '../terminal/types';
import { applyDelta, applyServerMessage, detectVersionGap, hasActiveAgents } from './state';

const makeTerminal = (version = 0, rows = 3): TerminalSnapshot => ({
  cols: 80,
  rows,
  scrollback: 1000,
  lines: Array.from({ length: rows }, () => ''),
  cursor: { row: 0, col: 0, visible: true },
  version,
});

const makeSnapshot = (overrides: Partial<ArenaSnapshot> = {}): ArenaSnapshot => ({
  gitRoot: '/tmp',
  startedAt: new Date(0).toISOString(),
  headless: false,
  agents: [
    {
      name: 'alpha',
      provider: 'fake',
      model: 'gpt-5',
      branch: 'v/alpha',
      worktreePath: '/tmp/alpha',
      status: 'running',
      elapsedMs: 0,
      terminal: makeTerminal(),
      checksPerformed: 0,
      interactive: false,
    },
  ],
  ...overrides,
});

describe('applyDelta', () => {
  it('applies changed lines to terminal snapshot', () => {
    const terminal = makeTerminal(0, 3);
    const result = applyDelta(terminal, {
      version: 1,
      changedLines: [{ row: 0, content: 'hello' }, { row: 2, content: 'world' }],
      cursor: { row: 0, col: 5, visible: true },
    });

    expect(result.lines[0]).toBe('hello');
    expect(result.lines[1]).toBe('');
    expect(result.lines[2]).toBe('world');
    expect(result.version).toBe(1);
    expect(result.cursor.col).toBe(5);
  });

  it('ignores out-of-bounds row indices', () => {
    const terminal = makeTerminal(0, 2);
    const result = applyDelta(terminal, {
      version: 1,
      changedLines: [{ row: 5, content: 'oob' }],
    });

    expect(result.lines.length).toBe(2);
    expect(result.version).toBe(1);
  });

  it('preserves cursor when delta has no cursor', () => {
    const terminal = makeTerminal(0, 2);
    terminal.cursor = { row: 1, col: 3, visible: true };
    const result = applyDelta(terminal, {
      version: 1,
      changedLines: [],
    });

    expect(result.cursor.row).toBe(1);
    expect(result.cursor.col).toBe(3);
  });
});

describe('applyServerMessage', () => {
  it('applies snapshot message', () => {
    const snap = makeSnapshot();
    const newSnap = makeSnapshot({ gitRoot: '/new' });
    const result = applyServerMessage(snap, { type: 'snapshot', snapshot: newSnap });
    expect(result.gitRoot).toBe('/new');
  });

  it('applies agent-state message', () => {
    const snap = makeSnapshot();
    const updatedAgent = { ...snap.agents[0]!, status: 'completed' as const };
    const result = applyServerMessage(snap, {
      type: 'agent-state',
      agent: 'alpha',
      status: 'completed',
      snapshot: updatedAgent,
    });
    expect(result.agents[0]!.status).toBe('completed');
  });

  it('applies agent-terminal delta with correct version', () => {
    const snap = makeSnapshot();
    const result = applyServerMessage(snap, {
      type: 'agent-terminal',
      agent: 'alpha',
      delta: {
        version: 1,
        changedLines: [{ row: 0, content: 'updated' }],
        cursor: { row: 0, col: 7, visible: true },
      },
    });
    expect(result.agents[0]!.terminal.lines[0]).toBe('updated');
    expect(result.agents[0]!.terminal.version).toBe(1);
  });

  it('rejects agent-terminal delta with version gap', () => {
    const snap = makeSnapshot();
    const result = applyServerMessage(snap, {
      type: 'agent-terminal',
      agent: 'alpha',
      delta: {
        version: 5,
        changedLines: [{ row: 0, content: 'should not apply' }],
      },
    });
    // Snapshot unchanged when version gap
    expect(result.agents[0]!.terminal.lines[0]).toBe('');
    expect(result.agents[0]!.terminal.version).toBe(0);
  });

  it('applies agent-terminal-snapshot for recovery', () => {
    const snap = makeSnapshot();
    const newTerminal = makeTerminal(10, 3);
    newTerminal.lines[0] = 'recovered';

    const result = applyServerMessage(snap, {
      type: 'agent-terminal-snapshot',
      agent: 'alpha',
      snapshot: newTerminal,
    });
    expect(result.agents[0]!.terminal.version).toBe(10);
    expect(result.agents[0]!.terminal.lines[0]).toBe('recovered');
  });

  it('ignores error messages', () => {
    const snap = makeSnapshot();
    const result = applyServerMessage(snap, { type: 'error', message: 'oops' });
    expect(result).toBe(snap);
  });

  it('ignores delta for unknown agent', () => {
    const snap = makeSnapshot();
    const result = applyServerMessage(snap, {
      type: 'agent-terminal',
      agent: 'unknown',
      delta: {
        version: 1,
        changedLines: [{ row: 0, content: 'nope' }],
      },
    });
    expect(result).toBe(snap);
  });
});

describe('detectVersionGap', () => {
  it('returns agent name when version gap detected', () => {
    const snap = makeSnapshot();
    const result = detectVersionGap(snap, {
      type: 'agent-terminal',
      agent: 'alpha',
      delta: { version: 5, changedLines: [] },
    });
    expect(result).toBe('alpha');
  });

  it('returns null when version is sequential', () => {
    const snap = makeSnapshot();
    const result = detectVersionGap(snap, {
      type: 'agent-terminal',
      agent: 'alpha',
      delta: { version: 1, changedLines: [] },
    });
    expect(result).toBeNull();
  });

  it('returns null for non-terminal messages', () => {
    const snap = makeSnapshot();
    const result = detectVersionGap(snap, { type: 'error', message: 'test' });
    expect(result).toBeNull();
  });
});

describe('hasActiveAgents', () => {
  it('returns true when agents are running', () => {
    expect(hasActiveAgents(makeSnapshot())).toBe(true);
  });

  it('returns false when all agents are terminal', () => {
    const snap = makeSnapshot();
    snap.agents[0]!.status = 'completed';
    expect(hasActiveAgents(snap)).toBe(false);
  });
});
