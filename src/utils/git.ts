import { execa } from 'execa';
import path from 'node:path';
import fs from 'node:fs/promises';

/**
 * Initialize a new git repository with an empty initial commit.
 * Creates the repo directory if it doesn't exist.
 */
export async function initRepo(repoPath: string): Promise<void> {
  await fs.mkdir(repoPath, { recursive: true });
  await execa('git', ['init'], { cwd: repoPath });
  await execa('git', ['commit', '--allow-empty', '-m', 'Initial commit (arena)'], { cwd: repoPath });
}

/**
 * Create a git worktree for a variant.
 * Creates a new branch and worktree at the specified path.
 */
export async function createWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string,
): Promise<void> {
  await fs.mkdir(path.dirname(worktreePath), { recursive: true });
  await execa('git', ['worktree', 'add', '-b', branch, worktreePath], { cwd: repoPath });
}

/**
 * Remove a git worktree (force).
 */
export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  await execa('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoPath });
}

/**
 * List all worktrees for a repository.
 * Returns array of { path, branch, head } objects.
 */
export async function listWorktrees(repoPath: string): Promise<Array<{
  path: string;
  branch: string;
  head: string;
}>> {
  const { stdout } = await execa('git', ['worktree', 'list', '--porcelain'], { cwd: repoPath });
  const worktrees: Array<{ path: string; branch: string; head: string }> = [];
  let current: { path: string; branch: string; head: string } = { path: '', branch: '', head: '' };

  for (const line of stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) worktrees.push(current);
      current = { path: line.slice(9), branch: '', head: '' };
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice(5);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice(7).replace('refs/heads/', '');
    } else if (line === '') {
      if (current.path) {
        worktrees.push(current);
        current = { path: '', branch: '', head: '' };
      }
    }
  }
  if (current.path) worktrees.push(current);

  return worktrees;
}

/**
 * Get the resolved worktree path for a variant.
 */
export function getWorktreePath(worktreeBaseDir: string, variantName: string): string {
  return path.resolve(worktreeBaseDir, variantName);
}

/**
 * Remove all arena worktrees from a repository.
 */
export async function cleanWorktrees(repoPath: string): Promise<void> {
  const worktrees = await listWorktrees(repoPath);
  // Skip the main worktree (first one)
  for (const wt of worktrees.slice(1)) {
    await removeWorktree(repoPath, wt.path);
  }
  // Prune stale worktree info
  await execa('git', ['worktree', 'prune'], { cwd: repoPath });
}
