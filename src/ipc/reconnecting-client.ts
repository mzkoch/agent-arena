import { EventEmitter } from 'node:events';
import type { ClientToServerMessage, ServerToClientMessage, SnapshotMessage } from './protocol';
import { ArenaIpcClient } from './client';

export interface ReconnectingClientOptions {
  port: number;
  host?: string;
  clientType: 'controller' | 'monitor';
  baseDelayMs?: number;
  multiplier?: number;
  maxRetries?: number;
}

export class ReconnectingIpcClient extends EventEmitter<{
  message: [message: ServerToClientMessage];
  connected: [snapshot: SnapshotMessage];
  disconnected: [];
  reconnecting: [attempt: number];
  close: [];
}> {
  private client: ArenaIpcClient | null = null;
  private messageListener: ((message: ServerToClientMessage) => void) | null = null;
  private closeListener: (() => void) | null = null;
  private intentionallyClosed = false;
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly port: number;
  private readonly host: string;
  private readonly clientType: 'controller' | 'monitor';
  private readonly baseDelayMs: number;
  private readonly multiplier: number;
  private readonly maxRetries: number;

  public constructor(options: ReconnectingClientOptions) {
    super();
    this.port = options.port;
    this.host = options.host ?? '127.0.0.1';
    this.clientType = options.clientType;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.multiplier = options.multiplier ?? 1.5;
    this.maxRetries = options.maxRetries ?? 10;
  }

  public async connect(): Promise<SnapshotMessage> {
    this.intentionallyClosed = false;
    return this.doConnect();
  }

  public send(message: ClientToServerMessage): void {
    this.client?.send(message);
  }

  public close(): void {
    this.intentionallyClosed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.detachListeners();
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }

  private async doConnect(): Promise<SnapshotMessage> {
    this.detachListeners();
    const client = new ArenaIpcClient();
    this.client = client;

    const snapshot = await client.connect(this.port, this.host, this.clientType);
    this.retryCount = 0;

    this.messageListener = (message: ServerToClientMessage) => {
      this.emit('message', message);
    };
    this.closeListener = () => {
      this.emit('disconnected');
      if (!this.intentionallyClosed) {
        this.scheduleReconnect();
      }
    };

    client.on('message', this.messageListener);
    client.on('close', this.closeListener);

    this.emit('connected', snapshot);
    return snapshot;
  }

  private scheduleReconnect(): void {
    if (this.retryCount >= this.maxRetries) {
      this.emit('close');
      return;
    }

    this.retryCount += 1;
    const delay = this.baseDelayMs * Math.pow(this.multiplier, this.retryCount - 1);
    this.emit('reconnecting', this.retryCount);

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.doConnect().catch(() => {
        if (!this.intentionallyClosed) {
          this.scheduleReconnect();
        }
      });
    }, delay);
  }

  private detachListeners(): void {
    if (this.client && this.messageListener) {
      this.client.off('message', this.messageListener);
    }
    if (this.client && this.closeListener) {
      this.client.off('close', this.closeListener);
    }
    this.messageListener = null;
    this.closeListener = null;
  }
}
