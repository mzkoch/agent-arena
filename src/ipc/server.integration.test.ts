import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArenaIpcClient } from './client';
import { ArenaIpcServer } from './server';
import type { ClientToServerMessage, ServerToClientMessage } from './protocol';

describe('ArenaIpcServer + ArenaIpcClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hydrates with a snapshot after connect handshake, streams events, and forwards client commands', async () => {
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
          gitRoot: '/tmp/project',
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
    const streamed: ServerToClientMessage[] = [];
    client.on('message', (message) => {
      if (message.type === 'agent-state') {
        streamed.push(message);
      }
    });

    // Client sends connect handshake and waits for snapshot
    const snapshot = await client.connect(port, '127.0.0.1', 'controller');
    expect(snapshot.snapshot.gitRoot).toBe('/tmp/project');

    server.broadcast({
      type: 'agent-state',
      agent: 'alpha',
      status: 'running',
      snapshot: {
        name: 'alpha',
        provider: 'fake',
        model: 'gpt-5',
        branch: 'v/alpha',
        worktreePath: '/tmp/alpha',
        status: 'running',
        elapsedMs: 0,
        terminal: {
          cols: 120,
          rows: 40,
          scrollback: 1000,
          lines: [],
          cursor: { row: 0, col: 0, visible: true },
          version: 0,
        },
        checksPerformed: 0,
        interactive: false,
      },
    });
    client.send({ type: 'input', agent: 'alpha', data: 'world' });

    await vi.waitFor(() => {
      expect(streamed.length).toBe(1);
      expect(receivedMessages).toEqual([{ type: 'input', agent: 'alpha', data: 'world' }]);
    });

    client.close();
    await server.close();
  });

  it('server does not send snapshot before connect handshake', async () => {
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
          gitRoot: '/tmp/project',
          startedAt: new Date(0).toISOString(),
          headless: true,
          agents: []
        }
      }),
      onMessage: vi.fn()
    });

    const port = await server.listen();

    // Connect and send connect handshake — snapshot should only arrive after handshake
    const client = new ArenaIpcClient();
    const snapshot = await client.connect(port, '127.0.0.1', 'controller');
    expect(snapshot.type).toBe('snapshot');

    client.close();
    await server.close();
  });

  it('rejects mutating messages from monitor clients', async () => {
    const onMessage = vi.fn();
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
          gitRoot: '/tmp/project',
          startedAt: new Date(0).toISOString(),
          headless: true,
          agents: []
        }
      }),
      onMessage
    });

    const port = await server.listen();
    const client = new ArenaIpcClient();
    const errors: string[] = [];
    client.on('message', (msg) => {
      if (msg.type === 'error') {
        errors.push(msg.message);
      }
    });

    await client.connect(port, '127.0.0.1', 'monitor');

    client.send({ type: 'input', agent: 'alpha', data: 'test' });
    client.send({ type: 'kill', agent: 'alpha' });
    client.send({ type: 'restart', agent: 'alpha' });

    await vi.waitFor(() => {
      expect(errors.length).toBe(3);
    });

    // onMessage should NOT have been called for monitor mutating messages
    expect(onMessage).not.toHaveBeenCalled();

    client.close();
    await server.close();
  });

  it('allows mutating messages from controller clients', async () => {
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
          gitRoot: '/tmp/project',
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
    await client.connect(port, '127.0.0.1', 'controller');

    client.send({ type: 'input', agent: 'alpha', data: 'hello' });

    await vi.waitFor(() => {
      expect(receivedMessages.length).toBe(1);
    });

    expect(receivedMessages[0]).toEqual({ type: 'input', agent: 'alpha', data: 'hello' });

    client.close();
    await server.close();
  });

  it('broadcasts only to ready sockets', async () => {
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
          gitRoot: '/tmp/project',
          startedAt: new Date(0).toISOString(),
          headless: true,
          agents: []
        }
      }),
      onMessage: vi.fn()
    });

    const port = await server.listen();

    // Connect a client and complete handshake
    const client = new ArenaIpcClient();
    const messages: ServerToClientMessage[] = [];
    client.on('message', (msg) => messages.push(msg));
    await client.connect(port, '127.0.0.1', 'monitor');

    // Broadcast should reach the ready client
    server.broadcast({
      type: 'agent-state',
      agent: 'alpha',
      status: 'running',
      snapshot: {
        name: 'alpha',
        provider: 'fake',
        model: 'gpt-5',
        branch: 'v/alpha',
        worktreePath: '/tmp/alpha',
        status: 'running',
        elapsedMs: 0,
        terminal: {
          cols: 120,
          rows: 40,
          scrollback: 1000,
          lines: [],
          cursor: { row: 0, col: 0, visible: true },
          version: 0,
        },
        checksPerformed: 0,
        interactive: false,
      },
    });

    await vi.waitFor(() => {
      expect(messages.some((m) => m.type === 'agent-state')).toBe(true);
    });

    client.close();
    await server.close();
  });
});
