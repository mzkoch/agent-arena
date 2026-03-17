import { EventEmitter } from 'node:events';
import type {
  AgentSnapshot,
  AgentStatus,
  ArenaConfig,
  ArenaSnapshot,
  Logger,
  VariantWorkspace
} from '../domain/types';
import { buildLaunchPrompt, buildStatusCheckPrompt } from '../prompt/builder';
import { ProviderRegistry, buildProviderCommand } from '../providers/registry';
import { ensureTrustedFolder, registerTrustedFolders } from '../providers/trusted-folders';
import type { ServerToClientMessage } from '../ipc/protocol';
import { OutputBuffer } from '../utils/output-buffer';
import stripAnsi from 'strip-ansi';
import type { ProcessTerminator } from '../utils/process';
import { terminateProcessTree } from '../utils/process';
import type { PtyFactory, PtyProcess } from './pty';
import { nodePtyFactory } from './pty';

interface ManagedAgent {
  workspace: VariantWorkspace;
  status: AgentStatus;
  outputBuffer: OutputBuffer;
  process?: PtyProcess | undefined;
  pid?: number | undefined;
  startedAt?: number | undefined;
  completedAt?: number | undefined;
  exitCode?: number | undefined;
  error?: string | undefined;
  idleTimer?: NodeJS.Timeout | undefined;
  responseTimer?: NodeJS.Timeout | undefined;
  absoluteTimer?: NodeJS.Timeout | undefined;
  checksPerformed: number;
  interactive: boolean;
  killedByUser: boolean;
}

interface OrchestratorDependencies {
  ptyFactory?: PtyFactory;
  processTerminator?: ProcessTerminator;
  now?: () => number;
}

