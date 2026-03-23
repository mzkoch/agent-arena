import { EventEmitter } from 'node:events';
import type {
  AgentSnapshot,
  AgentStatus,
  ArenaConfig,
  ArenaSnapshot,
  Logger,
  VariantWorkspace
} from '../domain/types';
import { isTerminalStatus } from '../domain/types';
import { buildLaunchPrompt, buildStatusCheckPrompt } from '../prompt/builder';
import { ProviderRegistry, buildProviderCommand } from '../providers/registry';
import { ensureTrustedFolder, registerTrustedFolders } from '../providers/trusted-folders';
import { getModelCachePath } from '../providers/model-cache';
import { looksLikeInvalidModelError, type CommandExecutor } from '../providers/model-discovery';
import type { ServerToClientMessage } from '../ipc/protocol';
import type { TerminalSnapshot } from '../terminal/types';
import { VirtualTerminal } from './virtual-terminal';
import stripAnsi from 'strip-ansi';
import type { ProcessTerminator } from '../utils/process';
import { terminateProcessTree } from '../utils/process';
import type { PtyFactory, PtyProcess } from './pty';
import { nodePtyFactory } from './pty';
import type { ArenaLogger } from '../logging/types';
import { detectSignal } from './signal-detector';
import { formatCommandEnvelope } from './signal-protocol';
import { verifyWorkspaceCompletion, type VerificationGitOps } from './verification';
import type { CommandRunner } from '../git/command-runner';
import { NodeCommandRunner } from '../git/command-runner';
import { GitRepositoryManager } from '../git/repository';

/** Threshold in milliseconds for detecting early failures (likely bad model). */
const EARLY_FAILURE_THRESHOLD_MS = 15_000;

const builtinLaunchHints: Record<string, string> = {
  'copilot-cli': 'Is GitHub Copilot CLI installed?',
  'claude-code': 'Is Claude Code installed?'
};

export const formatLaunchError = (providerName: string, command: string, error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const hint = builtinLaunchHints[providerName];
  const suffix = hint && message.includes('not found in PATH') ? ` ${hint}` : '';
  return `Failed to launch "${command}" for provider "${providerName}": ${message}${suffix}`;
};

interface ManagedAgent {
  workspace: VariantWorkspace;
  status: AgentStatus;
  vterm: VirtualTerminal;
  pendingWrite: Promise<void>;
  process?: PtyProcess | undefined;
  pid?: number | undefined;
  startedAt?: number | undefined;
  completedAt?: number | undefined;
  exitCode?: number | undefined;
  completionReason?: string | undefined;
  error?: string | undefined;
  idleTimer?: NodeJS.Timeout | undefined;
  responseTimer?: NodeJS.Timeout | undefined;
  absoluteTimer?: NodeJS.Timeout | undefined;
  checksPerformed: number;
  interactive: boolean;
  killedByUser: boolean;
  /** Whether a model recovery retry has already been attempted. */
  modelRetryAttempted: boolean;
  /** The effective model (may differ from config after recovery). */
  effectiveModel?: string | undefined;
}

interface OrchestratorDependencies {
  ptyFactory?: PtyFactory;
  processTerminator?: ProcessTerminator;
  now?: () => number;
  arenaLogger?: ArenaLogger;
  /** Custom command executor for model discovery (used in tests). */
  commandExecutor?: CommandExecutor;
  /** Command runner for verification commands (defaults to NodeCommandRunner). */
  commandRunner?: CommandRunner;
  /** Git repository manager for verification (defaults to new instance using commandRunner). */
  gitManager?: VerificationGitOps;
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
        vterm: new VirtualTerminal(),
        pendingWrite: Promise.resolve(),
        checksPerformed: 0,
        interactive: false,
        killedByUser: false,
        modelRetryAttempted: false
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
    this.dependencies.arenaLogger?.logEvent('arena.start', {
      variants: this.workspaces.map((workspace) => workspace.variant.name),
      maxContinues: this.config.maxContinues,
      agentTimeoutMs: this.config.agentTimeoutMs
    });

    // Batch-register all trusted folders before starting agents to avoid
    // concurrent read-modify-write races on the same config file.
    await registerTrustedFolders(
      this.workspaces.map((workspace) => ({
        provider: this.registry.get(workspace.variant.provider),
        folderPath: workspace.worktreePath
      }))
    );

