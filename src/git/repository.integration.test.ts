import { mkdtemp, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeCommandRunner } from './command-runner';
import { GitRepositoryManager } from './repository';

describe('GitRepositoryManager', () => {
  it('initializes repos, creates worktrees, lists them, writes files, and cleans them', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-git-'));
    const repoPath = path.join(tempDir, 'repo');
    const worktreePath = path.join(tempDir, 'worktrees', 'alpha');

    const manager = new GitRepositoryManager(new NodeCommandRunner(), {
      debug() {},
      info() {},
      warn() {},
      error() {}
    });

    await manager.initRepo(repoPath);
    await manager.createWorktree(repoPath, 'variant/alpha', worktreePath);
    await manager.writeVariantFiles(
      {
        variant: {
          name: 'alpha',
          provider: 'copilot-cli',
          model: 'gpt-5',
          techStack: 'TypeScript',
          designPhilosophy: 'Testable',
          branch: 'variant/alpha'
        },
        worktreePath
      },
      '# requirements',
      '# instructions'
    );

    const worktrees = await manager.listWorktrees(repoPath);
    const canonicalWorktreePath = await realpath(worktreePath);
    expect(worktrees.some((entry) => entry.path === canonicalWorktreePath)).toBe(true);

    await manager.clean(repoPath);
    const cleaned = await manager.listWorktrees(repoPath);
    const canonicalRepoPath = await realpath(repoPath);
    expect(cleaned.every((entry) => entry.path === canonicalRepoPath)).toBe(true);
  });
});
