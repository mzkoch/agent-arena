import fs from 'node:fs/promises';
import path from 'node:path';
import { ArenaConfigSchema, type ArenaConfig } from './types.js';

/**
 * Load and validate an arena configuration file.
 */
export async function loadConfig(configPath: string): Promise<ArenaConfig> {
  const resolved = path.resolve(configPath);
  const raw = await fs.readFile(resolved, 'utf-8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in config file: ${resolved}`);
  }

  return ArenaConfigSchema.parse(parsed);
}

/**
 * Load requirements from a markdown file.
 */
export async function loadRequirements(requirementsPath: string): Promise<string> {
  const resolved = path.resolve(requirementsPath);
  return fs.readFile(resolved, 'utf-8');
}

/**
 * Resolve the worktree base directory.
 * Uses config.worktreeDir if set, otherwise defaults to ../<repoName>-worktrees/
 */
export function resolveWorktreeDir(config: ArenaConfig, basePath: string): string {
  if (config.worktreeDir) {
    return path.resolve(config.worktreeDir);
  }
  return path.resolve(basePath, `${config.repoName}-worktrees`);
}

/**
 * Resolve the repo path. Defaults to ./<repoName> in the current directory.
 */
export function resolveRepoPath(config: ArenaConfig, basePath: string): string {
  return path.resolve(basePath, config.repoName);
}
