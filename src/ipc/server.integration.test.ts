import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArenaIpcClient } from './client';
import { ArenaIpcServer } from './server';
import type { ClientToServerMessage } from './protocol';

describe('ArenaIpcServer + ArenaIpcClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hydrates with a snapshot, streams events, and forwards client commands', async () => {
    const receivedMessages: ClientToServerMessage[] = [];
    const server = new ArenaIpcServer({
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      snapshotProvider: () => ({
        type: 'snapshot',
        snapshot: {
          repoPath: '/tmp/repo',
          startedAt: new Date(0).toISOString(),
          headless: true,
          agents: []
        }
      }),
      onMessage: (message) => {
        receivedMessages.push(message);
      }
    });

    const port = await server.listen();
    const client = new ArenaIpcClient();
    const streamed: string[] = [];
    client.on('message', (message) => {
      if (message.type === 'agent-output') {
        streamed.push(message.chunk);
      }
    });

    const snapshot = await client.connect(port);
    expect(snapshot.snapshot.repoPath).toBe('/tmp/repo');

    server.broadcast({ type: 'agent-output', agent: 'alpha', chunk: 'hello' });
    client.send({ type: 'input', agent: 'alpha', data: 'world' });

    await vi.waitFor(() => {
      expect(streamed).toEqual(['hello']);
      expect(receivedMessages).toEqual([{ type: 'input', agent: 'alpha', data: 'world' }]);
    });

    client.close();
    await server.close();
  });
});
