import { mkdtemp, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { NodeCommandRunner } from './command-runner';
import { GitRepositoryManager } from './repository';
import { planRemoteCleanup, executeRemoteCleanup, formatRemoteCleanupResult } from './remote-cleanup';

const execFileAsync = promisify(execFile);

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {}
};

// ── Test helpers ──

const createRemoteBackedRepo = async (): Promise<{ gitRoot: string; remoteDir: string }> => {
  // Create bare remote
  const remoteDir = await mkdtemp(path.join(os.tmpdir(), 'arena-remote-'));
  await execFileAsync('git', ['init', '--bare', remoteDir]);

  // Create working repo that pushes to the bare remote
  const gitRoot = await mkdtemp(path.join(os.tmpdir(), 'arena-work-'));
  await execFileAsync('git', ['init', gitRoot]);
  await execFileAsync('git', [
    '-C', gitRoot, '-c', 'user.name=Test', '-c', 'user.email=test@test.com',
    'commit', '--allow-empty', '-m', 'init'
  ]);
  await execFileAsync('git', ['-C', gitRoot, 'remote', 'add', 'origin', remoteDir]);
  await execFileAsync('git', ['-C', gitRoot, 'push', 'origin', 'HEAD']);

  return { gitRoot: await realpath(gitRoot), remoteDir: await realpath(remoteDir) };
};

const pushBranch = async (gitRoot: string, branch: string): Promise<void> => {
  await execFileAsync('git', ['-C', gitRoot, 'checkout', '-b', branch]);
  await execFileAsync('git', [
    '-C', gitRoot, '-c', 'user.name=Test', '-c', 'user.email=test@test.com',
    'commit', '--allow-empty', '-m', `commit on ${branch}`
  ]);
  await execFileAsync('git', ['-C', gitRoot, 'push', 'origin', branch]);
  // Go back to default branch
  await execFileAsync('git', ['-C', gitRoot, 'checkout', '-']);
};

const createOpenPullRequestRef = async (
  remoteDir: string,
  branch: string,
  prNumber: number
): Promise<void> => {
  // Get the OID of the branch tip
  const { stdout } = await execFileAsync('git', [
    '-C', remoteDir, 'rev-parse', `refs/heads/${branch}`
  ]);
  const oid = stdout.trim();
  // Create a PR ref pointing to the same OID
  await execFileAsync('git', [
    '-C', remoteDir, 'update-ref', `refs/pull/${prNumber}/head`, oid
  ]);
};

const listRemoteHeads = async (remoteDir: string): Promise<string[]> => {
  const { stdout } = await execFileAsync('git', [
    '-C', remoteDir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/'
  ]);
  return stdout.trim().split('\n').filter((l) => l.length > 0);
};

const remoteHasBranch = async (remoteDir: string, branch: string): Promise<boolean> => {
  const heads = await listRemoteHeads(remoteDir);
  return heads.includes(branch);
};

// ── Integration tests ──

