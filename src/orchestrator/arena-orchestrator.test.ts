import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ArenaConfig, Logger, VariantWorkspace } from '../domain/types';
import { ArenaOrchestrator } from './arena-orchestrator';
import type { PtyFactory, PtyProcess } from './pty';
import { saveModelCache } from '../providers/model-cache';

class FakePty implements PtyProcess {
  public readonly writes: string[] = [];
  public pid = 101;
  private dataListeners: Array<(chunk: string) => void> = [];
  private exitListeners: Array<(event: { exitCode: number }) => void> = [];

  public write(data: string): void {
    this.writes.push(data);
  }

  public kill(): void {}

  public resize(): void {}

  public onData(listener: (chunk: string) => void): { dispose(): void } {
    this.dataListeners.push(listener);
    return { dispose: () => undefined };
  }

  public onExit(listener: (event: { exitCode: number }) => void): { dispose(): void } {
    this.exitListeners.push(listener);
    return { dispose: () => undefined };
  }

  public emitData(chunk: string): void {
    for (const listener of this.dataListeners) {
      listener(chunk);
    }
  }

  public emitExit(exitCode: number): void {
    for (const listener of this.exitListeners) {
      listener({ exitCode });
    }
  }
}

const logger: Logger = {
  debug() {},
  info: vi.fn(),
  warn() {},
  error() {}
};

const config: ArenaConfig = {
  repoName: 'demo',
  maxContinues: 5,
  agentTimeoutMs: 10_000,
  providers: {
    fake: {
      command: 'fake',
      baseArgs: [],
      promptDelivery: 'stdin',
      exitCommand: '/exit',
      completionProtocol: {
        idleTimeoutMs: 25,
        maxChecks: 2,
        responseTimeoutMs: 25,
        doneMarker: 'DONE',
        continueMarker: 'CONT'
      }
    }
  },
  variants: [
    {
      name: 'alpha',
      provider: 'fake',
      model: 'gpt-5',
      techStack: 'TypeScript',
      designPhilosophy: 'Testable',
      branch: 'variant/alpha'
    }
  ]
};

const workspaces: VariantWorkspace[] = [
  {
    variant: config.variants[0]!,
    worktreePath: '/tmp/alpha'
  }
];

