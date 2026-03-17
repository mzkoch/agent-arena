import { access, rm } from 'node:fs/promises';
import path from 'node:path';
import type { ArenaConfig, ArenaPaths, ArenaSessionFile, Logger, VariantWorkspace } from '../domain/types';
import { loadArenaConfig, resolveArenaPaths } from '../config/load';
import { buildArenaInstructions } from '../prompt/builder';
import { ProviderRegistry } from '../providers/registry';
import { readTextFile } from '../utils/files';
import { NodeCommandRunner } from '../git/command-runner';
import { GitRepositoryManager, buildVariantWorkspaces } from '../git/repository';

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
  configPath: string,
  requirementsPath: string,
  logger: Logger
): Promise<ArenaRuntimeContext> => {
  const config = await loadArenaConfig(configPath);
  const paths = resolveArenaPaths(configPath, requirementsPath, config);
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

export const initializeArena = async (context: ArenaRuntimeContext): Promise<void> => {
  await context.repository.initRepo(context.paths.repoPath);

  const registry = new ProviderRegistry(context.config.providers);
  for (const workspace of context.workspaces) {
    await context.repository.createWorktree(
      context.paths.repoPath,
      workspace.variant.branch,
      workspace.worktreePath
    );
    const provider = registry.get(workspace.variant.provider);
    await context.repository.writeVariantFiles(
      workspace,
      context.requirementsContent,
      buildArenaInstructions(workspace.variant, provider.completionProtocol)
    );
  }
};

export const removeSessionFile = async (sessionFilePath: string): Promise<void> => {
  await rm(sessionFilePath, { force: true });
};

export const ensureSessionFile = (paths: ArenaPaths, session: ArenaSessionFile): ArenaSessionFile => ({
  ...session,
  repoPath: path.resolve(paths.repoPath)
});

export const isArenaInitialized = async (paths: ArenaPaths): Promise<boolean> =>
  exists(path.join(paths.repoPath, '.git'));
