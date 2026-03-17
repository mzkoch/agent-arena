import { mkdtemp, readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { NodeCommandRunner } from './command-runner';
import { GitRepositoryManager } from './repository';

const execFileAsync = promisify(execFile);

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {}
};

const createGitRepo = async (): Promise<string> => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-git-'));
  await execFileAsync('git', ['init', tempDir]);
  await execFileAsync('git', [
    '-C', tempDir, '-c', 'user.name=Test', '-c', 'user.email=test@test.com',
    'commit', '--allow-empty', '-m', 'init'
  ]);
  return tempDir;
};

describe('GitRepositoryManager', () => {
  it('verifies repos, creates worktrees, lists them, writes files, and cleans them', async () => {
    const gitRoot = await createGitRepo();
    const worktreePath = path.join(gitRoot, '.arena', 'worktrees', 'alpha');

    const manager = new GitRepositoryManager(new NodeCommandRunner(), silentLogger);

    await manager.verifyRepo(gitRoot);
    await manager.createWorktree(gitRoot, 'arena/alpha', worktreePath);
    await manager.writeVariantFiles(
      {
        variant: {
          name: 'alpha',
          provider: 'copilot-cli',
          model: 'gpt-5',
          techStack: 'TypeScript',
          designPhilosophy: 'Testable',
          branch: 'arena/alpha'
        },
        worktreePath
      },
      '# requirements',
      '# instructions'
    );

    const worktrees = await manager.listWorktrees(gitRoot);
    const canonicalWorktreePath = await realpath(worktreePath);
    expect(worktrees.some((entry) => entry.path === canonicalWorktreePath)).toBe(true);
    expect(worktrees.some((entry) => entry.branch === 'arena/alpha')).toBe(true);

    await manager.clean(gitRoot, ['arena/alpha']);
    const cleaned = await manager.listWorktrees(gitRoot);
    const canonicalGitRoot = await realpath(gitRoot);
    expect(cleaned.every((entry) => entry.path === canonicalGitRoot)).toBe(true);
  });

  it('ensures .gitignore entry idempotently', async () => {
    const gitRoot = await createGitRepo();
    const manager = new GitRepositoryManager(new NodeCommandRunner(), silentLogger);

    await manager.ensureGitignoreEntry(gitRoot, '.arena/');
    const first = await readFile(path.join(gitRoot, '.gitignore'), 'utf8');
    expect(first).toContain('.arena/');

    await manager.ensureGitignoreEntry(gitRoot, '.arena/');
    const second = await readFile(path.join(gitRoot, '.gitignore'), 'utf8');
    expect(second).toBe(first);
  });

  it('skips worktree creation if already exists', async () => {
    const gitRoot = await createGitRepo();
    const worktreePath = path.join(gitRoot, '.arena', 'worktrees', 'beta');
    const manager = new GitRepositoryManager(new NodeCommandRunner(), silentLogger);

    await manager.createWorktree(gitRoot, 'arena/beta', worktreePath);
    await manager.createWorktree(gitRoot, 'arena/beta', worktreePath);

    const worktrees = await manager.listWorktrees(gitRoot);
    const canonicalWorktreePath = await realpath(worktreePath);
    const matches = worktrees.filter((entry) => entry.path === canonicalWorktreePath);
    expect(matches).toHaveLength(1);
  });

  it('verifyRepo creates initial commit on empty repo', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-git-'));
    await execFileAsync('git', ['init', tempDir]);
    const manager = new GitRepositoryManager(new NodeCommandRunner(), silentLogger);

    await manager.verifyRepo(tempDir);

    const { stdout } = await execFileAsync('git', ['-C', tempDir, 'log', '--oneline']);
    expect(stdout.trim()).toContain('Initial commit');
  });

  it('verifyRepo throws on non-git directory', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-nogit-'));
    const manager = new GitRepositoryManager(new NodeCommandRunner(), silentLogger);

    await expect(manager.verifyRepo(tempDir)).rejects.toThrow(/no git repository/i);
  });
});
