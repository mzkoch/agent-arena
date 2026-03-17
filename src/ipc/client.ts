import { EventEmitter } from 'node:events';
import net from 'node:net';
import type { ClientToServerMessage, ServerToClientMessage, SnapshotMessage } from './protocol';
import { NdjsonParser, serializeNdjsonMessage } from './protocol';

export class ArenaIpcClient extends EventEmitter<{
  message: [message: ServerToClientMessage];
  close: [];
}> {
  private readonly socket = new net.Socket();

  public async connect(port: number, host = '127.0.0.1'): Promise<SnapshotMessage> {
    return new Promise((resolve, reject) => {
      const parser = new NdjsonParser<ServerToClientMessage>();
      let snapshotResolved = false;

      this.socket.setEncoding('utf8');
      this.socket.once('error', reject);
      this.socket.connect(port, host, () => {
        this.socket.on('data', (chunk: string) => {
          for (const message of parser.push(chunk)) {
            this.emit('message', message);
            if (!snapshotResolved && message.type === 'snapshot') {
              snapshotResolved = true;
              resolve(message);
            }
          }
        });
        this.socket.on('close', () => {
          this.emit('close');
        });
      });
    });
  }

  public send(message: ClientToServerMessage): void {
    this.socket.write(serializeNdjsonMessage(message));
  }

  public close(): void {
    this.socket.destroy();
  }
}
