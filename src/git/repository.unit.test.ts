/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';
import type { CommandRunner, CommandResult } from './command-runner';
import { GitRepositoryManager } from './repository';

const silentLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};

const createMockRunner = (
  responses: Array<{ command?: string; args?: string[]; result: CommandResult }>
): CommandRunner => {
  let callIndex = 0;
  return {
    run: vi.fn((_command: string, _args: string[]): Promise<CommandResult> => {
      if (callIndex >= responses.length) {
        throw new Error(`Unexpected call #${callIndex}: ${_command} ${_args.join(' ')}`);
      }
      const response = responses[callIndex++]!;
      return Promise.resolve(response.result);
    })
  };
};

describe('GitRepositoryManager - isRemoteReachable', () => {
  it('returns true when exit code is 0 (reachable with refs)', async () => {
    const runner = createMockRunner([
      { result: { exitCode: 0, stdout: 'abc123\tHEAD\n', stderr: '' } }
    ]);
    const manager = new GitRepositoryManager(runner, silentLogger);

    const result = await manager.isRemoteReachable('/repo', 'origin');
    expect(result).toBe(true);
    expect(vi.mocked(runner.run)).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['ls-remote', '--exit-code', 'origin', 'HEAD'])
    );
  });

  it('returns true when exit code is 2 (reachable but no matching refs)', async () => {
    const runner = createMockRunner([
      { result: { exitCode: 2, stdout: '', stderr: '' } }
    ]);
    const manager = new GitRepositoryManager(runner, silentLogger);

    const result = await manager.isRemoteReachable('/repo', 'origin');
    expect(result).toBe(true);
  });

  it('returns false when exit code is 128 (unreachable)', async () => {
    const runner = createMockRunner([
      { result: { exitCode: 128, stdout: '', stderr: 'fatal: could not read from remote repository' } }
    ]);
    const manager = new GitRepositoryManager(runner, silentLogger);

    const result = await manager.isRemoteReachable('/repo', 'origin');
    expect(result).toBe(false);
  });

  it('defaults remote to "origin"', async () => {
    const runner = createMockRunner([
      { result: { exitCode: 0, stdout: '', stderr: '' } }
    ]);
    const manager = new GitRepositoryManager(runner, silentLogger);

    await manager.isRemoteReachable('/repo');
    expect(vi.mocked(runner.run)).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['ls-remote', '--exit-code', 'origin', 'HEAD'])
    );
  });

  it('uses custom remote name', async () => {
    const runner = createMockRunner([
      { result: { exitCode: 0, stdout: '', stderr: '' } }
    ]);
    const manager = new GitRepositoryManager(runner, silentLogger);

    await manager.isRemoteReachable('/repo', 'upstream');
    expect(vi.mocked(runner.run)).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['ls-remote', '--exit-code', 'upstream', 'HEAD'])
    );
  });
});

describe('GitRepositoryManager - listRemoteRefs', () => {
  it('parses ls-remote output into a Map', async () => {
    const lsRemoteOutput = [
      'abc123def456\trefs/heads/arena/test/variant-a',
      'def789abc012\trefs/heads/arena/test/variant-b',
      '111222333444\trefs/tags/accept/test/variant-a',
      '555666777888\trefs/pull/1/head'
    ].join('\n');

    const runner = createMockRunner([
      { result: { exitCode: 0, stdout: lsRemoteOutput, stderr: '' } }
    ]);
    const manager = new GitRepositoryManager(runner, silentLogger);

    const refs = await manager.listRemoteRefs('/repo', 'origin', [
      'refs/heads/arena/test/*',
      'refs/tags/accept/test/*',
      'refs/pull/*/head'
    ]);

    expect(refs).toBeInstanceOf(Map);
    expect(refs.size).toBe(4);
    expect(refs.get('refs/heads/arena/test/variant-a')).toBe('abc123def456');
    expect(refs.get('refs/heads/arena/test/variant-b')).toBe('def789abc012');
    expect(refs.get('refs/tags/accept/test/variant-a')).toBe('111222333444');
    expect(refs.get('refs/pull/1/head')).toBe('555666777888');
  });

  it('returns empty map on empty output', async () => {
    const runner = createMockRunner([
      { result: { exitCode: 0, stdout: '', stderr: '' } }
    ]);
    const manager = new GitRepositoryManager(runner, silentLogger);

    const refs = await manager.listRemoteRefs('/repo', 'origin', ['refs/heads/*']);
    expect(refs.size).toBe(0);
  });

  it('throws on failure', async () => {
    const runner = createMockRunner([
      { result: { exitCode: 128, stdout: '', stderr: 'fatal: error' } }
    ]);
    const manager = new GitRepositoryManager(runner, silentLogger);

    await expect(
      manager.listRemoteRefs('/repo', 'origin', ['refs/heads/*'])
    ).rejects.toThrow(/Failed to list remote refs/);
  });

  it('passes patterns to ls-remote command', async () => {
    const runner = createMockRunner([
      { result: { exitCode: 0, stdout: '', stderr: '' } }
    ]);
    const manager = new GitRepositoryManager(runner, silentLogger);

    await manager.listRemoteRefs('/repo', 'origin', [
      'refs/pull/*/head',
      'refs/heads/arena/test/*'
    ]);

    expect(vi.mocked(runner.run)).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining([
        'ls-remote', '--refs', 'origin',
        'refs/pull/*/head', 'refs/heads/arena/test/*'
      ])
    );
  });

  it('handles lines with whitespace correctly', async () => {
    const lsRemoteOutput = '  abc123\trefs/heads/branch  \n\n  def456\trefs/tags/tag  \n';
    const runner = createMockRunner([
      { result: { exitCode: 0, stdout: lsRemoteOutput, stderr: '' } }
    ]);
    const manager = new GitRepositoryManager(runner, silentLogger);

    const refs = await manager.listRemoteRefs('/repo', 'origin', ['refs/heads/*']);
    expect(refs.get('refs/heads/branch')).toBe('abc123');
    expect(refs.get('refs/tags/tag')).toBe('def456');
  });
});

