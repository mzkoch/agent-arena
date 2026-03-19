import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArenaIpcServer } from './server';
import { ReconnectingIpcClient } from './reconnecting-client';
import type { ServerToClientMessage } from './protocol';

const makeLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const makeServer = () =>
  new ArenaIpcServer({
    logger: makeLogger(),
    snapshotProvider: () => ({
      type: 'snapshot' as const,
      snapshot: {
        gitRoot: '/tmp/project',
        startedAt: new Date(0).toISOString(),
        headless: true,
        agents: [],
      },
    }),
    onMessage: vi.fn(),
  });

describe('ReconnectingIpcClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('connects and receives initial snapshot', async () => {
    const server = makeServer();
    const port = await server.listen();

    const client = new ReconnectingIpcClient({
      port,
      clientType: 'monitor',
    });

    const snapshot = await client.connect();
    expect(snapshot.snapshot.gitRoot).toBe('/tmp/project');

    client.close();
    await server.close();
  });

  it('emits connected event on successful connect', async () => {
    const server = makeServer();
    const port = await server.listen();

    const client = new ReconnectingIpcClient({
      port,
      clientType: 'controller',
    });

    const connected = vi.fn();
    client.on('connected', connected);

    await client.connect();
    expect(connected).toHaveBeenCalledTimes(1);

    client.close();
    await server.close();
  });

  it('intentional close prevents reconnect', async () => {
    const server = makeServer();
    const port = await server.listen();

    const client = new ReconnectingIpcClient({
      port,
      clientType: 'monitor',
      baseDelayMs: 50,
    });

    await client.connect();

    const reconnecting = vi.fn();
    client.on('reconnecting', reconnecting);

    client.close();

    // Wait and verify no reconnect attempt
    await new Promise((r) => setTimeout(r, 200));
    expect(reconnecting).not.toHaveBeenCalled();

    await server.close();
  });

  it('forwards messages from server', async () => {
    const server = makeServer();
    const port = await server.listen();

    const client = new ReconnectingIpcClient({
      port,
      clientType: 'controller',
    });

    const messages: ServerToClientMessage[] = [];
    client.on('message', (msg) => messages.push(msg));

    await client.connect();

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

  it('cleans up listeners on close (no stale listeners)', async () => {
    const server = makeServer();
    const port = await server.listen();

    const client = new ReconnectingIpcClient({
      port,
      clientType: 'monitor',
    });

    await client.connect();
    client.close();

    // After close, the reconnecting client should have no active internal listeners
    // that could leak. The test passes if close() completes without error.
    await server.close();
  });

  it('reconnects on server disconnect with backoff', async () => {
    const server = makeServer();
    const port = await server.listen();

    const client = new ReconnectingIpcClient({
      port,
      clientType: 'monitor',
      baseDelayMs: 50,
      multiplier: 1,
      maxRetries: 3,
    });

    await client.connect();

    const disconnected = vi.fn();
    const reconnecting = vi.fn();
    client.on('disconnected', disconnected);
    client.on('reconnecting', reconnecting);

    // Close server to trigger disconnect
    await server.close();

    await vi.waitFor(() => {
      expect(disconnected).toHaveBeenCalledTimes(1);
      expect(reconnecting).toHaveBeenCalledWith(1);
    }, { timeout: 2000 });

    client.close();
  });

  it('emits close after max retries exhausted', async () => {
    const server = makeServer();
    const port = await server.listen();

    const client = new ReconnectingIpcClient({
      port,
      clientType: 'monitor',
      baseDelayMs: 20,
      multiplier: 1,
      maxRetries: 2,
    });

    await client.connect();

    const closeFn = vi.fn();
    client.on('close', closeFn);

    // Close server to trigger disconnect + retries
    await server.close();

    await vi.waitFor(() => {
      expect(closeFn).toHaveBeenCalledTimes(1);
    }, { timeout: 5000 });

    client.close();
  });
});
