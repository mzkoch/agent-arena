import { access, rm } from 'node:fs/promises';
import path from 'node:path';
import type { ArenaConfig, ArenaPaths, ArenaSessionFile, Logger, VariantWorkspace } from '../domain/types';
import { findGitRoot, resolveArenaPaths, resolveArenaName, loadArenaConfig } from '../config/load';
import { buildArenaInstructions } from '../prompt/builder';
import { ProviderRegistry } from '../providers/registry';
import { NodeCommandRunner } from '../git/command-runner';
import { GitRepositoryManager, buildVariantWorkspaces } from '../git/repository';
import { ArenaProject } from '../project/arena-project';

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
  const config = await loadArenaConfig(paths.configPath);
  const requirementsContent = await import('../utils/files').then(m => m.readTextFile(paths.requirementsPath));
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
  const repository = new GitRepositoryManager(new NodeCommandRunner(), logger);
  await repository.verifyRepo(gitRoot);

  let project: ArenaProject;
  if (options.configSource && options.requirementsSource) {
    project = await ArenaProject.create(
      gitRoot,
      options.configSource,
      options.requirementsSource,
      options.arenaName
    );
  } else {
    project = await ArenaProject.scaffold(gitRoot, options.arenaName);
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
