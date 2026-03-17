import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ArenaConfig, ArenaPaths, VariantConfig } from '../domain/types';
import { readJsonFile } from '../utils/files';
import { arenaConfigSchema } from './schema';

const execFileAsync = promisify(execFile);

const ARENA_DIR = '.arena';
const ARENA_CONFIG_NAME = 'arena.json';
const DEFAULT_ARENA_NAME = 'default';

const exists = async (value: string): Promise<boolean> => {
  try {
    await access(value);
    return true;
  } catch {
    return false;
  }
};

const normalizeVariant = (variant: {
  name: string;
  provider: string;
  model: string;
  techStack: string;
  designPhilosophy: string;
  branch?: string | undefined;
}, arenaName: string): VariantConfig => ({
  ...variant,
  branch: variant.branch ?? `arena/${arenaName}/${variant.name}`
});

export const loadArenaConfig = async (configPath: string, arenaName: string = DEFAULT_ARENA_NAME): Promise<ArenaConfig> => {
  const raw = await readJsonFile<unknown>(configPath);
  const parsed = arenaConfigSchema.parse(raw);
  const normalizedVariants = parsed.variants.map((v) => normalizeVariant(v, arenaName));

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
  arenaName: string
): ArenaPaths => {
  const arenaDir = path.join(gitRoot, ARENA_DIR, arenaName);
  const configPath = path.join(arenaDir, ARENA_CONFIG_NAME);
  const requirementsPath = path.join(arenaDir, 'requirements.md');
  return {
    arenaName,
    configPath,
    requirementsPath,
    gitRoot,
    arenaDir,
    worktreeDir: path.join(arenaDir, 'worktrees'),
    sessionFilePath: path.join(arenaDir, 'session.json'),
    logDir: path.join(arenaDir, 'logs'),
    reportPath: path.join(arenaDir, 'comparison-report.md')
  };
};

/** List arena names found under `.arena/` by looking for subdirectories that contain an `arena.json`. */
export const listArenaNames = async (gitRoot: string): Promise<string[]> => {
  const arenaRoot = path.join(gitRoot, ARENA_DIR);
  if (!(await exists(arenaRoot))) {
    return [];
  }

  const entries = await readdir(arenaRoot, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const configPath = path.join(arenaRoot, entry.name, ARENA_CONFIG_NAME);
      if (await exists(configPath)) {
        names.push(entry.name);
      }
    }
  }
  return names.sort();
};

/**
 * Resolve which arena to use.
 * - If a name is provided, use it directly.
 * - If only one arena exists, use it.
 * - If no arenas exist, default to "default".
 * - If multiple arenas exist and no name is provided, throw with a helpful message.
 */
export const resolveArenaName = async (
  gitRoot: string,
  explicitName?: string
): Promise<string> => {
  if (explicitName) {
    return explicitName;
  }

  const names = await listArenaNames(gitRoot);

  if (names.length === 0) {
    return DEFAULT_ARENA_NAME;
  }

  if (names.length === 1) {
    return names[0]!;
  }

  throw new Error(
    `Multiple arenas found: ${names.join(', ')}. Specify which arena to use, e.g. "arena launch ${names[0]!}".`
  );
};

export const discoverArenaConfig = async (
  from?: string,
  arenaName?: string
): Promise<string> => {
  const gitRoot = await findGitRoot(from);
  const name = await resolveArenaName(gitRoot, arenaName);
  const configPath = path.join(gitRoot, ARENA_DIR, name, ARENA_CONFIG_NAME);
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
