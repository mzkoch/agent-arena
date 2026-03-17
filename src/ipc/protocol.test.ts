import { describe, expect, it } from 'vitest';
import { NdjsonParser, serializeNdjsonMessage } from './protocol';
import type { ServerToClientMessage } from './protocol';

describe('ipc protocol', () => {
  it('serializes and parses NDJSON messages across chunk boundaries', () => {
    const parser = new NdjsonParser<ServerToClientMessage>();
    const messageA = serializeNdjsonMessage({ type: 'error', message: 'a' });
    const messageB = serializeNdjsonMessage({ type: 'error', message: 'b' });
    const firstPass = parser.push(`${messageA}${messageB.slice(0, 5)}`);
    const secondPass = parser.push(messageB.slice(5));

    expect(firstPass).toEqual([{ type: 'error', message: 'a' }]);
    expect(secondPass).toEqual([{ type: 'error', message: 'b' }]);
  });
});
