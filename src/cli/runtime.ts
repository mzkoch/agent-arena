import { access, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { ArenaConfig, ArenaPaths, ArenaSessionFile, Logger, VariantWorkspace } from '../domain/types';
import { discoverArenaConfig, findGitRoot, loadArenaConfig, resolveArenaPaths } from '../config/load';
import { buildArenaInstructions } from '../prompt/builder';
import { ProviderRegistry } from '../providers/registry';
import { readTextFile, ensureDir } from '../utils/files';
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
  configPath: string | undefined,
  requirementsPath: string | undefined,
  logger: Logger
): Promise<ArenaRuntimeContext> => {
  const resolvedConfigPath = configPath ?? await discoverArenaConfig();
  const config = await loadArenaConfig(resolvedConfigPath);

  const gitRoot = await findGitRoot(path.dirname(resolvedConfigPath));

  const resolvedRequirementsPath = requirementsPath
    ?? path.join(path.dirname(resolvedConfigPath), 'requirements.md');

  const paths = resolveArenaPaths(gitRoot, resolvedConfigPath, resolvedRequirementsPath);
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

export const initializeArena = async (
  gitRoot: string,
  configSource: string,
  requirementsSource: string,
  logger: Logger
): Promise<ArenaRuntimeContext> => {
  const repository = new GitRepositoryManager(new NodeCommandRunner(), logger);
  await repository.verifyRepo(gitRoot);

  const arenaDir = path.join(gitRoot, '.arena');
  await ensureDir(arenaDir);
  await ensureDir(path.join(arenaDir, 'worktrees'));
  await ensureDir(path.join(arenaDir, 'logs'));

  const configDest = path.join(arenaDir, 'arena.json');
  const requirementsDest = path.join(arenaDir, 'requirements.md');

  await copyFile(path.resolve(configSource), configDest);
  await copyFile(path.resolve(requirementsSource), requirementsDest);
  await repository.ensureGitignoreEntry(gitRoot, '.arena/');

  const config = await loadArenaConfig(configDest);
  const paths = resolveArenaPaths(gitRoot, configDest, requirementsDest);
  const workspaces = buildVariantWorkspaces(paths, config.variants);
  const requirementsContent = await readTextFile(requirementsDest);

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
