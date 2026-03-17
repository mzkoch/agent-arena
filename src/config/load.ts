import path from 'node:path';
import type { ArenaConfig, ArenaPaths, VariantConfig } from '../domain/types';
import { readJsonFile } from '../utils/files';
import { arenaConfigSchema } from './schema';

const normalizeVariant = (variant: {
  name: string;
  provider: string;
  model: string;
  techStack: string;
  designPhilosophy: string;
  branch?: string | undefined;
}): VariantConfig => ({
  ...variant,
  branch: variant.branch ?? `variant/${variant.name}`
});

export const loadArenaConfig = async (configPath: string): Promise<ArenaConfig> => {
  const raw = await readJsonFile<unknown>(configPath);
  const parsed = arenaConfigSchema.parse(raw);
  const normalizedVariants = parsed.variants.map(normalizeVariant);

  if (parsed.worktreeDir) {
    return {
      ...parsed,
      worktreeDir: parsed.worktreeDir,
      variants: normalizedVariants
    };
  }

  return {
    repoName: parsed.repoName,
    maxContinues: parsed.maxContinues,
    agentTimeoutMs: parsed.agentTimeoutMs,
    providers: parsed.providers,
    variants: normalizedVariants
  };
};

export const resolveArenaPaths = (
  configPath: string,
  requirementsPath: string,
  config: ArenaConfig
): ArenaPaths => {
  const resolvedConfigPath = path.resolve(configPath);
  const resolvedRequirementsPath = path.resolve(requirementsPath);
  const repoPath = path.resolve(path.dirname(resolvedConfigPath), config.repoName);
  const worktreeDir = config.worktreeDir
    ? path.resolve(path.dirname(resolvedConfigPath), config.worktreeDir)
    : path.resolve(repoPath, '..', `${config.repoName}-worktrees`);

  return {
    configPath: resolvedConfigPath,
    requirementsPath: resolvedRequirementsPath,
    repoPath,
    worktreeDir,
    sessionFilePath: path.join(repoPath, '.arena-session.json')
  };
};

export const getVariantWorktreePath = (
  paths: ArenaPaths,
  variant: VariantConfig
): string => path.join(paths.worktreeDir, variant.name);