    // Launch without per-agent trust check — batch registration above covers all.
    for (const workspace of this.workspaces) {
      this.launchAgent(workspace.variant.name);
    }
  }

  public async startAgent(agentName: string): Promise<void> {
    const agent = this.getAgent(agentName);
    const { variant, worktreePath } = agent.workspace;
    await ensureTrustedFolder(this.registry.get(variant.provider), worktreePath);
    this.launchAgent(agentName);
  }

  private launchAgent(agentName: string): void {
    const agent = this.getAgent(agentName);
    const { variant, worktreePath } = agent.workspace;
    const provider = this.registry.get(variant.provider);

    // Use effective model if set (from recovery), otherwise use config model
    const effectiveVariant = agent.effectiveModel
      ? { ...variant, model: agent.effectiveModel }
      : variant;

    const prompt = buildProviderCommand(
      provider,
      effectiveVariant,
      buildLaunchPrompt(),
      this.config.maxContinues
    );

    agent.vterm.dispose();
    agent.vterm = new VirtualTerminal();
    agent.pendingWrite = Promise.resolve();
    agent.checksPerformed = 0;
    agent.killedByUser = false;
    agent.startedAt = this.now();
    agent.completedAt = undefined;
    agent.exitCode = undefined;
    agent.completionReason = undefined;
    agent.error = undefined;

    let pty: PtyProcess;
    try {
      pty = this.ptyFactory(prompt.command, prompt.args, {
        cwd: worktreePath,
        env: process.env,
        cols: 120,
        rows: 40
      });
    } catch (error) {
      this.logger.error('Failed to start agent process', {
        agent: agentName,
        provider: variant.provider,
        command: prompt.command,
        error
      });
      void this.failAgent(
        agentName,
        formatLaunchError(variant.provider, prompt.command, error),
        1,
        'launch_error'
      );
      return;
    }

    agent.process = pty;
    agent.pid = pty.pid;
    this.dependencies.arenaLogger?.logEvent('agent.spawn', {
      variant: agentName,
      pid: pty.pid,
      command: prompt.command,
      args: prompt.args,
      model: effectiveVariant.model,
      worktreePath
    });
    this.setStatus(agent, 'running');
    this.armTimers(agentName);

    pty.onData((chunk) => {
      this.handleData(agentName, chunk);
    });
    pty.onExit((event) => {
      this.handleExit(agentName, event.exitCode, event.signal);
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
    agent.completionReason = 'killed';
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
    if (isTerminalStatus(agent.status)) {
      return;
    }
    this.clearTimers(agent);

    const provider = this.registry.get(agent.workspace.variant.provider);
    agent.idleTimer = setTimeout(() => {
      this.handleIdle(agentName);
    }, provider.completionProtocol.idleTimeoutMs);

    agent.absoluteTimer = setTimeout(() => {
      void this.failAgent(agentName, 'Agent exceeded configured timeout.', 1, 'timeout');
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
    this.dependencies.arenaLogger?.logPty(agentName, chunk);
    if (isTerminalStatus(agent.status) || agent.status === 'verifying') {
      return;
    }

    // Signal detection from plain text — synchronous, independent of xterm
    const plainChunk = stripAnsi(chunk);
    const signal = detectSignal(plainChunk);

    if (signal !== null) {
      this.dependencies.arenaLogger?.logEvent('agent.idle_response', {
        variant: agentName,
        markerMatched: signal
      });
    }

    // Capture vterm reference so the delta always matches the terminal that processed the write
    const vterm = agent.vterm;
    agent.pendingWrite = vterm.write(chunk).then(() => {
      if (agent.vterm !== vterm) return;
      this.emit('message', {
        type: 'agent-terminal',
        agent: agentName,
        delta: vterm.getDelta()
      });
    });

    if (signal === 'done') {
      void this.handleDoneSignal(agentName);
      return;
    }

    if (signal === 'continue') {
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
    if (!agent.process || isTerminalStatus(agent.status) || agent.status === 'verifying') {
      return;
    }

    const provider = this.registry.get(agent.workspace.variant.provider);
    this.dependencies.arenaLogger?.logEvent('agent.idle_check', {
      variant: agentName,
      checksPerformed: agent.checksPerformed + 1
    });
    this.setStatus(agent, 'idle');
    agent.process.write(`${buildStatusCheckPrompt()}\r`);
    agent.responseTimer = setTimeout(() => {
      if (!isTerminalStatus(agent.status)) {
        agent.checksPerformed += 1;
        if (agent.checksPerformed >= provider.completionProtocol.maxChecks) {
          void this.completeAgent(agentName, agent.exitCode ?? 0, 'max_checks');
          return;
        }

        this.armTimers(agentName);
        this.emitState(agent);
      }
    }, provider.completionProtocol.responseTimeoutMs);
  }

  /**
   * Handle a done signal from the agent. When verification is enabled, runs
   * workspace checks before accepting completion. When disabled, completes immediately.
   */
  private async handleDoneSignal(agentName: string): Promise<void> {
    const agent = this.getAgent(agentName);
    if (isTerminalStatus(agent.status) || agent.status === 'verifying') {
      return;
    }

    const verificationConfig = this.config.completionVerification;
    if (!verificationConfig.enabled) {
      void this.completeAgent(agentName, 0, 'done_marker');
      return;
    }

    // Enter verifying state
    this.setStatus(agent, 'verifying');
    this.clearTimers(agent);
    this.dependencies.arenaLogger?.logEvent('agent.verification_start', { variant: agentName });

    try {
      const commandRunner = this.getCommandRunner();
      const gitManager = this.getGitManager();
      const result = await verifyWorkspaceCompletion(
        agent.workspace.worktreePath,
        verificationConfig,
        gitManager,
        commandRunner
      );

      // Agent may have exited or been killed during verification
      if (isTerminalStatus(agent.status)) {
        return;
      }

      if (result.passed) {
        this.dependencies.arenaLogger?.logEvent('agent.verification_passed', {
          variant: agentName,
          baseRef: result.baseRef,
          commitCount: result.commitCount
        });
        // Send exit command before completing (completeAgent kills the process tree)
        const provider = this.registry.get(agent.workspace.variant.provider);
        if (agent.process) {
          agent.process.write(`\r${provider.exitCommand}\r`);
        }
        void this.completeAgent(agentName, 0, 'verified');
      } else {
        this.dependencies.arenaLogger?.logEvent('agent.verification_failed', {
          variant: agentName,
          issues: result.issues,
          baseRef: result.baseRef,
          commitCount: result.commitCount
        });
        this.sendVerificationFeedback(agent, result.issues);
        this.setStatus(agent, 'running');
        this.armTimers(agentName);
      }
    } catch (error) {
      // Verification crashed — log and send back to running
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Verification error', { agent: agentName, error: message });
      this.dependencies.arenaLogger?.logEvent('agent.verification_error', {
        variant: agentName,
        error: message
      });
      if (!isTerminalStatus(agent.status)) {
        this.sendVerificationFeedback(agent, [`Verification error: ${message}`]);
        this.setStatus(agent, 'running');
        this.armTimers(agentName);
      }
    }
  }

  /**
   * Send structured feedback to the agent when verification fails.
   */
  private sendVerificationFeedback(agent: ManagedAgent, issues: string[]): void {
    if (!agent.process) return;

    const reason = issues.join(' ');
    const commandEnvelope = formatCommandEnvelope({ action: 'continue', reason });
    const humanReadable = [
      '',
      '--- ARENA VERIFICATION FAILED ---',
      ...issues.map((issue) => `  • ${issue}`),
      'Please fix the issues above and signal completion again.',
      '---',
      ''
    ].join('\n');

    agent.process.write(`\r${commandEnvelope}\r${humanReadable}\r`);
  }

  private getCommandRunner(): CommandRunner {
    return this.dependencies.commandRunner ?? new NodeCommandRunner();
  }

  private getGitManager(): VerificationGitOps {
    return this.dependencies.gitManager ?? new GitRepositoryManager(this.getCommandRunner(), this.logger);
  }

  private handleExit(agentName: string, exitCode: number, signal?: number): void {
    const agent = this.getAgent(agentName);
    this.dependencies.arenaLogger?.logEvent('agent.exit', {
      variant: agentName,
      exitCode,
      durationMs: agent.startedAt ? this.now() - agent.startedAt : undefined,
      signal
    });
    if (isTerminalStatus(agent.status)) {
      return;
    }

    if (agent.killedByUser) {
      agent.completedAt = this.now();
      this.setStatus(agent, 'killed');
      return;
    }

    // If agent exits during verification
    if (agent.status === 'verifying') {
      if (exitCode === 0) {
        // Agent exited cleanly before verification accepted — fail as unverified
        void this.failAgent(agentName, 'Agent exited before verification completed (unverified exit).', exitCode, 'unverified_exit');
      } else {
        // Non-zero exit during verification — fail
        void this.failAgent(agentName, `Agent exited with code ${exitCode} during verification.`, exitCode);
      }
      return;
    }

    if (exitCode === 0) {
      void this.completeAgent(agentName, exitCode, 'process_exit');
      return;
    }

    // Attempt model recovery for early failures that look like invalid model errors
    const elapsed = agent.startedAt ? this.now() - agent.startedAt : Infinity;
    const currentModel = agent.effectiveModel ?? agent.workspace.variant.model;
    const outputText = agent.vterm.getPlainText();
    if (
      exitCode !== 0
      && elapsed < EARLY_FAILURE_THRESHOLD_MS
      && !agent.modelRetryAttempted
      && looksLikeInvalidModelError(outputText, currentModel)
    ) {
      void this.attemptModelRecovery(agentName, exitCode);
      return;
    }

    void this.failAgent(agentName, `Agent exited with code ${exitCode}`, exitCode);
  }

  /**
   * Attempt to recover from a model-related failure by finding the closest valid model
   * and retrying the agent with the corrected model name.
   */
  private async attemptModelRecovery(agentName: string, exitCode: number): Promise<void> {
    const agent = this.getAgent(agentName);
    agent.modelRetryAttempted = true;

    const { variant } = agent.workspace;
    const currentModel = agent.effectiveModel ?? variant.model;
    const cachePath = getModelCachePath(this.gitRoot);

    try {
      const closestModel = await this.registry.findClosestModel(
        variant.provider,
        currentModel,
        cachePath,
        this.dependencies.commandExecutor
      );

      if (closestModel && closestModel !== currentModel) {
        this.logger.info(
          `Variant "${agentName}" failed with model "${currentModel}". Retrying with "${closestModel}".`,
          { agent: agentName, originalModel: currentModel, correctedModel: closestModel }
        );
        this.dependencies.arenaLogger?.logEvent('agent.model_recovery', {
          variant: agentName,
          originalModel: currentModel,
          resolvedModel: closestModel
        });

        agent.effectiveModel = closestModel;
        this.clearTimers(agent);

        // Clean up old process
        if (agent.pid) {
          try {
            await this.processTerminator(agent.pid);
          } catch {
            // Process already exited
          }
        }

        this.launchAgent(agentName);
        return;
      }
    } catch {
      // Discovery failed — fall through to normal failure
    }

    void this.failAgent(agentName, `Agent exited with code ${exitCode}`, exitCode);
  }

  private async completeAgent(
    agentName: string,
    exitCode: number,
    reason: string
  ): Promise<void> {
    const agent = this.getAgent(agentName);
    if (isTerminalStatus(agent.status)) {
      return;
    }
    agent.exitCode = exitCode;
    agent.completionReason = reason;
    agent.completedAt = this.now();
    this.clearTimers(agent);
    this.dependencies.arenaLogger?.logEvent('agent.complete', {
      variant: agentName,
      reason,
      exitCode
    });
    this.setStatus(agent, 'completed');

    // Terminate the PTY process to prevent child process leaks
    if (agent.process && agent.pid) {
      try {
        await this.processTerminator(agent.pid);
        agent.process.kill();
      } catch {
        this.logger.warn('Failed to terminate completed agent process', { agent: agentName, pid: agent.pid });
      }
    }
  }

  private async failAgent(
    agentName: string,
    error: string,
    exitCode = 1,
    reason = 'process_exit'
  ): Promise<void> {
    const agent = this.getAgent(agentName);
    if (isTerminalStatus(agent.status)) {
      return;
    }
    agent.error = error;
    agent.exitCode = exitCode;
    agent.completionReason = reason;
    agent.completedAt = this.now();
    this.clearTimers(agent);
    this.dependencies.arenaLogger?.logEvent('agent.fail', {
      variant: agentName,
      error,
      exitCode
    });
    this.setStatus(agent, 'failed');
    if (agent.pid) {
      try {
        await this.processTerminator(agent.pid);
      } catch {
        this.logger.warn('Failed terminating process tree', { agent: agentName, pid: agent.pid });
      }
    }
  }

  private setStatus(agent: ManagedAgent, status: AgentStatus): void {
    const previousStatus = agent.status;
    agent.status = status;
    this.dependencies.arenaLogger?.logEvent('agent.state', {
      variant: agent.workspace.variant.name,
      from: previousStatus,
      to: status
    });
    if (isTerminalStatus(status)) {
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

  public resizeAll(cols: number, rows: number): void {
    for (const [agentName, agent] of this.agents) {
      agent.vterm.resize(cols, rows);
      if (agent.process) {
        agent.process.resize(cols, rows);
      }
      this.emit('message', {
        type: 'agent-terminal-snapshot',
        agent: agentName,
        snapshot: agent.vterm.getSnapshot()
      });
    }
  }

  public getAgentTerminalSnapshot(agentName: string): TerminalSnapshot | undefined {
    const agent = this.agents.get(agentName);
    return agent?.vterm.getSnapshot();
  }

  private toAgentSnapshot(agent: ManagedAgent): AgentSnapshot {
    const now = this.now();
    const startedAt = agent.startedAt ?? now;
    const end = agent.completedAt ?? now;
    return {
      name: agent.workspace.variant.name,
      provider: agent.workspace.variant.provider,
      model: agent.effectiveModel ?? agent.workspace.variant.model,
      branch: agent.workspace.variant.branch,
      worktreePath: agent.workspace.worktreePath,
      status: agent.status,
      pid: agent.pid,
      elapsedMs: end - startedAt,
      terminal: agent.vterm.getSnapshot(),
      checksPerformed: agent.checksPerformed,
      startedAt: agent.startedAt ? new Date(agent.startedAt).toISOString() : undefined,
      completedAt: agent.completedAt ? new Date(agent.completedAt).toISOString() : undefined,
      exitCode: agent.exitCode,
      completionReason: agent.completionReason,
      error: agent.error,
      interactive: agent.interactive
    };
  }
}
