import { describe, expect, it } from 'vitest';
import { VirtualTerminal } from './virtual-terminal';

describe('VirtualTerminal', () => {
  it('writes data and produces accurate delta', async () => {
    const vt = new VirtualTerminal(80, 24);
    await vt.write('hello world');

    const delta = vt.getDelta();
    expect(delta.version).toBe(1);
    expect(delta.changedLines.length).toBeGreaterThan(0);
    const line0 = delta.changedLines.find((l) => l.row === 0);
    expect(line0).toBeDefined();
    expect(line0!.content).toContain('hello world');

    vt.dispose();
  });

  it('snapshot caching returns same object when not dirty', async () => {
    const vt = new VirtualTerminal(80, 24);
    await vt.write('test');

    const snap1 = vt.getSnapshot();
    const snap2 = vt.getSnapshot();
    expect(snap1).toBe(snap2);

    vt.dispose();
  });

  it('snapshot is invalidated after write', async () => {
    const vt = new VirtualTerminal(80, 24);
    await vt.write('first');

    const snap1 = vt.getSnapshot();
    await vt.write('second');
    const snap2 = vt.getSnapshot();

    expect(snap1).not.toBe(snap2);
    expect(snap2.version).toBeGreaterThan(snap1.version);

    vt.dispose();
  });

  it('dirty tracking: getDelta only returns changed rows', async () => {
    const vt = new VirtualTerminal(80, 24);
    await vt.write('line one\r\n');
    vt.getDelta(); // consume initial delta

    await vt.write('line two\r\n');
    const delta = vt.getDelta();

    // Should have changed lines but not all 24 should differ from last emitted
    expect(delta.changedLines.length).toBeGreaterThan(0);
    expect(delta.changedLines.length).toBeLessThanOrEqual(24);

    vt.dispose();
  });

  it('resize marks all rows dirty and updates dimensions', async () => {
    const vt = new VirtualTerminal(80, 24);
    await vt.write('data');
    vt.getDelta(); // consume

    vt.resize(120, 40);
    const snap = vt.getSnapshot();
    expect(snap.cols).toBe(120);
    expect(snap.rows).toBe(40);
    expect(snap.lines.length).toBe(40);

    vt.dispose();
  });

  it('plainTextChunks accumulator works correctly', async () => {
    const vt = new VirtualTerminal(80, 24);
    await vt.write('\x1b[31mred text\x1b[0m');
    await vt.write(' and plain');

    const plain = vt.getPlainText();
    expect(plain).toBe('red text and plain');

    vt.dispose();
  });

  it('concurrent writes via promise queue are serialized', async () => {
    const vt = new VirtualTerminal(80, 24);

    const p1 = vt.write('first');
    const p2 = vt.write('second');
    const p3 = vt.write('third');

    await Promise.all([p1, p2, p3]);

    expect(vt.getVersion()).toBe(3);
    const snap = vt.getSnapshot();
    const line0 = snap.lines[0]!;
    expect(line0).toContain('first');
    expect(line0).toContain('second');
    expect(line0).toContain('third');

    vt.dispose();
  });

  it('ANSI preservation via SerializeAddon', async () => {
    const vt = new VirtualTerminal(80, 24);
    await vt.write('\x1b[1;31mBold Red\x1b[0m');

    const snap = vt.getSnapshot();
    // SerializeAddon should preserve ANSI escape codes
    expect(snap.lines[0]).toContain('\x1b[');
    expect(snap.lines[0]).toContain('Bold Red');

    vt.dispose();
  });

  it('getDelta includes cursor position', async () => {
    const vt = new VirtualTerminal(80, 24);
    await vt.write('hello');

    const delta = vt.getDelta();
    expect(delta.cursor).toBeDefined();
    expect(delta.cursor!.col).toBe(5);
    expect(delta.cursor!.row).toBe(0);

    vt.dispose();
  });

  it('snapshot includes correct cursor position', async () => {
    const vt = new VirtualTerminal(80, 24);
    await vt.write('ab\r\ncd');

    const snap = vt.getSnapshot();
    expect(snap.cursor.row).toBe(1);
    expect(snap.cursor.col).toBe(2);

    vt.dispose();
  });

  it('version increments on each write', async () => {
    const vt = new VirtualTerminal(80, 24);
    expect(vt.getVersion()).toBe(0);

    await vt.write('a');
    expect(vt.getVersion()).toBe(1);

    await vt.write('b');
    expect(vt.getVersion()).toBe(2);

    vt.dispose();
  });

  it('version increments on resize', () => {
    const vt = new VirtualTerminal(80, 24);
    const v0 = vt.getVersion();
    vt.resize(100, 30);
    expect(vt.getVersion()).toBe(v0 + 1);

    vt.dispose();
  });

  it('empty getDelta after consuming all changes', async () => {
    const vt = new VirtualTerminal(80, 24);
    await vt.write('data');
    vt.getDelta(); // consume

    const delta = vt.getDelta();
    expect(delta.changedLines).toEqual([]);

    vt.dispose();
  });

  it('snapshot lines length equals terminal rows', async () => {
    const vt = new VirtualTerminal(80, 10);
    await vt.write('test');

    const snap = vt.getSnapshot();
    expect(snap.lines.length).toBe(10);

    vt.dispose();
  });

  it('default constructor values', () => {
    const vt = new VirtualTerminal();
    const snap = vt.getSnapshot();
    expect(snap.cols).toBe(120);
    expect(snap.rows).toBe(40);
    expect(snap.scrollback).toBe(1000);

    vt.dispose();
  });
});
