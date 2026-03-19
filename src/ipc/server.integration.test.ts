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

  it('handles malformed JSON from client gracefully', async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const server = new ArenaIpcServer({
      logger,
      snapshotProvider: () => ({
        type: 'snapshot',
        snapshot: {
          gitRoot: '/tmp/project',
          startedAt: new Date(0).toISOString(),
          headless: true,
          agents: [],
        },
      }),
      onMessage: vi.fn(),
    });

    const port = await server.listen();

    // Connect a raw socket and send malformed data
    const net = await import('node:net');
    const rawSocket = new net.Socket();
    const errorMessages: string[] = [];

    await new Promise<void>((resolve) => {
      rawSocket.connect(port, '127.0.0.1', () => {
        rawSocket.setEncoding('utf8');
        rawSocket.on('data', (chunk: string) => {
          for (const line of chunk.split('\n').filter(Boolean)) {
            const msg = JSON.parse(line) as ServerToClientMessage;
            if (msg.type === 'error') {
              errorMessages.push(msg.message);
            }
          }
        });
        // Send invalid JSON
        rawSocket.write('not valid json\n');
        setTimeout(resolve, 100);
      });
    });

    expect(errorMessages.length).toBe(1);
    expect(errorMessages[0]).toMatch(/Bad request/);
    expect(logger.warn).toHaveBeenCalledWith(
      'Malformed IPC message from client',
      expect.objectContaining({ error: expect.any(String) as string })
    );

    rawSocket.destroy();
    await server.close();
  });

  it('handles disconnect message from client', async () => {
    const server = new ArenaIpcServer({
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      snapshotProvider: () => ({
        type: 'snapshot',
        snapshot: {
          gitRoot: '/tmp/project',
          startedAt: new Date(0).toISOString(),
          headless: true,
          agents: [],
        },
      }),
      onMessage: vi.fn(),
    });

    const port = await server.listen();
    const client = new ArenaIpcClient();
    await client.connect(port, '127.0.0.1', 'monitor');

    const closePromise = new Promise<void>((resolve) => {
      client.on('close', resolve);
    });

    // Send disconnect — server should destroy the socket
    client.disconnect();
    await closePromise;

    await server.close();
  });

  it('responds to request-snapshot with agent terminal snapshot', async () => {
    const terminalSnapshot = {
      cols: 120,
      rows: 40,
      scrollback: 100,
      lines: ['hello world'],
      cursor: { row: 0, col: 11, visible: true },
      version: 5,
    };

    const server = new ArenaIpcServer({
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      snapshotProvider: () => ({
        type: 'snapshot',
        snapshot: {
          gitRoot: '/tmp/project',
          startedAt: new Date(0).toISOString(),
          headless: true,
          agents: [],
        },
      }),
      onMessage: vi.fn(),
      agentTerminalSnapshotProvider: (agent: string) => {
        if (agent === 'alpha') {
          return terminalSnapshot;
        }
        return undefined;
      },
    });

    const port = await server.listen();
    const client = new ArenaIpcClient();
    const messages: ServerToClientMessage[] = [];
    client.on('message', (msg) => messages.push(msg));

    await client.connect(port, '127.0.0.1', 'controller');

    // Request snapshot for known agent
    client.send({ type: 'request-snapshot', agent: 'alpha' });

    await vi.waitFor(() => {
      expect(messages.some((m) => m.type === 'agent-terminal-snapshot')).toBe(true);
    });

    const snapshotMsg = messages.find((m) => m.type === 'agent-terminal-snapshot');
    expect(snapshotMsg).toEqual({
      type: 'agent-terminal-snapshot',
      agent: 'alpha',
      snapshot: terminalSnapshot,
    });

    // Request snapshot for unknown agent — no response
    const messageCountBefore = messages.length;
    client.send({ type: 'request-snapshot', agent: 'unknown' });

    // Give time for potential response
    await new Promise((r) => setTimeout(r, 50));
    expect(messages.length).toBe(messageCountBefore);

    client.close();
    await server.close();
  });

  it('request-snapshot is a no-op when provider is not configured', async () => {
    const server = new ArenaIpcServer({
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      snapshotProvider: () => ({
        type: 'snapshot',
        snapshot: {
          gitRoot: '/tmp/project',
          startedAt: new Date(0).toISOString(),
          headless: true,
          agents: [],
        },
      }),
      onMessage: vi.fn(),
      // No agentTerminalSnapshotProvider
    });

    const port = await server.listen();
    const client = new ArenaIpcClient();
    const messages: ServerToClientMessage[] = [];
    client.on('message', (msg) => messages.push(msg));

    await client.connect(port, '127.0.0.1', 'controller');

    const messageCountBefore = messages.length;
    client.send({ type: 'request-snapshot', agent: 'alpha' });

    await new Promise((r) => setTimeout(r, 50));
    // No additional messages should have been received
    expect(messages.length).toBe(messageCountBefore);

    client.close();
    await server.close();
  });

  it('rejects messages from clients that have not sent connect handshake', async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const onMessage = vi.fn();
    const server = new ArenaIpcServer({
      logger,
      snapshotProvider: () => ({
        type: 'snapshot',
        snapshot: {
          gitRoot: '/tmp/project',
          startedAt: new Date(0).toISOString(),
          headless: true,
          agents: [],
        },
      }),
      onMessage,
    });

    const port = await server.listen();

    const net = await import('node:net');
    const rawSocket = new net.Socket();
    const errorMessages: string[] = [];

    await new Promise<void>((resolve) => {
      rawSocket.connect(port, '127.0.0.1', () => {
        rawSocket.setEncoding('utf8');
        rawSocket.on('data', (chunk: string) => {
          for (const line of chunk.split('\n').filter(Boolean)) {
            const msg = JSON.parse(line) as ServerToClientMessage;
            if (msg.type === 'error') {
              errorMessages.push(msg.message);
            }
          }
        });
        // Send an input message without connecting first
        rawSocket.write(JSON.stringify({ type: 'input', agent: 'a', data: 'x' }) + '\n');
        setTimeout(resolve, 100);
      });
    });

    expect(errorMessages.length).toBe(1);
    expect(errorMessages[0]).toMatch(/connect/i);
    expect(onMessage).not.toHaveBeenCalled();

    rawSocket.destroy();
    await server.close();
  });
});
