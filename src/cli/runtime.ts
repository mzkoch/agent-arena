import { access, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { ArenaConfig, ArenaPaths, ArenaSessionFile, Logger, VariantWorkspace } from '../domain/types';
import { findGitRoot, resolveArenaPaths, resolveArenaName, loadArenaConfig, listArenaNames } from '../config/load';
import { readTextFile } from '../utils/files';
import { buildArenaInstructions } from '../prompt/builder';
import { ProviderRegistry } from '../providers/registry';
import { NodeCommandRunner } from '../git/command-runner';
import { GitRepositoryManager, buildVariantWorkspaces } from '../git/repository';
import { ArenaProject } from '../project/arena-project';
import { readSessionFile } from '../ipc/session-file';

const exists = async (value: string): Promise<boolean> => {
  try {
    await access(value);
    return true;
  } catch {
    return false;
  }
};

export interface ArenaRuntimeContext {
  config: ArenaConfig;
  paths: ArenaPaths;
  workspaces: VariantWorkspace[];
  requirementsContent: string;
  repository: GitRepositoryManager;
}

export const loadRuntimeContext = async (
  arenaName: string | undefined,
  logger: Logger
): Promise<ArenaRuntimeContext> => {
  const gitRoot = await findGitRoot();
  const name = await resolveArenaName(gitRoot, arenaName);
  const paths = resolveArenaPaths(gitRoot, name);
  const config = await loadArenaConfig(paths.configPath, name, { gitRoot });
  const requirementsContent = await readTextFile(paths.requirementsPath);
  const repository = new GitRepositoryManager(new NodeCommandRunner(), logger);
  const workspaces = buildVariantWorkspaces(paths, config.variants);

  return {
    config,
    paths,
    workspaces,
    requirementsContent,
    repository
  };
};

/** Validate arena name: lowercase alphanumeric + hyphens, no path traversal, max 64 chars. */
export const validateArenaName = (name: string): void => {
  if (name.length === 0) {
    throw new Error('Arena name must not be empty.');
  }
  if (name.length > 64) {
    throw new Error(`Arena name must be at most 64 characters, got ${name.length}.`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new Error(
      `Arena name "${name}" is invalid. Must be lowercase alphanumeric with hyphens, starting with a letter or digit.`
    );
  }
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new Error(`Arena name "${name}" contains invalid path characters.`);
  }
};

/**
 * One-time project setup: create `.arena/` directory and add `.arena/` to `.gitignore`.
 * Idempotent — safe to run multiple times.
 */
export const projectInit = async (
  gitRoot: string,
  logger: Logger
): Promise<void> => {
  const repository = new GitRepositoryManager(new NodeCommandRunner(), logger);
  await repository.verifyRepo(gitRoot);
  await repository.ensureGitignoreEntry(gitRoot, '.arena/');
  const { ensureDir } = await import('../utils/files');
  await ensureDir(path.join(gitRoot, '.arena'));
  logger.info('Initialized arena project', { gitRoot });
};

export interface CreateOptions {
  configSource?: string | undefined;
  requirementsSource?: string | undefined;
}

/**
 * Create a new named arena. Scaffolds `.arena/<name>/` with config and requirements templates.
 */
export const createArena = async (
  gitRoot: string,
  arenaName: string,
  options: CreateOptions,
  logger: Logger
): Promise<ArenaProject> => {
  validateArenaName(arenaName);

  const arenaDir = path.join(gitRoot, '.arena', arenaName);
  if (await exists(arenaDir)) {
    throw new Error(`Arena "${arenaName}" already exists at ${arenaDir}.`);
  }

  // Ensure project-level setup
  await projectInit(gitRoot, logger);

  const hasBothSources = Boolean(options.configSource) && Boolean(options.requirementsSource);
  const hasEitherSource = Boolean(options.configSource) || Boolean(options.requirementsSource);

  if (hasEitherSource && !hasBothSources) {
    throw new Error(
      'Both --config and --requirements must be provided together, or omit both to scaffold a new arena.'
    );
  }

  let project: ArenaProject;
  if (hasBothSources) {
    project = await ArenaProject.create(
      gitRoot,
      options.configSource!,
      options.requirementsSource!,
      arenaName
    );
  } else {
    project = await ArenaProject.scaffold(gitRoot, arenaName);
  }

  logger.info('Created arena', { arenaName, arenaDir });
  return project;
};

/**
 * Set up worktrees for launch: create worktrees, write variant files into `.arena/` subdir,
 * add `.arena/` to each worktree's `.gitignore`.
 */
export const setupWorkspacesForLaunch = async (
  context: ArenaRuntimeContext
): Promise<void> => {
  const { config, paths, workspaces, requirementsContent, repository } = context;
  const registry = new ProviderRegistry(config.providers);

  for (const workspace of workspaces) {
    await repository.createWorktree(
      paths.gitRoot,
      workspace.variant.branch,
      workspace.worktreePath
    );
    const provider = registry.get(workspace.variant.provider);
    await repository.writeVariantFiles(
      workspace,
      requirementsContent,
      buildArenaInstructions(workspace.variant, provider.completionProtocol)
    );
    await repository.ensureWorktreeGitignore(workspace.worktreePath);
  }
};

export type ArenaStatus = 'created' | 'running' | 'completed' | 'unknown';

export interface ArenaListEntry {
  name: string;
  status: ArenaStatus;
  variantCount: number;
}

/**
 * List all arenas and their status.
 */
export const listArenas = async (
  gitRoot: string,
  logger: Logger
): Promise<ArenaListEntry[]> => {
  const names = await listArenaNames(gitRoot);
  logger.debug('Found arenas', { count: names.length, names });
  const entries: ArenaListEntry[] = [];

  for (const name of names) {
    const paths = resolveArenaPaths(gitRoot, name);
    let status: ArenaStatus = 'created';
    let variantCount = 0;

    try {
      const config = await loadArenaConfig(paths.configPath, name, { gitRoot, skipModelValidation: true });
      variantCount = config.variants.length;
    } catch {
      // Config may be invalid template — still show it
    }

    if (await exists(paths.sessionFilePath)) {
      try {
        const session = await readSessionFile(paths.sessionFilePath);
        if (session.pid) {
          status = 'running';
        }
      } catch {
        status = 'unknown';
      }
    } else if (await exists(paths.worktreeDir)) {
      // Worktrees exist but no session — check if launched before
      try {
        const entries = await readdir(paths.worktreeDir);
        if (entries.length > 0) {
          status = 'completed';
        }
      } catch {
        // worktreeDir may not exist
      }
    }

    entries.push({ name, status, variantCount });
  }

  return entries;
};

/**
 * Create a clean branch from a winning variant.
 */
export const acceptVariant = async (
  gitRoot: string,
  arenaName: string,
  variantName: string,
  logger: Logger
): Promise<string> => {
  const repository = new GitRepositoryManager(new NodeCommandRunner(), logger);
  const paths = resolveArenaPaths(gitRoot, arenaName);
  const config = await loadArenaConfig(paths.configPath, arenaName, { gitRoot });

  const variant = config.variants.find((v) => v.name === variantName);
  if (!variant) {
    const available = config.variants.map((v) => v.name).join(', ');
    throw new Error(`Variant "${variantName}" not found in arena "${arenaName}". Available: ${available}`);
  }

  if (!(await repository.branchExists(gitRoot, variant.branch))) {
    throw new Error(`Branch "${variant.branch}" does not exist. Has the arena been launched?`);
  }

  const defaultBranch = await repository.getDefaultBranch(gitRoot);
  const hasCommits = await repository.hasCommitsAheadOf(gitRoot, variant.branch, defaultBranch);
  if (!hasCommits) {
    throw new Error(`Variant "${variantName}" has no commits ahead of ${defaultBranch}.`);
  }

  const acceptBranch = `accept/${arenaName}/${variantName}`;
  if (await repository.branchExists(gitRoot, acceptBranch)) {
    throw new Error(`Accept branch "${acceptBranch}" already exists.`);
  }

  await repository.createBranchFrom(gitRoot, acceptBranch, variant.branch);
  return acceptBranch;
};

/**
 * Check for unmerged commits, unpushed commits, and uncommitted changes on variant branches.
 * Returns human-readable warnings for each branch with safety issues.
 */
export const checkUnmergedWork = async (
  gitRoot: string,
  config: ArenaConfig,
  logger: Logger
): Promise<string[]> => {
  const repository = new GitRepositoryManager(new NodeCommandRunner(), logger);
  const defaultBranch = await repository.getDefaultBranch(gitRoot);
  const branches = config.variants.map((v) => v.branch);
  const issues = await repository.getBranchSafetyIssues(gitRoot, branches, defaultBranch);

  return issues.map(
    (issue) => `Branch "${issue.branch}": ${issue.reasons.join(', ')}`
  );
};

// Legacy — kept for backward compatibility but no longer used by CLI
export interface InitOptions {
  configSource?: string | undefined;
  requirementsSource?: string | undefined;
  arenaName?: string | undefined;
}

export const initializeArena = async (
  gitRoot: string,
  options: InitOptions,
  logger: Logger
): Promise<ArenaRuntimeContext> => {
  const arenaName = options.arenaName ?? 'default';
  validateArenaName(arenaName);

  const repository = new GitRepositoryManager(new NodeCommandRunner(), logger);
  await repository.verifyRepo(gitRoot);

  const hasBothSources = Boolean(options.configSource) && Boolean(options.requirementsSource);
  const hasEitherSource = Boolean(options.configSource) || Boolean(options.requirementsSource);

  if (hasEitherSource && !hasBothSources) {
    throw new Error(
      'Both configSource and requirementsSource must be provided together, or omit both to scaffold a new arena.'
    );
  }

  let project: ArenaProject;
  if (hasBothSources) {
    project = await ArenaProject.create(
      gitRoot,
      options.configSource!,
      options.requirementsSource!,
      arenaName
    );
  } else {
    project = await ArenaProject.scaffold(gitRoot, arenaName);
  }

  await repository.ensureGitignoreEntry(gitRoot, '.arena/');

  const { config, paths } = project;
  const workspaces = project.workspaces;
  const requirementsContent = await project.readRequirements();

  const registry = new ProviderRegistry(config.providers);
  for (const workspace of workspaces) {
    await repository.createWorktree(
      gitRoot,
      workspace.variant.branch,
      workspace.worktreePath
    );
    const provider = registry.get(workspace.variant.provider);
    await repository.writeVariantFiles(
      workspace,
      requirementsContent,
      buildArenaInstructions(workspace.variant, provider.completionProtocol)
    );
    await repository.ensureWorktreeGitignore(workspace.worktreePath);
  }

  return {
    config,
    paths,
    workspaces,
    requirementsContent,
    repository
  };
};

export const removeSessionFile = async (sessionFilePath: string): Promise<void> => {
  await rm(sessionFilePath, { force: true });
};

export const ensureSessionFile = (paths: ArenaPaths, session: ArenaSessionFile): ArenaSessionFile => ({
  ...session,
  gitRoot: path.resolve(paths.gitRoot)
});

export const isArenaInitialized = async (paths: ArenaPaths): Promise<boolean> =>
  exists(paths.arenaDir);
