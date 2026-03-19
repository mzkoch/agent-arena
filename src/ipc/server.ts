import net from 'node:net';
import type { Logger } from '../domain/types';
import type { TerminalSnapshot } from '../terminal/types';
import type { ClientToServerMessage, ServerToClientMessage } from './protocol';
import { MUTATING_MESSAGE_TYPES, NdjsonParser, serializeNdjsonMessage } from './protocol';

export interface IpcServerOptions {
  host?: string;
  snapshotProvider: () => ServerToClientMessage;
  onMessage: (message: ClientToServerMessage) => Promise<void> | void;
  agentTerminalSnapshotProvider?: (agent: string) => TerminalSnapshot | undefined;
  logger: Logger;
}

export class ArenaIpcServer {
  private readonly server: net.Server;
  private readonly sockets = new Set<net.Socket>();
  private readonly clientTypes = new Map<net.Socket, 'controller' | 'monitor'>();
  private readonly readySockets = new Set<net.Socket>();

  public constructor(private readonly options: IpcServerOptions) {
    this.server = net.createServer((socket) => {
      this.sockets.add(socket);
      socket.setEncoding('utf8');

      const parser = new NdjsonParser<ClientToServerMessage>();
      socket.on('data', (chunk: string) => {
        let messages: ClientToServerMessage[];
        try {
          messages = parser.push(chunk);
        } catch (parseError: unknown) {
          const message = parseError instanceof Error ? parseError.message : String(parseError);
          this.options.logger.warn('Malformed IPC message from client', { error: message });
          socket.write(serializeNdjsonMessage({ type: 'error', message: `Bad request: ${message}` }));
          return;
        }
        void Promise.resolve(this.handleIncomingMessages(socket, messages)).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          socket.write(serializeNdjsonMessage({ type: 'error', message }));
        });
      });
      socket.on('error', (error) => {
        this.options.logger.warn('IPC socket error', { error: error.message });
        this.cleanupSocket(socket);
      });
      socket.on('close', () => {
        this.cleanupSocket(socket);
      });
    });
  }

  private cleanupSocket(socket: net.Socket): void {
    this.sockets.delete(socket);
    this.clientTypes.delete(socket);
    this.readySockets.delete(socket);
  }

  private async handleIncomingMessages(
    socket: net.Socket,
    messages: ClientToServerMessage[]
  ): Promise<void> {
    for (const message of messages) {
      if (message.type === 'connect') {
        this.clientTypes.set(socket, message.clientType);
        this.readySockets.add(socket);
        socket.write(serializeNdjsonMessage(this.options.snapshotProvider()));
        continue;
      }

      if (message.type === 'disconnect') {
        this.cleanupSocket(socket);
        socket.destroy();
        continue;
      }

      if (message.type === 'request-snapshot') {
        if (this.options.agentTerminalSnapshotProvider) {
          const terminalSnapshot = this.options.agentTerminalSnapshotProvider(message.agent);
          if (terminalSnapshot) {
            socket.write(serializeNdjsonMessage({
              type: 'agent-terminal-snapshot',
              agent: message.agent,
              snapshot: terminalSnapshot,
            }));
          }
        }
        continue;
      }

      // Reject mutating messages from monitor clients
      if (MUTATING_MESSAGE_TYPES.has(message.type)) {
        const clientType = this.clientTypes.get(socket);
        if (clientType === 'monitor') {
          socket.write(serializeNdjsonMessage({
            type: 'error',
            message: `Monitor clients cannot send "${message.type}" messages.`,
          }));
          continue;
        }
      }

      await this.options.onMessage(message);
    }
  }

  public async listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.on('error', reject);
      this.server.listen(0, this.options.host ?? '127.0.0.1', () => {
        const address = this.server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Unable to determine IPC server address.'));
          return;
        }

        this.options.logger.info('IPC server listening', { port: address.port });
        resolve(address.port);
      });
    });
  }

  public broadcast(message: ServerToClientMessage): void {
    const serialized = serializeNdjsonMessage(message);
    for (const socket of this.readySockets) {
      socket.write(serialized);
    }
  }

  public async close(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }

    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}
