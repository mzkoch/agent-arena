/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';
import type { GitRepositoryManager } from './repository';
import {
  planRemoteCleanup,
  executeRemoteCleanup,
  formatRemoteCleanupResult,
} from './remote-cleanup';
import type { RemoteCleanupPlan, RemoteCleanupResult } from './remote-cleanup';

const silentLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};

type MockRepo = {
  [K in keyof GitRepositoryManager]: ReturnType<typeof vi.fn>;
};

const createMockRepo = (overrides: Partial<MockRepo> = {}): GitRepositoryManager => {
  const base: MockRepo = {
    isGhAvailable: vi.fn().mockResolvedValue(false),
    isRemoteReachable: vi.fn().mockResolvedValue(true),
    listRemoteRefs: vi.fn().mockResolvedValue(new Map()),
    deleteRemoteBranch: vi.fn().mockResolvedValue(undefined),
    hasOpenPullRequest: vi.fn().mockResolvedValue(false),
    verifyRepo: vi.fn(),
    createWorktree: vi.fn(),
    removeWorktree: vi.fn(),
    pruneWorktrees: vi.fn(),
    listWorktrees: vi.fn(),
    writeVariantFiles: vi.fn(),
    ensureWorktreeGitignore: vi.fn(),
    deleteBranch: vi.fn(),
    createBranchFrom: vi.fn(),
    hasCommitsAheadOf: vi.fn(),
    getCommitsAheadCount: vi.fn(),
    getBranchSafetyIssues: vi.fn(),
    getDefaultBranch: vi.fn(),
    branchExists: vi.fn(),
    clean: vi.fn(),
    ensureGitignoreEntry: vi.fn(),
    refExists: vi.fn().mockResolvedValue(false),
    resolveBaseRef: vi.fn(),
    listTreeFiles: vi.fn(),
    getChangedFiles: vi.fn(),
    getDiffNumStatRaw: vi.fn(),
    getUntrackedFiles: vi.fn(),
    getCommitCountSinceRef: vi.fn(),
    isAncestorOf: vi.fn().mockResolvedValue(false),
  };
  return { ...base, ...overrides } as unknown as GitRepositoryManager;
};

// ── Plan phase tests ──

