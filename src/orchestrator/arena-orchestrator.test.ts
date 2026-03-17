import { describe, expect, it, vi } from 'vitest';
import type { ArenaConfig, Logger, VariantWorkspace } from '../domain/types';
import { ArenaOrchestrator } from './arena-orchestrator';
import type { PtyFactory, PtyProcess } from './pty';

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
  info() {},
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
    expect(fakePty.writes[0]).toMatch(/Read REQUIREMENTS\.md/);

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
});
