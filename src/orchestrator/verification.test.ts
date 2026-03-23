import { describe, expect, it, vi } from 'vitest';
import { verifyWorkspaceCompletion, type VerificationGitOps } from './verification';
import type { CompletionVerificationConfig } from '../domain/types';
import type { CommandRunner, CommandResult } from '../git/command-runner';

const createMockCommandRunner = (results: CommandResult[]): CommandRunner => {
  let callIndex = 0;
  return {
    run: vi.fn((): Promise<CommandResult> => {
      if (callIndex >= results.length) {
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0, timedOut: false });
      }
      return Promise.resolve(results[callIndex++]!);
    })
  };
};

const createMockGitOps = (overrides: {
  resolveBaseRef?: () => Promise<string>;
  getCommitCountSinceRef?: () => Promise<number>;
} = {}): VerificationGitOps => ({
  resolveBaseRef: overrides.resolveBaseRef ?? vi.fn(() => Promise.resolve('main')),
  getCommitCountSinceRef: overrides.getCommitCountSinceRef ?? vi.fn(() => Promise.resolve(3))
});

const defaultConfig: CompletionVerificationConfig = {
  enabled: true,
  requireCommit: true,
  requireCleanWorktree: true
};

describe('verifyWorkspaceCompletion', () => {
  describe('commit verification', () => {
    it('passes when commits exist ahead of base ref', async () => {
      const gitManager = createMockGitOps({
        getCommitCountSinceRef: vi.fn(() => Promise.resolve(5))
      });
      const commandRunner = createMockCommandRunner([
        // git status --porcelain (clean)
        { stdout: '', stderr: '', exitCode: 0, timedOut: false }
      ]);

      const result = await verifyWorkspaceCompletion('/worktree', defaultConfig, gitManager, commandRunner);
      expect(result.passed).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.commitCount).toBe(5);
      expect(result.baseRef).toBe('main');
    });

    it('fails when no commits ahead of base ref', async () => {
      const gitManager = createMockGitOps({
        getCommitCountSinceRef: vi.fn(() => Promise.resolve(0))
      });
      const commandRunner = createMockCommandRunner([
        { stdout: '', stderr: '', exitCode: 0, timedOut: false }
      ]);

      const result = await verifyWorkspaceCompletion('/worktree', defaultConfig, gitManager, commandRunner);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('No commits ahead of main. Commit your work.');
    });

    it('skips commit check when requireCommit is false', async () => {
      const config: CompletionVerificationConfig = { ...defaultConfig, requireCommit: false };
      const gitManager = createMockGitOps({
        getCommitCountSinceRef: vi.fn(() => Promise.resolve(0))
      });
      const commandRunner = createMockCommandRunner([
        { stdout: '', stderr: '', exitCode: 0, timedOut: false }
      ]);

      const result = await verifyWorkspaceCompletion('/worktree', config, gitManager, commandRunner);
      expect(result.passed).toBe(true);
    });

    it('fails when base ref cannot be resolved and requireCommit is true', async () => {
      const gitManager = createMockGitOps({
        resolveBaseRef: vi.fn(() => Promise.reject(new Error('No base ref')))
      });
      const commandRunner = createMockCommandRunner([]);

      const result = await verifyWorkspaceCompletion('/worktree', defaultConfig, gitManager, commandRunner);
      expect(result.passed).toBe(false);
      expect(result.issues[0]).toContain('Unable to determine base ref');
    });
  });

  describe('clean worktree verification', () => {
    it('fails when uncommitted changes exist', async () => {
      const gitManager = createMockGitOps();
      const commandRunner = createMockCommandRunner([
        // git status --porcelain (dirty)
        { stdout: ' M src/index.ts\n?? newfile.ts\n', stderr: '', exitCode: 0, timedOut: false }
      ]);

      const result = await verifyWorkspaceCompletion('/worktree', defaultConfig, gitManager, commandRunner);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Uncommitted changes detected. Commit or stash all changes.');
    });

    it('passes when worktree is clean', async () => {
      const gitManager = createMockGitOps();
      const commandRunner = createMockCommandRunner([
        { stdout: '', stderr: '', exitCode: 0, timedOut: false }
      ]);

      const result = await verifyWorkspaceCompletion('/worktree', defaultConfig, gitManager, commandRunner);
      expect(result.passed).toBe(true);
    });

    it('skips clean worktree check when requireCleanWorktree is false', async () => {
      const config: CompletionVerificationConfig = { ...defaultConfig, requireCleanWorktree: false };
      const gitManager = createMockGitOps();
      const commandRunner = createMockCommandRunner([]);

      const result = await verifyWorkspaceCompletion('/worktree', config, gitManager, commandRunner);
      expect(result.passed).toBe(true);
    });

    it('treats git status failure as dirty (fail closed)', async () => {
      const gitManager = createMockGitOps();
      const commandRunner = createMockCommandRunner([
        // git status --porcelain fails (non-zero exit)
        { stdout: '', stderr: 'fatal: not a git repository', exitCode: 128, timedOut: false }
      ]);

      const result = await verifyWorkspaceCompletion('/worktree', defaultConfig, gitManager, commandRunner);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Uncommitted changes detected. Commit or stash all changes.');
    });
  });

  describe('validation command', () => {
    it('passes when validation command exits with code 0', async () => {
      const config: CompletionVerificationConfig = {
        ...defaultConfig,
        command: { command: 'npm', args: ['test'], timeoutMs: 60_000 }
      };
      const gitManager = createMockGitOps();
      const commandRunner = createMockCommandRunner([
        // git status --porcelain (clean)
        { stdout: '', stderr: '', exitCode: 0, timedOut: false },
        // npm test (pass)
        { stdout: 'All tests passed', stderr: '', exitCode: 0, timedOut: false }
      ]);

      const result = await verifyWorkspaceCompletion('/worktree', config, gitManager, commandRunner);
      expect(result.passed).toBe(true);
      expect(result.commandResult).toEqual({
        exitCode: 0,
        stdout: 'All tests passed',
        stderr: '',
        timedOut: false
      });
    });

    it('fails when validation command exits with non-zero code', async () => {
      const config: CompletionVerificationConfig = {
        ...defaultConfig,
        command: { command: 'npm', args: ['test'], timeoutMs: 60_000 }
      };
      const gitManager = createMockGitOps();
      const commandRunner = createMockCommandRunner([
        // git status --porcelain (clean)
        { stdout: '', stderr: '', exitCode: 0, timedOut: false },
        // npm test (fail)
        { stdout: '', stderr: '3 tests failed', exitCode: 1, timedOut: false }
      ]);

      const result = await verifyWorkspaceCompletion('/worktree', config, gitManager, commandRunner);
      expect(result.passed).toBe(false);
      expect(result.issues[0]).toContain('Validation command failed with exit code 1');
      expect(result.issues[0]).toContain('3 tests failed');
    });

    it('fails when validation command times out', async () => {
      const config: CompletionVerificationConfig = {
        ...defaultConfig,
        command: { command: 'npm', args: ['test'], timeoutMs: 5_000 }
      };
      const gitManager = createMockGitOps();
      const commandRunner = createMockCommandRunner([
        // git status --porcelain (clean)
        { stdout: '', stderr: '', exitCode: 0, timedOut: false },
        // npm test (timeout)
        { stdout: '', stderr: '', exitCode: 143, timedOut: true }
      ]);

      const result = await verifyWorkspaceCompletion('/worktree', config, gitManager, commandRunner);
      expect(result.passed).toBe(false);
      expect(result.issues[0]).toContain('timed out after 5000ms');
      expect(result.commandResult?.timedOut).toBe(true);
    });
  });

  describe('multiple issues', () => {
    it('reports all failures at once', async () => {
      const config: CompletionVerificationConfig = {
        ...defaultConfig,
        command: { command: 'npm', args: ['test'], timeoutMs: 60_000 }
      };
      const gitManager = createMockGitOps({
        getCommitCountSinceRef: vi.fn(() => Promise.resolve(0))
      });
      const commandRunner = createMockCommandRunner([
        // git status --porcelain (dirty)
        { stdout: ' M file.ts\n', stderr: '', exitCode: 0, timedOut: false },
        // npm test (fail)
        { stdout: '', stderr: 'error', exitCode: 1, timedOut: false }
      ]);

      const result = await verifyWorkspaceCompletion('/worktree', config, gitManager, commandRunner);
      expect(result.passed).toBe(false);
      expect(result.issues).toHaveLength(3);
      expect(result.issues[0]).toContain('No commits');
      expect(result.issues[1]).toContain('Uncommitted changes');
      expect(result.issues[2]).toContain('Validation command failed');
    });
  });
});
