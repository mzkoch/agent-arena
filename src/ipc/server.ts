import net from 'node:net';
import type { Logger } from '../domain/types';
import type { ClientToServerMessage, ServerToClientMessage } from './protocol';
import { NdjsonParser, serializeNdjsonMessage } from './protocol';

export interface IpcServerOptions {
  host?: string;
  snapshotProvider: () => ServerToClientMessage;
  onMessage: (message: ClientToServerMessage) => Promise<void> | void;
  logger: Logger;
}

export class ArenaIpcServer {
  private readonly server: net.Server;
  private readonly sockets = new Set<net.Socket>();

  public constructor(private readonly options: IpcServerOptions) {
    this.server = net.createServer((socket) => {
      this.sockets.add(socket);
      socket.setEncoding('utf8');
      socket.write(serializeNdjsonMessage(this.options.snapshotProvider()));

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
        void Promise.resolve(this.handleIncomingMessages(messages)).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          socket.write(serializeNdjsonMessage({ type: 'error', message }));
        });
      });
      socket.on('error', (error) => {
        this.options.logger.warn('IPC socket error', { error: error.message });
        this.sockets.delete(socket);
      });
      socket.on('close', () => {
        this.sockets.delete(socket);
      });
    });
  }

  private async handleIncomingMessages(messages: ClientToServerMessage[]): Promise<void> {
    for (const message of messages) {
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
    for (const socket of this.sockets) {
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
