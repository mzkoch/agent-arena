import { access, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ArenaPaths, Logger, VariantConfig, VariantWorkspace } from '../domain/types';
import { ensureDir, writeTextFile } from '../utils/files';
import type { CommandRunner } from './command-runner';

const exists = async (value: string): Promise<boolean> => {
  try {
    await access(value);
    return true;
  } catch {
    return false;
  }
};

const gitArgs = (repoPath: string, args: string[]): string[] => ['-C', repoPath, ...args];

const ensureSuccess = async (
  runner: CommandRunner,
  repoPath: string,
  args: string[],
  errorMessage: string
): Promise<string> => {
  const result = await runner.run('git', gitArgs(repoPath, args));
  if (result.exitCode !== 0) {
    throw new Error(`${errorMessage}: ${result.stderr || result.stdout}`.trim());
  }

  return result.stdout;
};

const branchExists = async (
  runner: CommandRunner,
  repoPath: string,
  branch: string
): Promise<boolean> => {
  const result = await runner.run('git', gitArgs(repoPath, ['rev-parse', '--verify', `refs/heads/${branch}`]));
  return result.exitCode === 0;
};

const hasCommit = async (runner: CommandRunner, repoPath: string): Promise<boolean> => {
  const result = await runner.run('git', gitArgs(repoPath, ['rev-parse', '--verify', 'HEAD']));
  return result.exitCode === 0;
};

export interface WorktreeInfo {
  path: string;
  branch: string;
}

export interface BranchSafetyIssue {
  branch: string;
  reasons: string[];
}

export class GitRepositoryManager {
  public constructor(
    private readonly runner: CommandRunner,
    private readonly logger: Logger
  ) {}

  public async verifyRepo(gitRoot: string): Promise<void> {
    if (!(await exists(path.join(gitRoot, '.git')))) {
      throw new Error(
        `No git repository found at ${gitRoot}. Arena requires an existing git repository.`
      );
    }

    if (!(await hasCommit(this.runner, gitRoot))) {
      this.logger.info('No commits found, creating initial commit', { gitRoot });
      await ensureSuccess(
        this.runner,
        gitRoot,
        [
          '-c',
          'user.name=Agent Arena',
          '-c',
          'user.email=arena@example.com',
          'commit',
          '--allow-empty',
          '-m',
          'Initial commit'
        ],
        'Failed to create initial commit'
      );
    }

    this.logger.info('Verified git repository', { gitRoot });
  }

  public async createWorktree(
    gitRoot: string,
    branch: string,
    worktreePath: string
  ): Promise<void> {
    if (await exists(path.join(worktreePath, '.git'))) {
      return;
    }

    await ensureDir(path.dirname(worktreePath));

    const args = ['worktree', 'add'];
    if (!(await branchExists(this.runner, gitRoot, branch))) {
      args.push('-b', branch, worktreePath);
    } else {
      args.push(worktreePath, branch);
    }

    await ensureSuccess(
      this.runner,
      gitRoot,
      args,
      `Failed to create worktree ${worktreePath}`
    );
  }

  public async removeWorktree(gitRoot: string, worktreePath: string): Promise<void> {
    await ensureSuccess(
      this.runner,
      gitRoot,
      ['worktree', 'remove', '--force', worktreePath],
      `Failed to remove worktree ${worktreePath}`
    );
  }

  public async pruneWorktrees(gitRoot: string): Promise<void> {
    await ensureSuccess(this.runner, gitRoot, ['worktree', 'prune'], 'Failed to prune worktrees');
  }

  public async listWorktrees(gitRoot: string): Promise<WorktreeInfo[]> {
    const stdout = await ensureSuccess(
      this.runner,
      gitRoot,
      ['worktree', 'list', '--porcelain'],
      'Failed to list worktrees'
    );

    const worktrees: WorktreeInfo[] = [];
    let currentPath: string | undefined;
    let currentBranch: string | undefined;

    for (const line of stdout.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) {
        currentPath = line.replace('worktree ', '').trim();
      } else if (line.startsWith('branch ')) {
        currentBranch = line.replace('branch refs/heads/', '').trim();
      } else if (line === '' && currentPath && currentBranch) {
        worktrees.push({ path: currentPath, branch: currentBranch });
        currentPath = undefined;
        currentBranch = undefined;
      }
    }

    if (currentPath && currentBranch) {
      worktrees.push({ path: currentPath, branch: currentBranch });
    }

