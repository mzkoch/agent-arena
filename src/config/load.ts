import { access } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ArenaConfig, ArenaPaths, VariantConfig } from '../domain/types';
import { readJsonFile } from '../utils/files';
import { arenaConfigSchema } from './schema';

const execFileAsync = promisify(execFile);

const ARENA_DIR = '.arena';
const ARENA_CONFIG_NAME = 'arena.json';

const normalizeVariant = (variant: {
  name: string;
  provider: string;
  model: string;
  techStack: string;
  designPhilosophy: string;
  branch?: string | undefined;
}): VariantConfig => ({
  ...variant,
  branch: variant.branch ?? `arena/${variant.name}`
});

export const loadArenaConfig = async (configPath: string): Promise<ArenaConfig> => {
  const raw = await readJsonFile<unknown>(configPath);
  const parsed = arenaConfigSchema.parse(raw);
  const normalizedVariants = parsed.variants.map(normalizeVariant);

  return {
    repoName: parsed.repoName,
    maxContinues: parsed.maxContinues,
    agentTimeoutMs: parsed.agentTimeoutMs,
    providers: parsed.providers,
    variants: normalizedVariants
  };
};

export const findGitRoot = async (from?: string): Promise<string> => {
  const cwd = from ?? process.cwd();
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd });
    return stdout.trim();
  } catch {
    throw new Error(
      `Not inside a git repository (searched from ${cwd}). Run "git init" first or navigate to a git project.`
    );
  }
};

export const resolveArenaPaths = (
  gitRoot: string,
  configPath: string,
  requirementsPath: string
): ArenaPaths => {
  const arenaDir = path.join(gitRoot, ARENA_DIR);
  return {
    configPath: path.resolve(configPath),
    requirementsPath: path.resolve(requirementsPath),
    gitRoot,
    arenaDir,
    worktreeDir: path.join(arenaDir, 'worktrees'),
    sessionFilePath: path.join(arenaDir, 'session.json'),
    logDir: path.join(arenaDir, 'logs'),
    reportPath: path.join(arenaDir, 'comparison-report.md')
  };
};

export const discoverArenaConfig = async (from?: string): Promise<string> => {
  const gitRoot = await findGitRoot(from);
  const configPath = path.join(gitRoot, ARENA_DIR, ARENA_CONFIG_NAME);
  try {
    await access(configPath);
  } catch {
    throw new Error(
      `No arena configuration found at ${configPath}. Run "arena init" first.`
    );
  }
  return configPath;
};

export const getVariantWorktreePath = (
  paths: ArenaPaths,
  variant: VariantConfig
): string => path.join(paths.worktreeDir, variant.name);
