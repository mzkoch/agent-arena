import type { Logger } from '../domain/types';
import type { GitRepositoryManager } from './repository';

export interface RemoteCleanupPlan {
  remoteReachable: boolean;
  remote: string;
  toDelete: string[];
  toSkip: Array<{ branch: string; reason: string }>;
}

export interface RemoteCleanupResult {
  deleted: string[];
  skipped: Array<{ branch: string; reason: string }>;
  errors: Array<{ branch: string; error: string }>;
}

export interface PlanRemoteCleanupOptions {
  repository: GitRepositoryManager;
  gitRoot: string;
  arenaName: string;
  branches: string[];
  remote?: string;
  force?: boolean;
  keepRemote?: boolean;
  logger: Logger;
}

export interface ExecuteRemoteCleanupOptions {
  repository: GitRepositoryManager;
  gitRoot: string;
  plan: RemoteCleanupPlan;
  logger: Logger;
}

const extractVariantName = (branch: string, arenaName: string): string => {
  const prefix = `arena/${arenaName}/`;
  if (branch.startsWith(prefix)) {
    return branch.slice(prefix.length);
  }
  return branch;
};

const isAcceptedRemotely = (
  arenaName: string,
  variantName: string,
  remoteRefs: Map<string, string>
): boolean => {
  const acceptBranch = `accept/${arenaName}/${variantName}`;
  return remoteRefs.has(`refs/heads/${acceptBranch}`) || remoteRefs.has(`refs/tags/${acceptBranch}`);
};

const isAcceptedLocally = async (
  repository: GitRepositoryManager,
  gitRoot: string,
  arenaName: string,
  variantName: string
): Promise<boolean> => {
  const acceptBranch = `accept/${arenaName}/${variantName}`;
  if (await repository.refExists(gitRoot, `refs/heads/${acceptBranch}`)) return true;
  if (await repository.refExists(gitRoot, `refs/tags/${acceptBranch}`)) return true;
  return false;
};



/**
 * Plan phase: classify branches into delete/skip lists without performing any mutations.
 */
export const planRemoteCleanup = async (
  options: PlanRemoteCleanupOptions
): Promise<RemoteCleanupPlan> => {
  const {
    repository,
    gitRoot,
    arenaName,
    branches,
    remote = 'origin',
    force = false,
    keepRemote = false,
    logger
  } = options;

  if (keepRemote) {
    return { remoteReachable: true, remote, toDelete: [], toSkip: [] };
  }

  const reachable = await repository.isRemoteReachable(gitRoot, remote);
  if (!reachable) {
    logger.warn('Remote is unreachable, skipping remote branch cleanup', { remote });
    return {
      remoteReachable: false,
      remote,
      toDelete: [],
      toSkip: branches.map((branch) => ({
        branch,
        reason: 'remote unreachable'
      }))
    };
  }

  // Single ls-remote call for all needed refs
  let remoteRefs: Map<string, string>;
  try {
    remoteRefs = await repository.listRemoteRefs(gitRoot, remote, [
      `refs/pull/*/head`,
      `refs/heads/arena/${arenaName}/*`,
      `refs/heads/accept/${arenaName}/*`,
      `refs/tags/accept/${arenaName}/*`
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('Failed to list remote refs, skipping remote branch cleanup', { remote, error: message });
    return {
      remoteReachable: false,
      remote,
      toDelete: [],
      toSkip: branches.map((branch) => ({
        branch,
        reason: 'failed to list remote refs'
      }))
    };
  }

  // Upfront gh availability check (single call before the branch loop)
  let ghAvailable = false;
  if (!force) {
    ghAvailable = await repository.isGhAvailable(gitRoot);
  }

  const toDelete: string[] = [];
  const toSkip: Array<{ branch: string; reason: string }> = [];

  for (const branch of branches) {
    const variantName = extractVariantName(branch, arenaName);

    // Check if branch exists on remote
    if (!remoteRefs.has(`refs/heads/${branch}`)) {
      toSkip.push({ branch, reason: 'not found on remote' });
      continue;
    }

    // Check for open PRs (skip in non-force mode)
    if (!force) {
      const hasPR = await repository.hasOpenPullRequest(
        gitRoot,
        branch,
        remoteRefs,
        ghAvailable
      );
      if (hasPR) {
        toSkip.push({ branch, reason: 'has open pull request' });
        continue;
      }
    }

    // Accepted variant: delete arena/* branch only when accept ref exists on remote
    if (isAcceptedRemotely(arenaName, variantName, remoteRefs)) {
      logger.info('Accepted variant arena branch will be deleted (preserved via accept branch)', { branch });
      toDelete.push(branch);
      continue;
    }

    // Accepted locally only: check if the accept branch was already merged into base
    if (await isAcceptedLocally(repository, gitRoot, arenaName, variantName)) {
      const acceptBranch = `accept/${arenaName}/${variantName}`;
      let merged = false;
      try {
        const baseRef = await repository.resolveBaseRef(gitRoot);
        merged = await repository.isAncestorOf(gitRoot, acceptBranch, baseRef);
      } catch {
        // If we can't resolve base ref, fall through to skip
      }
      if (merged) {
        logger.info('Accepted variant arena branch will be deleted (accept branch merged into base)', { branch });
        toDelete.push(branch);
      } else {
        toSkip.push({ branch, reason: 'accepted (accept branch not yet on remote)' });
      }
      continue;
    }

    toDelete.push(branch);
  }

  logger.info('Remote cleanup plan', {
    remote,
    toDelete: toDelete.length,
    toSkip: toSkip.length
  });

  return { remoteReachable: true, remote, toDelete, toSkip };
};

/**
 * Execute phase: perform branch deletions based on the plan, collecting errors per-branch.
 */
export const executeRemoteCleanup = async (
  options: ExecuteRemoteCleanupOptions
): Promise<RemoteCleanupResult> => {
  const { repository, gitRoot, plan, logger } = options;

  const deleted: string[] = [];
  const errors: Array<{ branch: string; error: string }> = [];

  for (const branch of plan.toDelete) {
    try {
      await repository.deleteRemoteBranch(gitRoot, branch, plan.remote);
      deleted.push(branch);
      logger.info('Deleted remote branch', { branch, remote: plan.remote });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ branch, error: message });
      logger.error('Failed to delete remote branch', { branch, error: message });
    }
  }

  return { deleted, skipped: plan.toSkip, errors };
};

/**
 * Format a RemoteCleanupResult into a human-readable string for CLI output.
 */
export const formatRemoteCleanupResult = (result: RemoteCleanupResult): string => {
  const lines: string[] = [];

  if (result.deleted.length === 0 && result.skipped.length === 0 && result.errors.length === 0) {
    return '';
  }

  if (result.deleted.length > 0) {
    lines.push('Remote branches deleted:');
    for (const branch of result.deleted) {
      lines.push(`  ✓ ${branch}`);
    }
  }

  if (result.skipped.length > 0) {
    lines.push('Remote branches skipped:');
    for (const entry of result.skipped) {
      lines.push(`  - ${entry.branch} (${entry.reason})`);
    }
  }

  if (result.errors.length > 0) {
    lines.push('Remote branch deletion errors:');
    for (const entry of result.errors) {
      lines.push(`  ✗ ${entry.branch}: ${entry.error}`);
    }
  }

  return lines.join('\n');
};
