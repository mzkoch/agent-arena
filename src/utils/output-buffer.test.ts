import { describe, expect, it } from 'vitest';
import { OutputBuffer } from './output-buffer';

describe('OutputBuffer', () => {
  it('keeps partial lines and strips ansi text', () => {
    const buffer = new OutputBuffer(10);
    buffer.append('\u001B[31mhello');
    buffer.append(' world\u001B[39m\nnext line\n');

    expect(buffer.getLines()).toEqual(['\u001B[31mhello world\u001B[39m', 'next line']);
    expect(buffer.getPlainText()).toContain('hello world');
  });

  it('acts as a ring buffer', () => {
    const buffer = new OutputBuffer(2);
    buffer.append('a\nb\nc\n');
    expect(buffer.getLines()).toEqual(['b', 'c']);
  });
});
