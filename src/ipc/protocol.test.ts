import { describe, expect, it } from 'vitest';
import { NdjsonParser, serializeNdjsonMessage } from './protocol';

describe('ipc protocol', () => {
  it('serializes and parses NDJSON messages across chunk boundaries', () => {
    const parser = new NdjsonParser<{ type: string; value: number }>();
    const messageA = serializeNdjsonMessage({ type: 'a', value: 1 });
    const messageB = serializeNdjsonMessage({ type: 'b', value: 2 });
    const firstPass = parser.push(`${messageA}${messageB.slice(0, 5)}`);
    const secondPass = parser.push(messageB.slice(5));

    expect(firstPass).toEqual([{ type: 'a', value: 1 }]);
    expect(secondPass).toEqual([{ type: 'b', value: 2 }]);
  });
});
