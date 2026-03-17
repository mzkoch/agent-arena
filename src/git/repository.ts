import { access, readdir, realpath } from 'node:fs/promises';
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

export class GitRepositoryManager {
  public constructor(
    private readonly runner: CommandRunner,
    private readonly logger: Logger
  ) {}

  public async initRepo(repoPath: string): Promise<void> {
    await ensureDir(repoPath);
    if (!(await exists(path.join(repoPath, '.git')))) {
      const result = await this.runner.run('git', ['init', repoPath]);
      if (result.exitCode !== 0) {
        throw new Error(`Failed to initialize git repository at ${repoPath}: ${result.stderr || result.stdout}`.trim());
      }
      this.logger.info('Initialized git repository', { repoPath });
    }

    if (!(await hasCommit(this.runner, repoPath))) {
      await ensureSuccess(
        this.runner,
        repoPath,
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
  }

  public async createWorktree(
    repoPath: string,
    branch: string,
    worktreePath: string
  ): Promise<void> {
    if (await exists(path.join(worktreePath, '.git'))) {
      return;
    }

    const args = ['worktree', 'add'];
    if (!(await branchExists(this.runner, repoPath, branch))) {
      args.push('-b', branch, worktreePath);
    } else {
      args.push(worktreePath, branch);
    }

    await ensureSuccess(
      this.runner,
      repoPath,
      args,
      `Failed to create worktree ${worktreePath}`
    );
  }

  public async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    await ensureSuccess(
      this.runner,
      repoPath,
      ['worktree', 'remove', '--force', worktreePath],
      `Failed to remove worktree ${worktreePath}`
    );
  }

  public async pruneWorktrees(repoPath: string): Promise<void> {
    await ensureSuccess(this.runner, repoPath, ['worktree', 'prune'], 'Failed to prune worktrees');
  }

  public async listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
    const stdout = await ensureSuccess(
      this.runner,
      repoPath,
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

    return worktrees;
  }

  public async writeVariantFiles(
    workspace: VariantWorkspace,
    requirementsContent: string,
    instructionsContent: string
  ): Promise<void> {
    await writeTextFile(path.join(workspace.worktreePath, 'REQUIREMENTS.md'), requirementsContent);
    await writeTextFile(
      path.join(workspace.worktreePath, 'ARENA-INSTRUCTIONS.md'),
      instructionsContent
    );
  }

  public async clean(repoPath: string): Promise<void> {
    const worktrees = await this.listWorktrees(repoPath);
    const repoRealPath = await realpath(repoPath);

    for (const worktree of worktrees) {
      if ((await realpath(worktree.path)) !== repoRealPath) {
        await this.removeWorktree(repoPath, worktree.path);
      }
    }

    await this.pruneWorktrees(repoPath);
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