describe('planRemoteCleanup', () => {
  it('returns skip-all when remote is unreachable', async () => {
    const repo = createMockRepo({
      isRemoteReachable: vi.fn().mockResolvedValue(false)
    });

    const plan = await planRemoteCleanup({
      repository: repo,
      gitRoot: '/repo',
      arenaName: 'test',
      branches: ['arena/test/variant-a', 'arena/test/variant-b'],
      logger: silentLogger
    });

    expect(plan.remoteReachable).toBe(false);
    expect(plan.toDelete).toHaveLength(0);
    expect(plan.toSkip).toHaveLength(2);
    expect(plan.toSkip[0]?.reason).toMatch(/remote.*unreachable/i);
  });

  it('deletes accepted branches (remote branch ref)', async () => {
    const remoteRefs = new Map([
      ['refs/heads/arena/test/variant-a', 'aaa111'],
      ['refs/heads/arena/test/variant-b', 'bbb222'],
      ['refs/heads/accept/test/variant-a', 'aaa111']
    ]);

    const repo = createMockRepo({
      listRemoteRefs: vi.fn().mockResolvedValue(remoteRefs),
      refExists: vi.fn().mockResolvedValue(false)
    });

    const plan = await planRemoteCleanup({
      repository: repo,
      gitRoot: '/repo',
      arenaName: 'test',
      branches: ['arena/test/variant-a', 'arena/test/variant-b'],
      logger: silentLogger
    });

    expect(plan.toDelete).toContain('arena/test/variant-a');
    expect(plan.toDelete).toContain('arena/test/variant-b');
    expect(plan.toSkip).not.toContainEqual(
      expect.objectContaining({ branch: 'arena/test/variant-a' })
    );
  });

  it('deletes accepted branches (remote tag ref)', async () => {
    const remoteRefs = new Map([
      ['refs/heads/arena/test/variant-a', 'aaa111'],
      ['refs/tags/accept/test/variant-a', 'aaa111']
    ]);

    const repo = createMockRepo({
      listRemoteRefs: vi.fn().mockResolvedValue(remoteRefs),
      refExists: vi.fn().mockResolvedValue(false)
    });

    const plan = await planRemoteCleanup({
      repository: repo,
      gitRoot: '/repo',
      arenaName: 'test',
      branches: ['arena/test/variant-a'],
      logger: silentLogger
    });

    expect(plan.toDelete).toContain('arena/test/variant-a');
    expect(plan.toSkip).not.toContainEqual(
      expect.objectContaining({ branch: 'arena/test/variant-a' })
    );
  });

  it('skips accepted branches when accept ref is local-only (branch)', async () => {
    const remoteRefs = new Map([
      ['refs/heads/arena/test/variant-a', 'aaa111']
    ]);

    const repo = createMockRepo({
      listRemoteRefs: vi.fn().mockResolvedValue(remoteRefs),
      refExists: vi.fn((_path: string, ref: string) => {
        return Promise.resolve(ref === 'refs/heads/accept/test/variant-a');
      })
    });

    const plan = await planRemoteCleanup({
      repository: repo,
      gitRoot: '/repo',
      arenaName: 'test',
      branches: ['arena/test/variant-a'],
      logger: silentLogger
    });

    expect(plan.toDelete).not.toContain('arena/test/variant-a');
    expect(plan.toSkip).toContainEqual(
      expect.objectContaining({ branch: 'arena/test/variant-a', reason: expect.stringMatching(/not yet on remote/) })
    );
  });

  it('skips accepted branches when accept tag is local-only', async () => {
    const remoteRefs = new Map([
      ['refs/heads/arena/test/variant-a', 'aaa111']
    ]);

    const repo = createMockRepo({
      listRemoteRefs: vi.fn().mockResolvedValue(remoteRefs),
      refExists: vi.fn((_path: string, ref: string) => {
        return Promise.resolve(ref === 'refs/tags/accept/test/variant-a');
      })
    });

    const plan = await planRemoteCleanup({
      repository: repo,
      gitRoot: '/repo',
      arenaName: 'test',
      branches: ['arena/test/variant-a'],
      logger: silentLogger
    });

    expect(plan.toDelete).not.toContain('arena/test/variant-a');
    expect(plan.toSkip).toContainEqual(
      expect.objectContaining({ branch: 'arena/test/variant-a', reason: expect.stringMatching(/not yet on remote/) })
    );
  });

  it('deletes accepted branch when accept ref is local-only but merged into base', async () => {
    const remoteRefs = new Map([
      ['refs/heads/arena/test/variant-a', 'aaa111']
    ]);

    const repo = createMockRepo({
      listRemoteRefs: vi.fn().mockResolvedValue(remoteRefs),
      refExists: vi.fn((_path: string, ref: string) => {
        return Promise.resolve(ref === 'refs/heads/accept/test/variant-a');
      }),
      resolveBaseRef: vi.fn().mockResolvedValue('main'),
      isAncestorOf: vi.fn().mockResolvedValue(true)
    });

    const plan = await planRemoteCleanup({
      repository: repo,
      gitRoot: '/repo',
      arenaName: 'test',
      branches: ['arena/test/variant-a'],
      logger: silentLogger
    });

    expect(plan.toDelete).toContain('arena/test/variant-a');
    expect(plan.toSkip).not.toContainEqual(
      expect.objectContaining({ branch: 'arena/test/variant-a' })
    );
  });

  it('skips accepted branch when resolveBaseRef fails', async () => {
    const remoteRefs = new Map([
      ['refs/heads/arena/test/variant-a', 'aaa111']
    ]);

    const repo = createMockRepo({
      listRemoteRefs: vi.fn().mockResolvedValue(remoteRefs),
      refExists: vi.fn((_path: string, ref: string) => {
        return Promise.resolve(ref === 'refs/heads/accept/test/variant-a');
      }),
      resolveBaseRef: vi.fn().mockRejectedValue(new Error('no base ref'))
    });

    const plan = await planRemoteCleanup({
      repository: repo,
      gitRoot: '/repo',
      arenaName: 'test',
      branches: ['arena/test/variant-a'],
      logger: silentLogger
    });

    expect(plan.toDelete).not.toContain('arena/test/variant-a');
    expect(plan.toSkip).toContainEqual(
      expect.objectContaining({ branch: 'arena/test/variant-a', reason: expect.stringMatching(/not yet on remote/) })
    );
  });

  it('skips branches with open PRs (gh detection)', async () => {
    const remoteRefs = new Map([
      ['refs/heads/arena/test/variant-a', 'aaa111']
    ]);

    const repo = createMockRepo({
      listRemoteRefs: vi.fn().mockResolvedValue(remoteRefs),
      hasOpenPullRequest: vi.fn().mockResolvedValue(true),
      refExists: vi.fn().mockResolvedValue(false)
    });

    const plan = await planRemoteCleanup({
      repository: repo,
      gitRoot: '/repo',
      arenaName: 'test',
      branches: ['arena/test/variant-a'],
      logger: silentLogger
    });

    expect(plan.toSkip).toContainEqual(
      expect.objectContaining({ branch: 'arena/test/variant-a', reason: expect.stringMatching(/open pull request/i) })
    );
    expect(plan.toDelete).toHaveLength(0);
  });

  it('force mode deletes branches with open PRs and also deletes accepted', async () => {
    const remoteRefs = new Map([
      ['refs/heads/arena/test/variant-a', 'aaa111'],
      ['refs/heads/arena/test/variant-b', 'bbb222'],
      ['refs/heads/accept/test/variant-a', 'aaa111'],
      ['refs/pull/1/head', 'bbb222']
    ]);

    const repo = createMockRepo({
      listRemoteRefs: vi.fn().mockResolvedValue(remoteRefs),
      hasOpenPullRequest: vi.fn().mockResolvedValue(true),
      refExists: vi.fn().mockResolvedValue(false)
    });

    const plan = await planRemoteCleanup({
      repository: repo,
      gitRoot: '/repo',
      arenaName: 'test',
      branches: ['arena/test/variant-a', 'arena/test/variant-b'],
      force: true,
      logger: silentLogger
    });

    // accepted variant-a should be deleted (preserved via accept branch)
    expect(plan.toDelete).toContain('arena/test/variant-a');
    // variant-b has open PR but force mode → should be deleted
    expect(plan.toDelete).toContain('arena/test/variant-b');
    expect(plan.toSkip).toHaveLength(0);
  });



  it('preserves accepted branch with open PR in non-force mode', async () => {
    const remoteRefs = new Map([
      ['refs/heads/arena/test/variant-a', 'aaa111'],
      ['refs/heads/accept/test/variant-a', 'aaa111'],
      ['refs/pull/1/head', 'aaa111']
    ]);

    const repo = createMockRepo({
      listRemoteRefs: vi.fn().mockResolvedValue(remoteRefs),
      hasOpenPullRequest: vi.fn().mockResolvedValue(true),
      refExists: vi.fn().mockResolvedValue(false)
    });

    const plan = await planRemoteCleanup({
      repository: repo,
      gitRoot: '/repo',
      arenaName: 'test',
      branches: ['arena/test/variant-a'],
      logger: silentLogger
    });

    // Open PR takes priority — branch should be skipped even though accepted
    expect(plan.toSkip).toContainEqual(
      expect.objectContaining({ branch: 'arena/test/variant-a', reason: expect.stringMatching(/open pull request/) })
    );
    expect(plan.toDelete).not.toContain('arena/test/variant-a');
  });

  it('skips branches not present on remote', async () => {
    const remoteRefs = new Map([
      ['refs/heads/arena/test/variant-a', 'aaa111']
    ]);

    const repo = createMockRepo({
      listRemoteRefs: vi.fn().mockResolvedValue(remoteRefs),
      refExists: vi.fn().mockResolvedValue(false)
    });

    const plan = await planRemoteCleanup({
      repository: repo,
      gitRoot: '/repo',
      arenaName: 'test',
      branches: ['arena/test/variant-a', 'arena/test/variant-b'],
      logger: silentLogger
    });

    expect(plan.toSkip).toContainEqual(
      expect.objectContaining({ branch: 'arena/test/variant-b', reason: expect.stringMatching(/not found on remote/i) })
    );
    expect(plan.toDelete).toContain('arena/test/variant-a');
  });

  it('handles empty branch list', async () => {
    const repo = createMockRepo();

    const plan = await planRemoteCleanup({
      repository: repo,
      gitRoot: '/repo',
      arenaName: 'test',
      branches: [],
      logger: silentLogger
    });

    expect(plan.toDelete).toHaveLength(0);
    expect(plan.toSkip).toHaveLength(0);
  });

  it('uses custom remote name', async () => {
    const repo = createMockRepo();

    await planRemoteCleanup({
      repository: repo,
      gitRoot: '/repo',
      arenaName: 'test',
      branches: [],
      remote: 'upstream',
      logger: silentLogger
    });

    expect(vi.mocked(repo.isRemoteReachable)).toHaveBeenCalledWith('/repo', 'upstream');
  });

  it('performs upfront gh availability check', async () => {
    const remoteRefs = new Map([
      ['refs/heads/arena/test/variant-a', 'aaa111'],
      ['refs/heads/arena/test/variant-b', 'bbb222']
    ]);

    const repo = createMockRepo({
      listRemoteRefs: vi.fn().mockResolvedValue(remoteRefs),
      hasOpenPullRequest: vi.fn().mockResolvedValue(false),
      refExists: vi.fn().mockResolvedValue(false)
    });

    await planRemoteCleanup({
      repository: repo,
      gitRoot: '/repo',
      arenaName: 'test',
      branches: ['arena/test/variant-a', 'arena/test/variant-b'],
      logger: silentLogger
    });

    // hasOpenPullRequest should be called with the ghAvailable flag
    expect(vi.mocked(repo.hasOpenPullRequest)).toHaveBeenCalledTimes(2);
  });
});