export class ArenaOrchestrator extends EventEmitter<{
  message: [message: ServerToClientMessage];
}> {
  private readonly registry: ProviderRegistry;
  private readonly agents = new Map<string, ManagedAgent>();
  private readonly startedAt: number;

  public constructor(
    private readonly config: ArenaConfig,
    private readonly workspaces: VariantWorkspace[],
    private readonly gitRoot: string,
    private readonly logger: Logger,
    private readonly dependencies: OrchestratorDependencies = {}
  ) {
    super();
    this.registry = new ProviderRegistry(config.providers);
    this.startedAt = this.now();

    for (const workspace of workspaces) {
      this.agents.set(workspace.variant.name, {
        workspace,
        status: 'pending',
        outputBuffer: new OutputBuffer(),
        checksPerformed: 0,
        interactive: false,
        killedByUser: false
      });
    }
  }

  private get ptyFactory(): PtyFactory {
    return this.dependencies.ptyFactory ?? nodePtyFactory;
  }

  private get processTerminator(): ProcessTerminator {
    return this.dependencies.processTerminator ?? terminateProcessTree;
  }

  private now(): number {
    return this.dependencies.now?.() ?? Date.now();
  }

  public getSnapshot(headless = false): ArenaSnapshot {
    return {
      gitRoot: this.gitRoot,
      startedAt: new Date(this.startedAt).toISOString(),
      headless,
      agents: [...this.agents.values()].map((agent) => this.toAgentSnapshot(agent))
    };
  }

  public async startAll(): Promise<void> {
    // Batch-register all trusted folders before starting agents to avoid
    // concurrent read-modify-write races on the same config file.
    await registerTrustedFolders(
      this.workspaces.map((workspace) => ({
        provider: this.registry.get(workspace.variant.provider),
        folderPath: workspace.worktreePath
      }))
    );

    await Promise.all(this.workspaces.map(async (workspace) => this.startAgent(workspace.variant.name)));
  }

  public async startAgent(agentName: string): Promise<void> {
    const agent = this.getAgent(agentName);
    const { variant, worktreePath } = agent.workspace;
    const provider = this.registry.get(variant.provider);
    const prompt = buildProviderCommand(
      provider,
      variant,
      buildLaunchPrompt(),
      this.config.maxContinues
    );

    await ensureTrustedFolder(provider, worktreePath);

    agent.outputBuffer = new OutputBuffer();
    agent.checksPerformed = 0;
    agent.killedByUser = false;
    agent.startedAt = this.now();
    agent.completedAt = undefined;
    agent.exitCode = undefined;
    agent.error = undefined;

    const pty = this.ptyFactory(prompt.command, prompt.args, {
      cwd: worktreePath,
      env: process.env,
      cols: 120,
      rows: 40
    });

    agent.process = pty;
    agent.pid = pty.pid;
    this.setStatus(agent, 'running');
    this.armTimers(agentName);

    pty.onData((chunk) => {
      this.handleData(agentName, chunk);
    });
    pty.onExit((event) => {
      this.handleExit(agentName, event.exitCode);
    });

    if (prompt.stdinPayload) {
      pty.write(prompt.stdinPayload.replace(/\n/g, '\r'));
    }
  }

  public async killAgent(agentName: string): Promise<void> {
    const agent = this.getAgent(agentName);
    if (!agent.process || !agent.pid) {
      return;
    }

    agent.killedByUser = true;
    await this.processTerminator(agent.pid);
    agent.process.kill();
    this.clearTimers(agent);
    agent.completedAt = this.now();
    this.setStatus(agent, 'killed');
  }

  public async restartAgent(agentName: string): Promise<void> {
    const agent = this.getAgent(agentName);
    if (agent.process && agent.pid) {
      await this.killAgent(agentName);
    }
    await this.startAgent(agentName);
  }

  public sendInput(agentName: string, data: string): void {
    const agent = this.getAgent(agentName);
    agent.process?.write(data);
  }

  public setInteractive(agentName: string, interactive: boolean): void {
    const agent = this.getAgent(agentName);
    agent.interactive = interactive;
    this.emitState(agent);
  }

  public async close(): Promise<void> {
    await Promise.all(
      [...this.agents.keys()].map(async (agentName) => {
        const agent = this.getAgent(agentName);
        if (agent.process && agent.pid) {
          await this.killAgent(agentName);
        }
      })
    );
  }

  private getAgent(agentName: string): ManagedAgent {
    const agent = this.agents.get(agentName);
    if (!agent) {
      throw new Error(`Unknown agent "${agentName}".`);
    }
    return agent;
  }

  private armTimers(agentName: string): void {
    const agent = this.getAgent(agentName);
    this.clearTimers(agent);

    const provider = this.registry.get(agent.workspace.variant.provider);
    agent.idleTimer = setTimeout(() => {
      this.handleIdle(agentName);
    }, provider.completionProtocol.idleTimeoutMs);

    agent.absoluteTimer = setTimeout(() => {
      void this.failAgent(agentName, 'Agent exceeded configured timeout.');
    }, this.config.agentTimeoutMs);
  }

  private clearTimers(agent: ManagedAgent): void {
    if (agent.idleTimer) {
      clearTimeout(agent.idleTimer);
      agent.idleTimer = undefined;
    }
    if (agent.responseTimer) {
      clearTimeout(agent.responseTimer);
      agent.responseTimer = undefined;
    }
    if (agent.absoluteTimer) {
      clearTimeout(agent.absoluteTimer);
      agent.absoluteTimer = undefined;
    }
  }

  private handleData(agentName: string, chunk: string): void {
    const agent = this.getAgent(agentName);
    agent.outputBuffer.append(chunk);
    this.emit('message', { type: 'agent-output', agent: agentName, chunk });

    const provider = this.registry.get(agent.workspace.variant.provider);
    const plainChunk = stripAnsi(chunk);

    if (plainChunk.includes(provider.completionProtocol.doneMarker)) {
      void this.completeAgent(agentName, 0);
      return;
    }

    if (plainChunk.includes(provider.completionProtocol.continueMarker)) {
      agent.checksPerformed = 0;
      if (agent.status !== 'running') {
        this.setStatus(agent, 'running');
      } else {
        this.emitState(agent);
      }
      this.armTimers(agentName);
      return;
    }

    if (agent.status === 'idle') {
      this.setStatus(agent, 'running');
    } else {
      this.emitState(agent);
    }
    this.armTimers(agentName);
  }

  private handleIdle(agentName: string): void {
    const agent = this.getAgent(agentName);
    if (!agent.process) {
      return;
    }

    const provider = this.registry.get(agent.workspace.variant.provider);
    this.setStatus(agent, 'idle');
    agent.process.write(`${buildStatusCheckPrompt(provider.completionProtocol)}\r`);
    agent.responseTimer = setTimeout(() => {
      if (agent.status !== 'completed' && agent.status !== 'failed' && agent.status !== 'killed') {
        agent.checksPerformed += 1;
        if (agent.checksPerformed >= provider.completionProtocol.maxChecks) {
          void this.completeAgent(agentName, agent.exitCode ?? 0);
          return;
        }

        this.armTimers(agentName);
        this.emitState(agent);
      }
    }, provider.completionProtocol.responseTimeoutMs);
  }

  private handleExit(agentName: string, exitCode: number): void {
    const agent = this.getAgent(agentName);
    if (agent.status === 'completed' || agent.status === 'failed' || agent.status === 'killed') {
      return;
    }

    if (agent.killedByUser) {
      agent.completedAt = this.now();
      this.setStatus(agent, 'killed');
      return;
    }

    if (exitCode === 0) {
      void this.completeAgent(agentName, exitCode);
      return;
    }

    void this.failAgent(agentName, `Agent exited with code ${exitCode}`, exitCode);
  }

  private async completeAgent(agentName: string, exitCode: number): Promise<void> {
    const agent = this.getAgent(agentName);
    agent.exitCode = exitCode;
    agent.completedAt = this.now();
    this.clearTimers(agent);

    // Terminate the PTY process to prevent child process leaks
    if (agent.process && agent.pid) {
      try {
        await this.processTerminator(agent.pid);
        agent.process.kill();
      } catch {
        this.logger.warn('Failed to terminate completed agent process', { agent: agentName, pid: agent.pid });
      }
    }

    this.setStatus(agent, 'completed');
  }

  private async failAgent(agentName: string, error: string, exitCode = 1): Promise<void> {
    const agent = this.getAgent(agentName);
    agent.error = error;
    agent.exitCode = exitCode;
    agent.completedAt = this.now();
    this.clearTimers(agent);
    if (agent.pid) {
      try {
        await this.processTerminator(agent.pid);
      } catch {
        this.logger.warn('Failed terminating process tree', { agent: agentName, pid: agent.pid });
      }
    }
    this.setStatus(agent, 'failed');
  }

  private setStatus(agent: ManagedAgent, status: AgentStatus): void {
    agent.status = status;
    if (status === 'completed' || status === 'failed' || status === 'killed') {
      agent.completedAt = agent.completedAt ?? this.now();
    }
    this.emitState(agent);
  }

  private emitState(agent: ManagedAgent): void {
    const snapshot = this.toAgentSnapshot(agent);
    this.emit('message', {
      type: 'agent-state',
      agent: snapshot.name,
      status: snapshot.status,
      snapshot
    });
  }

  private toAgentSnapshot(agent: ManagedAgent): AgentSnapshot {
    const now = this.now();
    const startedAt = agent.startedAt ?? now;
    const end = agent.completedAt ?? now;
    return {
      name: agent.workspace.variant.name,
      provider: agent.workspace.variant.provider,
      model: agent.workspace.variant.model,
      branch: agent.workspace.variant.branch,
      worktreePath: agent.workspace.worktreePath,
      status: agent.status,
      pid: agent.pid,
      elapsedMs: end - startedAt,
      lineCount: agent.outputBuffer.getLineCount(),
      outputLines: agent.outputBuffer.getLines(),
      checksPerformed: agent.checksPerformed,
      startedAt: agent.startedAt ? new Date(agent.startedAt).toISOString() : undefined,
      completedAt: agent.completedAt ? new Date(agent.completedAt).toISOString() : undefined,
      exitCode: agent.exitCode,
      error: agent.error,
      interactive: agent.interactive
    };
  }
}