describe('GitRepositoryManager - deleteRemoteBranch', () => {
  it('pushes --delete for the branch', async () => {
    const runner = createMockRunner([
      { result: { exitCode: 0, stdout: '', stderr: '' } }
    ]);
    const manager = new GitRepositoryManager(runner, silentLogger);

    await manager.deleteRemoteBranch('/repo', 'arena/test/variant-a');
    expect(vi.mocked(runner.run)).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['push', 'origin', '--delete', 'arena/test/variant-a'])
    );
  });

  it('uses custom remote name', async () => {
    const runner = createMockRunner([
      { result: { exitCode: 0, stdout: '', stderr: '' } }
    ]);
    const manager = new GitRepositoryManager(runner, silentLogger);

    await manager.deleteRemoteBranch('/repo', 'arena/test/variant-a', 'upstream');
    expect(vi.mocked(runner.run)).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['push', 'upstream', '--delete', 'arena/test/variant-a'])
    );
  });

  it('throws on failure', async () => {
    const runner = createMockRunner([
      { result: { exitCode: 1, stdout: '', stderr: 'error: unable to delete' } }
    ]);
    const manager = new GitRepositoryManager(runner, silentLogger);

    await expect(
      manager.deleteRemoteBranch('/repo', 'arena/test/variant-a')
    ).rejects.toThrow(/failed to delete remote branch/i);
  });
});

describe('GitRepositoryManager - hasOpenPullRequest', () => {
  const remoteRefs = new Map<string, string>([
    ['refs/heads/arena/test/variant-a', 'aaa111'],
    ['refs/heads/arena/test/variant-b', 'bbb222'],
    ['refs/pull/1/head', 'aaa111'],
    ['refs/pull/2/head', 'ccc333']
  ]);

  it('returns true via gh when gh is available and finds a PR', async () => {
    const runner = createMockRunner([
      // gh pr list
      {
        result: {
          exitCode: 0,
          stdout: '[{"number":1}]',
          stderr: ''
        }
      }
    ]);
    const manager = new GitRepositoryManager(runner, silentLogger);

    const result = await manager.hasOpenPullRequest(
      '/repo',
      'arena/test/variant-a',
      remoteRefs,
      true  // ghAvailable
    );
    expect(result).toBe(true);
  });

  it('returns false via gh when gh finds no PRs', async () => {
    const runner = createMockRunner([
      // gh pr list returns empty
      { result: { exitCode: 0, stdout: '', stderr: '' } }
    ]);
    const manager = new GitRepositoryManager(runner, silentLogger);

    const result = await manager.hasOpenPullRequest(
      '/repo',
      'arena/test/variant-c',
      remoteRefs,
      true  // ghAvailable
    );
    expect(result).toBe(false);
  });

  it('falls back to OID matching when gh fails', async () => {
    const runner = createMockRunner([
      // gh pr list fails
      { result: { exitCode: 1, stdout: '', stderr: 'rate limited' } }
    ]);
    const manager = new GitRepositoryManager(runner, silentLogger);

    // variant-a OID matches refs/pull/1/head
    const result = await manager.hasOpenPullRequest(
      '/repo',
      'arena/test/variant-a',
      remoteRefs,
      true  // ghAvailable
    );
    expect(result).toBe(true);
  });

  it('uses OID matching when gh is not available', async () => {
    const runner = createMockRunner([]);
    const manager = new GitRepositoryManager(runner, silentLogger);

    // variant-a OID (aaa111) matches refs/pull/1/head
    const result = await manager.hasOpenPullRequest(
      '/repo',
      'arena/test/variant-a',
      remoteRefs,
      false  // ghAvailable
    );
    expect(result).toBe(true);
  });

  it('returns false via OID when no PR refs match the branch OID', async () => {
    const runner = createMockRunner([]);
    const manager = new GitRepositoryManager(runner, silentLogger);

    // variant-b OID (bbb222) does not match any PR ref
    const result = await manager.hasOpenPullRequest(
      '/repo',
      'arena/test/variant-b',
      remoteRefs,
      false  // ghAvailable
    );
    expect(result).toBe(false);
  });

  it('returns false when branch is not in remoteRefs and gh is unavailable', async () => {
    const runner = createMockRunner([]);
    const manager = new GitRepositoryManager(runner, silentLogger);

    const result = await manager.hasOpenPullRequest(
      '/repo',
      'arena/test/nonexistent',
      remoteRefs,
      false  // ghAvailable
    );
    expect(result).toBe(false);
  });
});
