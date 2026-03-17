import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initRepo, createWorktree, listWorktrees, removeWorktree } from '../utils/git.js';

describe('Git Utilities', () => {
  let tmpDir: string;
  let repoPath: string;
  let worktreeBase: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arena-git-'));
    repoPath = path.join(tmpDir, 'test-repo');
    worktreeBase = path.join(tmpDir, 'worktrees');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should init repo, create worktree, list, and remove', async () => {
    // Init
    await initRepo(repoPath);
    const gitDir = await fs.stat(path.join(repoPath, '.git'));
    expect(gitDir.isDirectory()).toBe(true);

    // Create worktree
    const wtPath = path.join(worktreeBase, 'test-variant');
    await createWorktree(repoPath, wtPath, 'variant/test-variant');

    // Verify worktree exists
    const wtStat = await fs.stat(wtPath);
    expect(wtStat.isDirectory()).toBe(true);

    // List worktrees
    const worktrees = await listWorktrees(repoPath);
    expect(worktrees.length).toBeGreaterThanOrEqual(2); // main + new worktree
    const found = worktrees.find(w => w.branch === 'variant/test-variant');
    expect(found).toBeDefined();

    // Remove worktree
    await removeWorktree(repoPath, wtPath);
    const remaining = await listWorktrees(repoPath);
    const stillThere = remaining.find(w => w.branch === 'variant/test-variant');
    expect(stillThere).toBeUndefined();
  });
});
