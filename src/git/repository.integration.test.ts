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

    const workspace = {
      variant: {
        name: 'alpha',
        provider: 'copilot-cli',
        model: 'gpt-5',
        techStack: 'TypeScript',
        designPhilosophy: 'Testable',
        branch: 'arena/alpha'
      },
      worktreePath
    };
    await manager.writeVariantFiles(workspace, '# requirements', '# instructions');

    // Files should be in .arena/ inside the worktree
    const req = await readFile(path.join(worktreePath, '.arena', 'REQUIREMENTS.md'), 'utf8');
    expect(req).toBe('# requirements');
    const instr = await readFile(path.join(worktreePath, '.arena', 'ARENA-INSTRUCTIONS.md'), 'utf8');
    expect(instr).toBe('# instructions');

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

  it('clean preserves non-arena worktrees', async () => {
    const gitRoot = await createGitRepo();
    const manager = new GitRepositoryManager(new NodeCommandRunner(), silentLogger);

    const arenaWorktree = path.join(gitRoot, '.arena', 'worktrees', 'gamma');
    await manager.createWorktree(gitRoot, 'arena/gamma', arenaWorktree);

    const userWorktree = path.join(gitRoot, 'external-worktrees', 'user-feature');
    await manager.createWorktree(gitRoot, 'feature/user-work', userWorktree);

    const before = await manager.listWorktrees(gitRoot);
    expect(before).toHaveLength(3);

    await manager.clean(gitRoot, ['arena/gamma']);

    const after = await manager.listWorktrees(gitRoot);
    const canonicalUser = await realpath(userWorktree);
    expect(after.some((entry) => entry.path === canonicalUser)).toBe(true);
    expect(after.some((entry) => entry.branch === 'arena/gamma')).toBe(false);
  });

  it('checks branch existence', async () => {
    const gitRoot = await createGitRepo();
    const manager = new GitRepositoryManager(new NodeCommandRunner(), silentLogger);

    expect(await manager.branchExists(gitRoot, 'nonexistent')).toBe(false);

    const worktreePath = path.join(gitRoot, '.arena', 'worktrees', 'check');
    await manager.createWorktree(gitRoot, 'arena/check', worktreePath);
    expect(await manager.branchExists(gitRoot, 'arena/check')).toBe(true);
  });

  it('creates a branch from another branch', async () => {
    const gitRoot = await createGitRepo();
    const manager = new GitRepositoryManager(new NodeCommandRunner(), silentLogger);

    const worktreePath = path.join(gitRoot, '.arena', 'worktrees', 'src');
    await manager.createWorktree(gitRoot, 'arena/src', worktreePath);

    await manager.createBranchFrom(gitRoot, 'accept/my/src', 'arena/src');
    expect(await manager.branchExists(gitRoot, 'accept/my/src')).toBe(true);
  });

  it('detects commits ahead of a base branch', async () => {
    const gitRoot = await createGitRepo();
    const manager = new GitRepositoryManager(new NodeCommandRunner(), silentLogger);

    const defaultBranch = await manager.getDefaultBranch(gitRoot);

    const worktreePath = path.join(gitRoot, '.arena', 'worktrees', 'ahead');
    await manager.createWorktree(gitRoot, 'arena/ahead', worktreePath);

    // Initially no commits ahead
    expect(await manager.hasCommitsAheadOf(gitRoot, 'arena/ahead', defaultBranch)).toBe(false);

    // Make a commit
    await execFileAsync('git', ['-C', worktreePath, '-c', 'user.name=Test', '-c', 'user.email=test@test.com', 'commit', '--allow-empty', '-m', 'ahead']);
    expect(await manager.hasCommitsAheadOf(gitRoot, 'arena/ahead', defaultBranch)).toBe(true);
  });

  it('adds .arena/ to worktree .gitignore', async () => {
    const gitRoot = await createGitRepo();
    const manager = new GitRepositoryManager(new NodeCommandRunner(), silentLogger);

    const worktreePath = path.join(gitRoot, '.arena', 'worktrees', 'gi');
    await manager.createWorktree(gitRoot, 'arena/gi', worktreePath);
    await manager.ensureWorktreeGitignore(worktreePath);

    const gitignore = await readFile(path.join(worktreePath, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.arena/');
  });
});
