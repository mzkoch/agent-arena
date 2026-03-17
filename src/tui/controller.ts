import type { ArenaSnapshot } from '../domain/types';
import type { ArenaIpcClient } from '../ipc/client';
import type { ServerToClientMessage } from '../ipc/protocol';
import type { ArenaOrchestrator } from '../orchestrator/arena-orchestrator';

export interface ArenaController {
  loadSnapshot(): Promise<ArenaSnapshot>;
  subscribe(listener: (message: ServerToClientMessage) => void): () => void;
  sendInput(agent: string, data: string): void | Promise<void>;
  killAgent(agent: string): void | Promise<void>;
  restartAgent(agent: string): void | Promise<void>;
  setInteractive?(agent: string, interactive: boolean): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

export class LocalArenaController implements ArenaController {
  public constructor(private readonly orchestrator: ArenaOrchestrator) {}

  public loadSnapshot(): Promise<ArenaSnapshot> {
    return Promise.resolve(this.orchestrator.getSnapshot(false));
  }

  public subscribe(listener: (message: ServerToClientMessage) => void): () => void {
    this.orchestrator.on('message', listener);
    return () => {
      this.orchestrator.off('message', listener);
    };
  }

  public sendInput(agent: string, data: string): void {
    this.orchestrator.sendInput(agent, data);
  }

  public async killAgent(agent: string): Promise<void> {
    await this.orchestrator.killAgent(agent);
  }

  public async restartAgent(agent: string): Promise<void> {
    await this.orchestrator.restartAgent(agent);
  }

  public setInteractive(agent: string, interactive: boolean): void {
    this.orchestrator.setInteractive(agent, interactive);
  }
}

export class RemoteArenaController implements ArenaController {
  public constructor(
    private readonly client: ArenaIpcClient,
    private readonly initialSnapshot: ArenaSnapshot
  ) {}

  public loadSnapshot(): Promise<ArenaSnapshot> {
    return Promise.resolve(this.initialSnapshot);
  }

  public subscribe(listener: (message: ServerToClientMessage) => void): () => void {
    this.client.on('message', listener);
    return () => {
      this.client.off('message', listener);
    };
  }

  public sendInput(agent: string, data: string): void {
    this.client.send({ type: 'input', agent, data });
  }

  public killAgent(agent: string): void {
    this.client.send({ type: 'kill', agent });
  }

  public restartAgent(agent: string): void {
    this.client.send({ type: 'restart', agent });
  }

  public dispose(): void {
    this.client.close();
  }
}