// ── Execute phase tests ──

describe('executeRemoteCleanup', () => {
  it('deletes all branches in the plan', async () => {
    const repo = createMockRepo();

    const plan: RemoteCleanupPlan = {
      remoteReachable: true,
      remote: 'origin',
      toDelete: ['arena/test/variant-a', 'arena/test/variant-b'],
      toSkip: []
    };

    const result = await executeRemoteCleanup({
      repository: repo,
      gitRoot: '/repo',
      plan,
      logger: silentLogger
    });

    expect(result.deleted).toEqual(['arena/test/variant-a', 'arena/test/variant-b']);
    expect(result.errors).toHaveLength(0);
    expect(result.skipped).toEqual(plan.toSkip);
  });

  it('collects per-branch errors without stopping', async () => {
    const repo = createMockRepo({
      deleteRemoteBranch: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('permission denied'))
        .mockResolvedValueOnce(undefined)
    });

    const plan: RemoteCleanupPlan = {
      remoteReachable: true,
      remote: 'origin',
      toDelete: ['branch-a', 'branch-b', 'branch-c'],
      toSkip: []
    };

    const result = await executeRemoteCleanup({
      repository: repo,
      gitRoot: '/repo',
      plan,
      logger: silentLogger
    });

    expect(result.deleted).toEqual(['branch-a', 'branch-c']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.branch).toBe('branch-b');
    expect(result.errors[0]?.error).toContain('permission denied');
  });

  it('returns empty result when plan has nothing to delete', async () => {
    const repo = createMockRepo();

    const plan: RemoteCleanupPlan = {
      remoteReachable: true,
      remote: 'origin',
      toDelete: [],
      toSkip: [{ branch: 'arena/test/variant-a', reason: 'accepted' }]
    };

    const result = await executeRemoteCleanup({
      repository: repo,
      gitRoot: '/repo',
      plan,
      logger: silentLogger
    });

    expect(result.deleted).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.skipped).toEqual(plan.toSkip);
    expect(vi.mocked(repo.deleteRemoteBranch)).not.toHaveBeenCalled();
  });
});

