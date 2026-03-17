import * as pty from 'node-pty';
import { EventEmitter } from 'node:events';
import stripAnsi from 'strip-ansi';
import type { AgentProvider } from '../providers/types.js';
import { OutputBuffer, killProcessTree } from '../utils/process.js';
import type { AgentStatus } from '../monitor/types.js';

export interface AgentRunnerOptions {
  variantName: string;
  provider: AgentProvider;
  model: string;
  worktreePath: string;
  initialPrompt: string;
  maxContinues?: number;
  timeoutMs?: number;
}

export class AgentRunner extends EventEmitter {
  readonly variantName: string;
  private provider: AgentProvider;
  private model: string;
  private worktreePath: string;
  private initialPrompt: string;
  private maxContinues: number;
  private timeoutMs?: number;

  private ptyProcess: pty.IPty | null = null;
  private outputBuffer = new OutputBuffer(2000);
  private _status: AgentStatus = 'pending';
  private _pid?: number;
  private _exitCode?: number;
  private _error?: string;
  private _startedAt?: string;
  private _completedAt?: string;

  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private statusCheckCount = 0;
  private awaitingStatusResponse = false;
  private statusResponseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: AgentRunnerOptions) {
    super();
    this.variantName = options.variantName;
    this.provider = options.provider;
    this.model = options.model;
    this.worktreePath = options.worktreePath;
    this.initialPrompt = options.initialPrompt;
    this.maxContinues = options.maxContinues ?? 50;
    this.timeoutMs = options.timeoutMs;
  }

  get status(): AgentStatus { return this._status; }
  get pid(): number | undefined { return this._pid; }
  get exitCode(): number | undefined { return this._exitCode; }
  get error(): string | undefined { return this._error; }
  get startedAt(): string | undefined { return this._startedAt; }
  get completedAt(): string | undefined { return this._completedAt; }

  getOutputLines(): string[] {
    return this.outputBuffer.getLines();
  }

  /**
   * Build the command and args array from provider config.
   */
  private buildCommand(): { file: string; args: string[] } {
    const args = [...this.provider.baseArgs];

    // Model flag
    args.push(this.provider.modelFlag, this.model);

    // Max continues (if supported)
    if (this.provider.maxContinuesFlag) {
      args.push(this.provider.maxContinuesFlag, String(this.maxContinues));
    }

    // Prompt delivery
    switch (this.provider.promptDelivery) {
      case 'flag':
        if (!this.provider.promptFlag) {
          throw new Error(`Provider requires promptFlag for "flag" delivery`);
        }
        args.push(this.provider.promptFlag, this.initialPrompt);
        break;
      case 'positional':
        args.push(this.initialPrompt);
        break;
      case 'stdin':
        // Prompt will be sent after spawn
        break;
    }

    return { file: this.provider.command, args };
  }

  /**
   * Start the agent process.
   */
  start(): void {
    if (this._status === 'running') return;

    const { file, args } = this.buildCommand();
    this._status = 'running';
    this._startedAt = new Date().toISOString();
    this.statusCheckCount = 0;

    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';

    this.ptyProcess = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: 200,
      rows: 50,
      cwd: this.worktreePath,
      env: { ...process.env } as Record<string, string>,
    });

    this._pid = this.ptyProcess.pid;
    this.emit('started', this.variantName, this._pid);

    // Handle output
    this.ptyProcess.onData((data: string) => {
      const lines = data.split('\n');
      for (const line of lines) {
        if (line.trim() === '') continue;
        const cleaned = stripAnsi(line).trimEnd();
        if (cleaned === '') continue;

        this.outputBuffer.push(cleaned);
        this.emit('output', this.variantName, cleaned);

        // Check for completion markers
        if (this.awaitingStatusResponse) {
          const proto = this.provider.completionProtocol;
          if (cleaned.includes(proto.doneMarker)) {
            this.handleDone();
            return;
          }
          if (cleaned.includes(proto.continueMarker)) {
            this.handleContinuing();
            return;
          }
        }
      }

      // Reset idle timer on any output
      this.resetIdleTimer();
    });

    // Handle exit
    this.ptyProcess.onExit(({ exitCode }) => {
      this.clearAllTimers();
      this._exitCode = exitCode;
      this._completedAt = new Date().toISOString();
      this._status = exitCode === 0 ? 'completed' : 'failed';
      this.ptyProcess = null;
      this.emit('completed', this.variantName, exitCode);
    });

    // Send prompt via stdin if needed
    if (this.provider.promptDelivery === 'stdin') {
      setTimeout(() => {
        this.write(this.initialPrompt + '\r');
      }, 1000);
    }

    // Start idle detection
    this.resetIdleTimer();

    // Start absolute timeout
    if (this.timeoutMs) {
      this.timeoutTimer = setTimeout(() => {
        this.emit('output', this.variantName, '[Arena] Agent timeout reached, shutting down...');
        this.stop();
      }, this.timeoutMs);
    }
  }

  /**
   * Write data to the agent's PTY.
   */
  write(data: string): void {
    if (this.ptyProcess) {
      this.ptyProcess.write(data);
      this.resetIdleTimer(); // User input resets idle
    }
  }

  /**
   * Gracefully stop the agent by sending the exit command, then force kill.
   */
  async stop(): Promise<void> {
    this.clearAllTimers();
    if (!this.ptyProcess) return;

    // Try sending exit command first
    try {
      this.ptyProcess.write(this.provider.exitCommand + '\r');
    } catch {
      // PTY might already be closed
    }

    // Wait a bit for graceful exit, then force kill
    await new Promise<void>((resolve) => {
      const forceTimer = setTimeout(async () => {
        if (this._pid) {
          try {
            await killProcessTree(this._pid);
          } catch {
            // Already dead
          }
        }
        resolve();
      }, 5000);

      if (this.ptyProcess) {
        this.ptyProcess.onExit(() => {
          clearTimeout(forceTimer);
          resolve();
        });
      } else {
        clearTimeout(forceTimer);
        resolve();
      }
    });

    this._status = 'killed';
    this._completedAt = new Date().toISOString();
  }

  /**
   * Reset the idle detection timer.
   */
  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.awaitingStatusResponse = false;
    if (this.statusResponseTimer) clearTimeout(this.statusResponseTimer);

    const proto = this.provider.completionProtocol;

    this.idleTimer = setTimeout(() => {
      this.sendStatusCheck();
    }, proto.idleTimeoutMs);
  }

  /**
   * Send a status check prompt to the agent.
   */
  private sendStatusCheck(): void {
    const proto = this.provider.completionProtocol;

    if (this.statusCheckCount >= proto.maxChecks) {
      this.emit('output', this.variantName, `[Arena] Max status checks (${proto.maxChecks}) reached, shutting down...`);
      this.stop();
      return;
    }

    if (!this.ptyProcess) return;

    this.statusCheckCount++;
    this.awaitingStatusResponse = true;

    const checkPrompt = `Have you completed all deliverables listed in ARENA-INSTRUCTIONS.md? If yes, respond with exactly: ${proto.doneMarker} — If you are still working, respond with exactly: ${proto.continueMarker}`;

    this.ptyProcess.write(checkPrompt + '\r');
    this.emit('output', this.variantName, `[Arena] Status check #${this.statusCheckCount} sent`);

    // Timeout for response
    this.statusResponseTimer = setTimeout(() => {
      if (this.awaitingStatusResponse) {
        this.emit('output', this.variantName, '[Arena] No response to status check');
        // Reset idle timer to try again
        this.resetIdleTimer();
      }
    }, proto.responseTimeoutMs);
  }

  private handleDone(): void {
    this.emit('output', this.variantName, '[Arena] Agent reported DONE, sending exit command...');
    if (this.ptyProcess) {
      this.ptyProcess.write(this.provider.exitCommand + '\r');
    }
  }

  private handleContinuing(): void {
    this.emit('output', this.variantName, '[Arena] Agent reported CONTINUING, resetting idle timer...');
    this.statusCheckCount = 0; // Reset check count since agent is actively working
    this.resetIdleTimer();
  }

  private clearAllTimers(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    if (this.statusResponseTimer) clearTimeout(this.statusResponseTimer);
    this.idleTimer = null;
    this.timeoutTimer = null;
    this.statusResponseTimer = null;
  }
}