describe('ArenaOrchestrator', () => {
  it('starts agents, reacts to completion markers, and kills agents via injected terminator', async () => {
    const fakePty = new FakePty();
    const ptyFactory: PtyFactory = () => fakePty;
    const terminator = vi.fn(() => Promise.resolve());
    const orchestrator = new ArenaOrchestrator(config, workspaces, '/tmp/project', logger, {
      ptyFactory,
      processTerminator: terminator
    });

    await orchestrator.startAll();
    expect(fakePty.writes[0]).toMatch(/Read \.arena\/REQUIREMENTS\.md/);

    fakePty.emitData('working\nDONE\n');
    // completeAgent is async — allow the termination promise to resolve
    await vi.waitFor(() => {
      expect(orchestrator.getSnapshot().agents[0]?.status).toBe('completed');
    });

    await orchestrator.restartAgent('alpha');
    await orchestrator.killAgent('alpha');
    expect(terminator).toHaveBeenCalledWith(101);
    expect(orchestrator.getSnapshot().agents[0]?.status).toBe('killed');
  });

  it('sends status checks on idle and resets when continue marker arrives', async () => {
    vi.useFakeTimers();
    const fakePty = new FakePty();
    const orchestrator = new ArenaOrchestrator(config, workspaces, '/tmp/project', logger, {
      ptyFactory: () => fakePty,
      processTerminator: () => Promise.resolve()
    });

    await orchestrator.startAll();
    await vi.advanceTimersByTimeAsync(30);
    expect(fakePty.writes.some((write) => write.includes('Status check'))).toBe(true);

    fakePty.emitData('CONT\n');
    expect(orchestrator.getSnapshot().agents[0]?.status).toBe('running');
    vi.useRealTimers();
  });

  it('attempts model recovery on early failure with a close match', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'orch-recovery-'));
    const arenaDir = path.join(tempDir, '.arena');
    await mkdir(arenaDir, { recursive: true });

    // Pre-populate model cache with valid models
    const cachePath = path.join(arenaDir, '.model-cache.json');
    await saveModelCache(cachePath, {
      fake: {
        models: ['gpt-5', 'gpt-5.1', 'gpt-5.1-codex'],
        discoveredAt: new Date().toISOString(),
        ttlMs: 3600000
      }
    });

    const badModelConfig: ArenaConfig = {
      ...config,
      variants: [
        {
          name: 'alpha',
          provider: 'fake',
          model: 'gpt-5.1-code',  // Typo — close to gpt-5.1-codex
          techStack: 'TypeScript',
          designPhilosophy: 'Testable',
          branch: 'variant/alpha'
        }
      ]
    };

    const badWorkspaces: VariantWorkspace[] = [
      { variant: badModelConfig.variants[0]!, worktreePath: '/tmp/alpha' }
    ];

    let ptyCount = 0;
    const fakePtys: FakePty[] = [];
    const ptyFactory: PtyFactory = () => {
      const pty = new FakePty();
      fakePtys.push(pty);
      ptyCount++;
      return pty;
    };

    const infoFn = vi.fn();
    const infoLogger: Logger = {
      debug() {},
      info: infoFn,
      warn() {},
      error() {}
    };

    let currentTime = 1000;
    const orchestrator = new ArenaOrchestrator(badModelConfig, badWorkspaces, tempDir, infoLogger, {
      ptyFactory,
      processTerminator: () => Promise.resolve(),
      now: () => currentTime
    });

    await orchestrator.startAll();
    expect(ptyCount).toBe(1);

    // Simulate invalid model error output then early failure
    fakePtys[0]!.emitData('Error: Invalid model "gpt-5.1-code". Must be one of the available models.\n');
    currentTime = 2000; // 1 second elapsed
    fakePtys[0]!.emitExit(1);

    // Wait for async recovery to complete
    await vi.waitFor(() => {
      expect(ptyCount).toBe(2); // Recovery launched a new PTY
    });

    // Check snapshot reflects corrected model
    const snapshot = orchestrator.getSnapshot();
    expect(snapshot.agents[0]?.model).toBe('gpt-5.1-codex');
    // Agent may be 'running' or 'idle' depending on timer behavior
    expect(['running', 'idle']).toContain(snapshot.agents[0]?.status);

    // Verify log message
    const infoCalls = infoFn.mock.calls;
    expect(infoCalls.some((args) => typeof args[0] === 'string' && args[0].includes('Retrying with "gpt-5.1-codex"'))).toBe(true);

    await orchestrator.close();
  });

  it('does not retry model recovery more than once', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'orch-no-retry-'));
    const arenaDir = path.join(tempDir, '.arena');
    await mkdir(arenaDir, { recursive: true });

    const cachePath = path.join(arenaDir, '.model-cache.json');
    await saveModelCache(cachePath, {
      fake: {
        models: ['gpt-5', 'gpt-5.1'],
        discoveredAt: new Date().toISOString(),
        ttlMs: 3600000
      }
    });

    const badModelConfig: ArenaConfig = {
      ...config,
      variants: [
        {
          name: 'alpha',
          provider: 'fake',
          model: 'gpt-5.2',  // Close to gpt-5.1
          techStack: 'TypeScript',
          designPhilosophy: 'Testable',
          branch: 'variant/alpha'
        }
      ]
    };

    const badWorkspaces: VariantWorkspace[] = [
      { variant: badModelConfig.variants[0]!, worktreePath: '/tmp/alpha' }
    ];

    let ptyCount = 0;
    const fakePtys: FakePty[] = [];
    const ptyFactory: PtyFactory = () => {
      const pty = new FakePty();
      fakePtys.push(pty);
      ptyCount++;
      return pty;
    };

    let currentTime = 1000;
    const orchestrator = new ArenaOrchestrator(badModelConfig, badWorkspaces, tempDir, logger, {
      ptyFactory,
      processTerminator: () => Promise.resolve(),
      now: () => currentTime
    });

    await orchestrator.startAll();
    expect(ptyCount).toBe(1);

    // First early failure with model error output — triggers recovery
    fakePtys[0]!.emitData('Error: Invalid model "gpt-5.2". Must be one of the available models.\n');
    currentTime = 2000;
    fakePtys[0]!.emitExit(1);

    await vi.waitFor(() => {
      expect(ptyCount).toBe(2);
    });

    // Second early failure — should NOT retry (modelRetryAttempted = true)
    fakePtys[1]!.emitData('Error: Invalid model "gpt-5". Must be one of the available models.\n');
    currentTime = 3000;
    fakePtys[1]!.emitExit(1);

    await vi.waitFor(() => {
      expect(orchestrator.getSnapshot().agents[0]?.status).toBe('failed');
    });

    // No third PTY created
    expect(ptyCount).toBe(2);
  });

  it('does not attempt recovery for late failures', async () => {
    let ptyCount = 0;
    const fakePtys: FakePty[] = [];
    const ptyFactory: PtyFactory = () => {
      const pty = new FakePty();
      fakePtys.push(pty);
      ptyCount++;
      return pty;
    };

    let currentTime = 1000;
    const orchestrator = new ArenaOrchestrator(config, workspaces, '/tmp/project', logger, {
      ptyFactory,
      processTerminator: () => Promise.resolve(),
      now: () => currentTime
    });

    await orchestrator.startAll();
    expect(ptyCount).toBe(1);

    // Late failure (well past 15s threshold)
    currentTime = 1000 + 60_000;
    fakePtys[0]!.emitExit(1);

    await vi.waitFor(() => {
      expect(orchestrator.getSnapshot().agents[0]?.status).toBe('failed');
    });

    // No retry attempt
    expect(ptyCount).toBe(1);
  });

  describe('terminal status permanence (oscillation prevention)', () => {
    it('completed status is never overwritten by idle timer', async () => {
      vi.useFakeTimers();
      const fakePty = new FakePty();
      const orchestrator = new ArenaOrchestrator(config, workspaces, '/tmp/project', logger, {
        ptyFactory: () => fakePty,
        processTerminator: () => Promise.resolve()
      });

      await orchestrator.startAll();

      // Complete via done marker
      fakePty.emitData('DONE\n');
      await vi.waitFor(() => {
        expect(orchestrator.getSnapshot().agents[0]?.status).toBe('completed');
      });

      // Advance timers well past idle timeout — handleIdle must not overwrite
      await vi.advanceTimersByTimeAsync(200);
      expect(orchestrator.getSnapshot().agents[0]?.status).toBe('completed');

      vi.useRealTimers();
    });

    it('completed status is never overwritten by post-completion data', async () => {
      vi.useFakeTimers();
      const fakePty = new FakePty();
      const orchestrator = new ArenaOrchestrator(config, workspaces, '/tmp/project', logger, {
        ptyFactory: () => fakePty,
        processTerminator: () => Promise.resolve()
      });

      await orchestrator.startAll();

      fakePty.emitData('DONE\n');
      await vi.waitFor(() => {
        expect(orchestrator.getSnapshot().agents[0]?.status).toBe('completed');
      });

      // Simulate data arriving after completion (e.g., terminal cleanup)
      fakePty.emitData('post-completion noise\n');
      await vi.advanceTimersByTimeAsync(200);

      expect(orchestrator.getSnapshot().agents[0]?.status).toBe('completed');
      vi.useRealTimers();
    });

    it('completed status is never overwritten by continue marker after completion', async () => {
      vi.useFakeTimers();
      const fakePty = new FakePty();
      const orchestrator = new ArenaOrchestrator(config, workspaces, '/tmp/project', logger, {
        ptyFactory: () => fakePty,
        processTerminator: () => Promise.resolve()
      });

      await orchestrator.startAll();

      fakePty.emitData('DONE\n');
      await vi.waitFor(() => {
        expect(orchestrator.getSnapshot().agents[0]?.status).toBe('completed');
      });

      // Continue marker after completion must not revert to running
      fakePty.emitData('CONT\n');
      await vi.advanceTimersByTimeAsync(200);

      expect(orchestrator.getSnapshot().agents[0]?.status).toBe('completed');
      vi.useRealTimers();
    });

    it('failed status is permanent — not overwritten by timers or data', async () => {
      vi.useFakeTimers();
      const fakePty = new FakePty();
      let currentTime = 1000;
      const orchestrator = new ArenaOrchestrator(config, workspaces, '/tmp/project', logger, {
        ptyFactory: () => fakePty,
        processTerminator: () => Promise.resolve(),
        now: () => currentTime
      });

      await orchestrator.startAll();

      // Late failure (past recovery threshold)
      currentTime = 1000 + 60_000;
      fakePty.emitExit(1);

      await vi.waitFor(() => {
        expect(orchestrator.getSnapshot().agents[0]?.status).toBe('failed');
      });

      // Post-failure data and timer advances must not change status
      fakePty.emitData('zombie data\n');
      await vi.advanceTimersByTimeAsync(200);

      expect(orchestrator.getSnapshot().agents[0]?.status).toBe('failed');
      vi.useRealTimers();
    });

    it('killed status is permanent — not overwritten by timers or data', async () => {
      vi.useFakeTimers();
      const fakePty = new FakePty();
      const orchestrator = new ArenaOrchestrator(config, workspaces, '/tmp/project', logger, {
        ptyFactory: () => fakePty,
        processTerminator: () => Promise.resolve()
      });

      await orchestrator.startAll();
      await orchestrator.killAgent('alpha');

      expect(orchestrator.getSnapshot().agents[0]?.status).toBe('killed');

      // Post-kill data and timer advances must not change status
      fakePty.emitData('zombie data\n');
      await vi.advanceTimersByTimeAsync(200);

      expect(orchestrator.getSnapshot().agents[0]?.status).toBe('killed');
      vi.useRealTimers();
    });

    it('status events never show a terminal→non-terminal transition', async () => {
      vi.useFakeTimers();
      const fakePty = new FakePty();
      const orchestrator = new ArenaOrchestrator(config, workspaces, '/tmp/project', logger, {
        ptyFactory: () => fakePty,
        processTerminator: () => Promise.resolve()
      });

      const statusHistory: string[] = [];
      orchestrator.on('message', (msg) => {
        if (msg.type === 'agent-state') {
          statusHistory.push(msg.status);
        }
      });

      await orchestrator.startAll();

      // Complete the agent
      fakePty.emitData('DONE\n');
      await vi.waitFor(() => {
        expect(orchestrator.getSnapshot().agents[0]?.status).toBe('completed');
      });

      // Bombard with data and timer advances
      fakePty.emitData('extra data\n');
      fakePty.emitData('CONT\n');
      await vi.advanceTimersByTimeAsync(500);

      // Find the index of the first 'completed' status
      const completedIndex = statusHistory.indexOf('completed');
      expect(completedIndex).toBeGreaterThanOrEqual(0);

      // After 'completed', no non-terminal statuses should appear
      const postCompletion = statusHistory.slice(completedIndex + 1);
      const nonTerminal = postCompletion.filter(
        (s) => s !== 'completed' && s !== 'failed' && s !== 'killed'
      );
      expect(nonTerminal).toEqual([]);

      vi.useRealTimers();
    });


    it('absolute timer firing after completion does not overwrite terminal status', async () => {
      vi.useFakeTimers();
      const fakePty = new FakePty();
      const orchestrator = new ArenaOrchestrator(config, workspaces, '/tmp/project', logger, {
        ptyFactory: () => fakePty,
        processTerminator: () => Promise.resolve()
      });

      await orchestrator.startAll();

      // Complete via done marker
      fakePty.emitData('DONE\n');
      await vi.waitFor(() => {
        expect(orchestrator.getSnapshot().agents[0]?.status).toBe('completed');
      });

      // Advance past the absolute timeout — failAgent must not overwrite completed
      await vi.advanceTimersByTimeAsync(config.agentTimeoutMs + 1000);
      expect(orchestrator.getSnapshot().agents[0]?.status).toBe('completed');

      vi.useRealTimers();
    });

    it('failAgent is idempotent — does not corrupt already-completed agent state', async () => {
      vi.useFakeTimers();
      const fakePty = new FakePty();
      let currentTime = 1000;
      const orchestrator = new ArenaOrchestrator(config, workspaces, '/tmp/project', logger, {
        ptyFactory: () => fakePty,
        processTerminator: () => Promise.resolve(),
        now: () => currentTime
      });

      await orchestrator.startAll();

      // Complete the agent
      fakePty.emitData('DONE\n');
      await vi.waitFor(() => {
        expect(orchestrator.getSnapshot().agents[0]?.status).toBe('completed');
      });

      const snapshotAfterComplete = orchestrator.getSnapshot().agents[0]!;

      // Advance time and trigger absolute timeout
      currentTime = 1000 + config.agentTimeoutMs + 5000;
      await vi.advanceTimersByTimeAsync(config.agentTimeoutMs + 5000);

      // Status, exitCode, and completedAt must remain unchanged
      const snapshotAfterTimeout = orchestrator.getSnapshot().agents[0]!;
      expect(snapshotAfterTimeout.status).toBe('completed');
      expect(snapshotAfterTimeout.exitCode).toBe(snapshotAfterComplete.exitCode);
      expect(snapshotAfterTimeout.error).toBeUndefined();

      vi.useRealTimers();
    });
  });
});