describe('Remote branch cleanup integration', () => {
  it('deletes accepted variant arena branch, preserves accept branch', async () => {
    const { gitRoot, remoteDir } = await createRemoteBackedRepo();
    const manager = new GitRepositoryManager(new NodeCommandRunner(), silentLogger);

    // Push two variant branches
    await pushBranch(gitRoot, 'arena/test/variant-a');
    await pushBranch(gitRoot, 'arena/test/variant-b');

    // Accept variant-a by creating an accept branch
    await execFileAsync('git', ['-C', gitRoot, 'branch', 'accept/test/variant-a', 'arena/test/variant-a']);
    await execFileAsync('git', ['-C', gitRoot, 'push', 'origin', 'accept/test/variant-a']);

    // Verify both arena branches and the accept branch exist on remote
    expect(await remoteHasBranch(remoteDir, 'arena/test/variant-a')).toBe(true);
    expect(await remoteHasBranch(remoteDir, 'arena/test/variant-b')).toBe(true);
    expect(await remoteHasBranch(remoteDir, 'accept/test/variant-a')).toBe(true);

    // Plan and execute cleanup
    const plan = await planRemoteCleanup({
      repository: manager,
      gitRoot,
      arenaName: 'test',
      branches: ['arena/test/variant-a', 'arena/test/variant-b'],
      logger: silentLogger
    });

    // Accepted variant's arena branch should be scheduled for deletion
    expect(plan.toDelete).toContain('arena/test/variant-a');
    expect(plan.toDelete).toContain('arena/test/variant-b');
    expect(plan.toSkip).not.toContainEqual(
      expect.objectContaining({ branch: 'arena/test/variant-a' })
    );

    const result = await executeRemoteCleanup({
      repository: manager,
      gitRoot,
      plan,
      logger: silentLogger
    });

    expect(result.deleted).toContain('arena/test/variant-a');
    expect(result.deleted).toContain('arena/test/variant-b');
    expect(result.errors).toHaveLength(0);

    // Verify remote state: arena branches deleted, accept branch preserved
    expect(await remoteHasBranch(remoteDir, 'arena/test/variant-a')).toBe(false);
    expect(await remoteHasBranch(remoteDir, 'arena/test/variant-b')).toBe(false);
    expect(await remoteHasBranch(remoteDir, 'accept/test/variant-a')).toBe(true);
  }, 30_000);

  it('detects open PRs via OID fallback', async () => {
    const { gitRoot, remoteDir } = await createRemoteBackedRepo();
    const manager = new GitRepositoryManager(new NodeCommandRunner(), silentLogger);

    // Push a variant branch
    await pushBranch(gitRoot, 'arena/test/variant-pr');

    // Create a PR ref on the bare remote
    await createOpenPullRequestRef(remoteDir, 'arena/test/variant-pr', 42);

    // Plan cleanup (gh is typically unavailable in test env, so OID fallback should kick in)
    const plan = await planRemoteCleanup({
      repository: manager,
      gitRoot,
      arenaName: 'test',
      branches: ['arena/test/variant-pr'],
      logger: silentLogger
    });

    expect(plan.toSkip).toContainEqual(
      expect.objectContaining({ branch: 'arena/test/variant-pr', reason: 'has open pull request' })
    );
    expect(plan.toDelete).toHaveLength(0);

    // Verify branch is still on remote
    expect(await remoteHasBranch(remoteDir, 'arena/test/variant-pr')).toBe(true);
  }, 30_000);

  it('force mode deletes branches with PR refs', async () => {
    const { gitRoot, remoteDir } = await createRemoteBackedRepo();
    const manager = new GitRepositoryManager(new NodeCommandRunner(), silentLogger);

    await pushBranch(gitRoot, 'arena/test/variant-force');
    await createOpenPullRequestRef(remoteDir, 'arena/test/variant-force', 99);

    const plan = await planRemoteCleanup({
      repository: manager,
      gitRoot,
      arenaName: 'test',
      branches: ['arena/test/variant-force'],
      force: true,
      logger: silentLogger
    });

    expect(plan.toDelete).toContain('arena/test/variant-force');

    const result = await executeRemoteCleanup({
      repository: manager,
      gitRoot,
      plan,
      logger: silentLogger
    });

    expect(result.deleted).toContain('arena/test/variant-force');
    expect(await remoteHasBranch(remoteDir, 'arena/test/variant-force')).toBe(false);
  }, 30_000);

  it('--keep-remote preserves all remote branches', async () => {
    const { gitRoot, remoteDir } = await createRemoteBackedRepo();
    const manager = new GitRepositoryManager(new NodeCommandRunner(), silentLogger);

    await pushBranch(gitRoot, 'arena/test/variant-keep');

    const plan = await planRemoteCleanup({
      repository: manager,
      gitRoot,
      arenaName: 'test',
      branches: ['arena/test/variant-keep'],
      keepRemote: true,
      logger: silentLogger
    });

    expect(plan.toDelete).toHaveLength(0);
    expect(plan.toSkip).toHaveLength(0);

    const result = await executeRemoteCleanup({
      repository: manager,
      gitRoot,
      plan,
      logger: silentLogger
    });

    expect(result.deleted).toHaveLength(0);
    expect(await remoteHasBranch(remoteDir, 'arena/test/variant-keep')).toBe(true);
  }, 30_000);

  it('handles unreachable remote gracefully', async () => {
    const gitRoot = await mkdtemp(path.join(os.tmpdir(), 'arena-unreachable-'));
    await execFileAsync('git', ['init', gitRoot]);
    await execFileAsync('git', [
      '-C', gitRoot, '-c', 'user.name=Test', '-c', 'user.email=test@test.com',
      'commit', '--allow-empty', '-m', 'init'
    ]);
    // Point to a nonexistent remote
    await execFileAsync('git', [
      '-C', gitRoot, 'remote', 'add', 'origin', '/nonexistent/path/to/remote'
    ]);

    const manager = new GitRepositoryManager(new NodeCommandRunner(), silentLogger);

    const plan = await planRemoteCleanup({
      repository: manager,
      gitRoot,
      arenaName: 'test',
      branches: ['arena/test/variant-x'],
      logger: silentLogger
    });

    expect(plan.remoteReachable).toBe(false);
    expect(plan.toDelete).toHaveLength(0);
    expect(plan.toSkip).toContainEqual(
      expect.objectContaining({ reason: 'remote unreachable' })
    );
  }, 30_000);

  it('formatRemoteCleanupResult produces readable output for integration scenario', () => {
    const result = {
      deleted: ['arena/test/variant-a', 'arena/test/variant-b'],
      skipped: [],
      errors: []
    };

    const output = formatRemoteCleanupResult(result);
    expect(output).toContain('deleted');
    expect(output).toContain('arena/test/variant-a');
    expect(output).toContain('arena/test/variant-b');
  });
});