    return Promise.all(
      worktrees.map(async (wt) => ({
        ...wt,
        path: await realpath(wt.path)
      }))
    );
  }

  public async writeVariantFiles(
    workspace: VariantWorkspace,
    requirementsContent: string,
    instructionsContent: string
  ): Promise<void> {
    const arenaDir = path.join(workspace.worktreePath, '.arena');
    await ensureDir(arenaDir);
    await writeTextFile(path.join(arenaDir, 'REQUIREMENTS.md'), requirementsContent);
    await writeTextFile(path.join(arenaDir, 'ARENA-INSTRUCTIONS.md'), instructionsContent);
  }

  public async ensureWorktreeGitignore(worktreePath: string): Promise<void> {
    await this.ensureGitignoreEntry(worktreePath, '.arena/');
  }

  public async deleteBranch(gitRoot: string, branch: string): Promise<void> {
    if (await branchExists(this.runner, gitRoot, branch)) {
      await ensureSuccess(
        this.runner,
        gitRoot,
        ['branch', '-D', branch],
        `Failed to delete branch ${branch}`
      );
    }
  }

  public async createBranchFrom(
    gitRoot: string,
    newBranch: string,
    sourceBranch: string
  ): Promise<void> {
    await ensureSuccess(
      this.runner,
      gitRoot,
      ['branch', newBranch, sourceBranch],
      `Failed to create branch ${newBranch} from ${sourceBranch}`
    );
  }

  public async hasCommitsAheadOf(
    gitRoot: string,
    branch: string,
    baseBranch: string
  ): Promise<boolean> {
    const count = await this.getCommitsAheadCount(gitRoot, branch, baseBranch);
    return count !== 0; // -1 (failed comparison) treated as potentially ahead for safety
  }

  public async getCommitsAheadCount(
    gitRoot: string,
    branch: string,
    baseBranch: string
  ): Promise<number> {
    if (!(await branchExists(this.runner, gitRoot, branch))) {
      return 0;
    }
    const result = await this.runner.run(
      'git',
      gitArgs(gitRoot, ['rev-list', '--count', `${baseBranch}..${branch}`])
    );
    if (result.exitCode !== 0) {
      return -1;
    }
    const count = parseInt(result.stdout.trim(), 10);
    return Number.isNaN(count) ? -1 : count;
  }

  public async getBranchSafetyIssues(
    gitRoot: string,
    branches: string[],
    baseBranch: string
  ): Promise<BranchSafetyIssue[]> {
    const worktrees = await this.listWorktrees(gitRoot);
    const issues: BranchSafetyIssue[] = [];

    for (const branch of branches) {
      if (!(await branchExists(this.runner, gitRoot, branch))) {
        continue;
      }

      const reasons: string[] = [];

      const aheadOfBase = await this.getCommitsAheadCount(gitRoot, branch, baseBranch);
      if (aheadOfBase < 0) {
        reasons.push(`unable to compare against ${baseBranch} (comparison failed)`);
      } else if (aheadOfBase > 0) {
        reasons.push(`${aheadOfBase} commit(s) ahead of ${baseBranch}`);
      }

      const upstreamResult = await this.runner.run(
        'git',
        gitArgs(gitRoot, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`])
      );
      if (upstreamResult.exitCode === 0) {
        const upstream = upstreamResult.stdout.trim();
        const aheadOfUpstream = await this.getCommitsAheadCount(gitRoot, branch, upstream);
        if (aheadOfUpstream < 0) {
          reasons.push('unable to compare against upstream (comparison failed)');
        } else if (aheadOfUpstream > 0) {
          reasons.push(`${aheadOfUpstream} unpushed commit(s)`);
        }
      }

      const worktree = worktrees.find((entry) => entry.branch === branch);
      if (worktree) {
        const statusResult = await this.runner.run(
          'git',
          gitArgs(worktree.path, ['status', '--porcelain'])
        );
        if (statusResult.exitCode === 0 && statusResult.stdout.trim().length > 0) {
          reasons.push('uncommitted changes in worktree');
        }
      }

      if (reasons.length > 0) {
        issues.push({ branch, reasons });
      }
    }

    return issues;
  }

  public async getDefaultBranch(gitRoot: string): Promise<string> {
    const result = await this.runner.run(
      'git',
      gitArgs(gitRoot, ['symbolic-ref', '--short', 'HEAD'])
    );
    if (result.exitCode === 0) {
      return result.stdout.trim();
    }
    return 'main';
  }

  public async branchExists(gitRoot: string, branch: string): Promise<boolean> {
    return branchExists(this.runner, gitRoot, branch);
  }

  public async clean(gitRoot: string, branches?: string[]): Promise<void> {
    const worktrees = await this.listWorktrees(gitRoot);
    const gitRootReal = await realpath(gitRoot);
    const arenaWorktreeDir = path.join(gitRootReal, '.arena', 'worktrees');

    for (const worktree of worktrees) {
      const worktreeReal = await realpath(worktree.path);
      const isArenaManaged =
        worktreeReal.startsWith(`${arenaWorktreeDir}${path.sep}`) ||
        worktree.branch.startsWith('arena/');

      if (worktreeReal !== gitRootReal && isArenaManaged) {
        await this.removeWorktree(gitRoot, worktree.path);
      }
    }

    await this.pruneWorktrees(gitRoot);

    if (branches) {
      for (const branch of branches) {
        await this.deleteBranch(gitRoot, branch);
      }
    }
  }

  public async ensureGitignoreEntry(gitRoot: string, entry: string): Promise<void> {
    const gitignorePath = path.join(gitRoot, '.gitignore');

    let content = '';
    if (await exists(gitignorePath)) {
      content = await readFile(gitignorePath, 'utf8');
      const lines = content.split(/\r?\n/);
      if (lines.some((line) => line.trim() === entry)) {
        return;
      }
    }

    const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    const prefix = content.length > 0 ? `${separator}\n# Arena\n` : '# Arena\n';
    await writeTextFile(gitignorePath, `${content}${prefix}${entry}\n`);
  }

  public async refExists(repoPath: string, ref: string): Promise<boolean> {
    const result = await this.runner.run('git', gitArgs(repoPath, ['rev-parse', '--verify', ref]));
    return result.exitCode === 0;
  }

  public async resolveBaseRef(repoPath: string): Promise<string> {
    const candidates = ['main', 'origin/main', 'master', 'origin/master'];
    for (const candidate of candidates) {
      if (await this.refExists(repoPath, candidate)) {
        return candidate;
      }
    }

    const originHead = await this.runner.run(
      'git',
      gitArgs(repoPath, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])
    );
    if (originHead.exitCode === 0) {
      const resolved = originHead.stdout.trim().replace(/^refs\/remotes\//u, '');
      if (resolved.length > 0 && (await this.refExists(repoPath, resolved))) {
        return resolved;
      }
    }

    throw new Error(
      'Unable to determine an evaluation base ref. Expected one of: main, origin/main, master, origin/master, or origin/HEAD.'
    );
  }

  public async listTreeFiles(repoPath: string, ref: string): Promise<Set<string>> {
    const stdout = await ensureSuccess(
      this.runner,
      repoPath,
      ['ls-tree', '-r', '--name-only', ref],
      `Failed to list files for ${ref}`
    );
    return new Set(
      stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    );
  }

  public async getChangedFiles(repoPath: string, baseRef: string): Promise<string[]> {
    const stdout = await ensureSuccess(
      this.runner,
      repoPath,
      ['diff', '--name-only', '--find-renames', baseRef, '--'],
      `Failed to list changed files in ${repoPath}`
    );
    return stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  public async getDiffNumStatRaw(repoPath: string, baseRef: string): Promise<string> {
    return ensureSuccess(
      this.runner,
      repoPath,
      ['diff', '--numstat', '--find-renames', baseRef, '--'],
      `Failed to collect line stats in ${repoPath}`
    );
  }

  public async getUntrackedFiles(repoPath: string): Promise<string[]> {
    const stdout = await ensureSuccess(
      this.runner,
      repoPath,
      ['ls-files', '--others', '--exclude-standard'],
      `Failed to list untracked files in ${repoPath}`
    );
    return stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  public async getCommitCountSinceRef(repoPath: string, baseRef: string): Promise<number> {
    const stdout = await ensureSuccess(
      this.runner,
      repoPath,
      ['rev-list', '--count', `${baseRef}..HEAD`],
      `Failed to count commits since ${baseRef}`
    );
    const count = Number.parseInt(stdout.trim(), 10);
    return Number.isNaN(count) ? 0 : count;
  }
}

export const buildVariantWorkspaces = (
  paths: ArenaPaths,
  variants: VariantConfig[]
): VariantWorkspace[] =>
  variants.map((variant) => ({
    variant,
    worktreePath: path.join(paths.worktreeDir, variant.name)
  }));

export const countFilesRecursively = async (directoryPath: string): Promise<number> => {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    if (entry.name === '.git') {
      continue;
    }
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      count += await countFilesRecursively(entryPath);
    } else {
      count += 1;
    }
  }

  return count;
};
