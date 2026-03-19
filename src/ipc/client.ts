import { EventEmitter } from 'node:events';
import net from 'node:net';
import type {
  ClientToServerMessage,
  DisconnectMessage,
  ServerToClientMessage,
  SnapshotMessage
} from './protocol';
import { NdjsonParser, serializeNdjsonMessage } from './protocol';

export class ArenaIpcClient extends EventEmitter<{
  message: [message: ServerToClientMessage];
  close: [];
}> {
  private socket?: net.Socket | undefined;

  public async connect(
    port: number,
    host = '127.0.0.1',
    clientType: 'controller' | 'monitor' = 'controller'
  ): Promise<SnapshotMessage> {
    if (this.socket && !this.socket.destroyed) {
      throw new Error('IPC client is already connected.');
    }

    const socket = new net.Socket();
    const parser = new NdjsonParser<ServerToClientMessage>();
    this.socket = socket;

    return new Promise((resolve, reject) => {
      let settled = false;

      const rejectOnce = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      };

      const handleError = (error: Error): void => {
        if (!settled) {
          rejectOnce(error);
          return;
        }
        this.emit('message', { type: 'error', message: error.message });
      };

      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        for (const message of parser.push(chunk)) {
          this.emit('message', message);
          if (!settled && message.type === 'snapshot') {
            settled = true;
            resolve(message);
          }
        }
      });
      socket.on('error', handleError);
      socket.on('close', () => {
        if (this.socket === socket) {
          this.socket = undefined;
        }
        if (!settled) {
          rejectOnce(new Error('Connection closed before initial snapshot was received.'));
        }
        this.emit('close');
      });
      socket.connect(port, host, () => {
        this.send({ type: 'connect', clientType });
      });
    });
  }

  public send(message: ClientToServerMessage): void {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('IPC client is not connected.');
    }
    this.socket.write(serializeNdjsonMessage(message));
  }

  public disconnect(): void {
    if (this.socket && !this.socket.destroyed) {
      const message: DisconnectMessage = { type: 'disconnect' };
      this.socket.write(serializeNdjsonMessage(message));
      this.socket.end();
      return;
    }
    this.close();
  }

  public close(): void {
    this.socket?.destroy();
    this.socket = undefined;
  }
}
