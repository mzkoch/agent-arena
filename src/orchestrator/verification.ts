import type { CompletionVerificationConfig } from '../domain/types';
import type { CommandRunner } from '../git/command-runner';

/** Subset of GitRepositoryManager used by verification. */
export interface VerificationGitOps {
  resolveBaseRef(repoPath: string): Promise<string>;
  getCommitCountSinceRef(repoPath: string, baseRef: string): Promise<number>;
}

export interface VerificationCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface VerificationResult {
  passed: boolean;
  issues: string[];
  baseRef?: string | undefined;
  commitCount?: number | undefined;
  commandResult?: VerificationCommandResult | undefined;
}

/**
 * Verify that an agent's workspace meets completion criteria.
 *
 * Checks (in order, when enabled):
 * 1. Commit count ahead of base ref
 * 2. No uncommitted changes (clean worktree)
 * 3. Optional validation command passes
 */
export const verifyWorkspaceCompletion = async (
  worktreePath: string,
  config: CompletionVerificationConfig,
  gitOps: VerificationGitOps,
  commandRunner: CommandRunner
): Promise<VerificationResult> => {
  const issues: string[] = [];
  let baseRef: string | undefined;
  let commitCount: number | undefined;
  let commandResult: VerificationCommandResult | undefined;

  // Resolve base ref for commit checks
  try {
    baseRef = await gitOps.resolveBaseRef(worktreePath);
  } catch {
    // If we can't resolve base ref and commits are required, that's an issue
    if (config.requireCommit) {
      issues.push('Unable to determine base ref for commit verification.');
      return { passed: false, issues, baseRef, commitCount, commandResult };
    }
  }

  // Check commit count ahead of base ref
  if (config.requireCommit && baseRef) {
    commitCount = await gitOps.getCommitCountSinceRef(worktreePath, baseRef);
    if (commitCount === 0) {
      issues.push(`No commits ahead of ${baseRef}. Commit your work.`);
    }
  }

  // Check for uncommitted changes
  if (config.requireCleanWorktree) {
    const hasUncommitted = await checkUncommittedChanges(worktreePath, commandRunner);
    if (hasUncommitted) {
      issues.push('Uncommitted changes detected. Commit or stash all changes.');
    }
  }

  // Run optional validation command
  if (config.command) {
    const result = await commandRunner.run(
      config.command.command,
      config.command.args,
      { cwd: worktreePath, timeoutMs: config.command.timeoutMs }
    );
    commandResult = {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut
    };
    if (result.timedOut) {
      issues.push(`Validation command timed out after ${config.command.timeoutMs}ms.`);
    } else if (result.exitCode !== 0) {
      const output = (result.stderr || result.stdout).trim();
      const detail = output.length > 0 ? `: ${output.slice(0, 500)}` : '';
      issues.push(`Validation command failed with exit code ${result.exitCode}${detail}`);
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    baseRef,
    commitCount,
    commandResult
  };
};

async function checkUncommittedChanges(
  worktreePath: string,
  commandRunner: CommandRunner
): Promise<boolean> {
  const result = await commandRunner.run('git', ['-C', worktreePath, 'status', '--porcelain']);
  if (result.exitCode !== 0) {
    return true; // Treat git failure as dirty — fail closed
  }
  return result.stdout.trim().length > 0;
}
