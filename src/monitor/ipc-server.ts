import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ArenaProvider,
  ArenaSession,
  ServerMessage,
  ClientMessage,
  SnapshotMessage,
  EventMessage,
} from './types.js';

export class IpcServer {
  private server: net.Server;
  private clients: Set<net.Socket> = new Set();
  private provider: ArenaProvider;
  private repoPath: string;
  private variantNames: string[];
  private port = 0;

  constructor(provider: ArenaProvider, repoPath: string, variantNames: string[]) {
    this.provider = provider;
    this.repoPath = repoPath;
    this.variantNames = variantNames;
    this.server = net.createServer((socket) => this.handleConnection(socket));
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.listen(0, '127.0.0.1', async () => {
        const addr = this.server.address();
        if (typeof addr === 'object' && addr) {
          this.port = addr.port;

          // Write session file
          const session: ArenaSession = {
            port: this.port,
            pid: process.pid,
            startedAt: new Date().toISOString(),
            repoPath: this.repoPath,
            variants: this.variantNames,
          };
          await fs.writeFile(
            path.join(this.repoPath, '.arena-session.json'),
            JSON.stringify(session, null, 2),
            'utf-8',
          );

          this.setupProviderListeners();
          resolve(this.port);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });
      this.server.on('error', reject);
    });
  }

  private handleConnection(socket: net.Socket): void {
    this.clients.add(socket);

    // Send snapshot on connect
    const status = this.provider.getStatus();
    const outputBuffers: Record<string, string[]> = {};
    for (const name of this.variantNames) {
      outputBuffers[name] = this.provider.getOutputBuffer(name);
    }

    const snapshot: SnapshotMessage = { type: 'snapshot', status, outputBuffers };
    this.sendToClient(socket, snapshot);

    // Handle client input
    let buffer = '';
    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as ClientMessage;
          if (msg.type === 'input') {
            this.provider.sendInput(msg.variantName, msg.data);
          }
        } catch {
          // Ignore malformed messages
        }
      }
    });

    socket.on('close', () => {
      this.clients.delete(socket);
    });

    socket.on('error', () => {
      this.clients.delete(socket);
    });
  }

  private setupProviderListeners(): void {
    this.provider.on('agent-output', (variantName: string, line: string) => {
      this.broadcast({
        type: 'event',
        event: { type: 'agent-output', variantName, line },
      });
    });

    this.provider.on('agent-started', (variantName: string, pid: number) => {
      this.broadcast({
        type: 'event',
        event: { type: 'agent-started', variantName, pid },
      });
    });

    this.provider.on('agent-completed', (variantName: string, exitCode: number | null) => {
      this.broadcast({
        type: 'event',
        event: { type: 'agent-completed', variantName, exitCode },
      });
    });

    this.provider.on('agent-error', (variantName: string, error: string) => {
      this.broadcast({
        type: 'event',
        event: { type: 'agent-error', variantName, error },
      });
    });
  }

  private broadcast(msg: ServerMessage): void {
    const line = JSON.stringify(msg) + '\n';
    for (const client of this.clients) {
      try {
        client.write(line);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  private sendToClient(socket: net.Socket, msg: ServerMessage): void {
    try {
      socket.write(JSON.stringify(msg) + '\n');
    } catch {
      // Client disconnected
    }
  }

  async stop(): Promise<void> {
    for (const client of this.clients) {
      client.destroy();
    }
    this.clients.clear();

    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  getPort(): number {
    return this.port;
  }
}
