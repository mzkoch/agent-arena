import net from 'node:net';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ArenaProvider,
  ArenaStatus,
  ArenaSession,
  ServerMessage,
  InputMessage,
} from './types.js';
import { OutputBuffer } from '../utils/process.js';

export class RemoteMonitor extends EventEmitter implements ArenaProvider {
  private socket: net.Socket | null = null;
  private status: ArenaStatus | null = null;
  private outputBuffers: Map<string, OutputBuffer> = new Map();
  private connected = false;

  /**
   * Connect to an arena IPC server.
   */
  async connect(port: number, host: string = '127.0.0.1'): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ port, host }, () => {
        this.connected = true;
        resolve();
      });

      let buffer = '';
      this.socket.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line) as ServerMessage;
            this.handleMessage(msg);
          } catch {
            // Ignore malformed messages
          }
        }
      });

      this.socket.on('close', () => {
        this.connected = false;
        this.emit('disconnected');
      });

      this.socket.on('error', (err) => {
        if (!this.connected) {
          reject(err);
        }
        this.connected = false;
      });
    });
  }

  /**
   * Load session info from .arena-session.json and connect.
   */
  static async connectFromSession(repoPath: string): Promise<RemoteMonitor> {
    const sessionPath = path.join(repoPath, '.arena-session.json');
    const raw = await fs.readFile(sessionPath, 'utf-8');
    const session = JSON.parse(raw) as ArenaSession;

    const monitor = new RemoteMonitor();
    await monitor.connect(session.port);
    return monitor;
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'snapshot': {
        this.status = msg.status;
        // Initialize output buffers from snapshot
        for (const [name, lines] of Object.entries(msg.outputBuffers)) {
          const buf = new OutputBuffer(2000);
          for (const line of lines) {
            buf.push(line);
          }
          this.outputBuffers.set(name, buf);
        }
        this.emit('snapshot', msg.status);
        this.emit('status-changed');
        break;
      }
      case 'event': {
        const evt = msg.event;
        switch (evt.type) {
          case 'agent-output': {
            let buf = this.outputBuffers.get(evt.variantName);
            if (!buf) {
              buf = new OutputBuffer(2000);
              this.outputBuffers.set(evt.variantName, buf);
            }
            buf.push(evt.line);
            this.emit('agent-output', evt.variantName, evt.line);
            break;
          }
          case 'agent-started':
            this.emit('agent-started', evt.variantName, evt.pid);
            this.emit('status-changed');
            break;
          case 'agent-completed':
            this.emit('agent-completed', evt.variantName, evt.exitCode);
            this.emit('status-changed');
            break;
          case 'agent-error':
            this.emit('agent-error', evt.variantName, evt.error);
            this.emit('status-changed');
            break;
        }
        break;
      }
    }
  }

  // --- ArenaProvider interface ---

  getStatus(): ArenaStatus {
    if (!this.status) {
      return { repoPath: '', agents: [], startedAt: '' };
    }
    return this.status;
  }

  getOutputBuffer(variantName: string): string[] {
    const buf = this.outputBuffers.get(variantName);
    return buf?.getLines() ?? [];
  }

  sendInput(variantName: string, data: string): void {
    if (this.socket && this.connected) {
      const msg: InputMessage = { type: 'input', variantName, data };
      this.socket.write(JSON.stringify(msg) + '\n');
    }
  }

  async killAgent(_variantName: string): Promise<void> {
    // Not supported via remote monitor — would need a kill message type
    // For now, this is a no-op in remote mode
  }

  async restartAgent(_variantName: string): Promise<void> {
    // Not supported via remote monitor
  }

  async shutdown(): Promise<void> {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
  }
}