// ── keepRemote bypass tests ──

describe('planRemoteCleanup with keepRemote', () => {
  it('returns empty plan when keepRemote is true', async () => {
    const repo = createMockRepo();

    const plan = await planRemoteCleanup({
      repository: repo,
      gitRoot: '/repo',
      arenaName: 'test',
      branches: ['arena/test/variant-a'],
      keepRemote: true,
      logger: silentLogger
    });

    expect(plan.toDelete).toHaveLength(0);
    expect(plan.toSkip).toHaveLength(0);
    expect(plan.remoteReachable).toBe(true);
    expect(vi.mocked(repo.isRemoteReachable)).not.toHaveBeenCalled();
  });
});

// ── Format function tests ──

describe('formatRemoteCleanupResult', () => {
  it('returns empty string for empty result', () => {
    const result: RemoteCleanupResult = {
      deleted: [],
      skipped: [],
      errors: []
    };
    const output = formatRemoteCleanupResult(result);
    expect(output).toBe('');
  });

  it('formats deleted branches only', () => {
    const result: RemoteCleanupResult = {
      deleted: ['arena/test/variant-a', 'arena/test/variant-b'],
      skipped: [],
      errors: []
    };
    const output = formatRemoteCleanupResult(result);
    expect(output).toContain('arena/test/variant-a');
    expect(output).toContain('arena/test/variant-b');
    expect(output).toMatch(/deleted/i);
  });

  it('formats skipped branches only', () => {
    const result: RemoteCleanupResult = {
      deleted: [],
      skipped: [
        { branch: 'arena/test/variant-a', reason: 'accepted' },
        { branch: 'arena/test/variant-b', reason: 'has open pull request' }
      ],
      errors: []
    };
    const output = formatRemoteCleanupResult(result);
    expect(output).toContain('arena/test/variant-a');
    expect(output).toContain('accepted');
    expect(output).toContain('arena/test/variant-b');
    expect(output).toContain('open pull request');
    expect(output).toMatch(/skipped/i);
  });

  it('formats errors only', () => {
    const result: RemoteCleanupResult = {
      deleted: [],
      skipped: [],
      errors: [{ branch: 'arena/test/variant-a', error: 'permission denied' }]
    };
    const output = formatRemoteCleanupResult(result);
    expect(output).toContain('arena/test/variant-a');
    expect(output).toContain('permission denied');
    expect(output).toMatch(/error|failed/i);
  });

  it('formats mixed result', () => {
    const result: RemoteCleanupResult = {
      deleted: ['arena/test/variant-a'],
      skipped: [{ branch: 'arena/test/variant-b', reason: 'accepted' }],
      errors: [{ branch: 'arena/test/variant-c', error: 'network error' }]
    };
    const output = formatRemoteCleanupResult(result);
    expect(output).toContain('arena/test/variant-a');
    expect(output).toContain('arena/test/variant-b');
    expect(output).toContain('arena/test/variant-c');
  });
});
