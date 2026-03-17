import { access, copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ArenaPaths, ArenaConfig, Logger, VariantWorkspace } from '../domain/types';
import { loadArenaConfig, resolveArenaPaths, findGitRoot } from '../config/load';
import { ensureDir, readTextFile, writeJsonFile, writeTextFile } from '../utils/files';

const exists = async (value: string): Promise<boolean> => {
  try {
    await access(value);
    return true;
  } catch {
    return false;
  }
};

export class ArenaProject {
  public constructor(
    public readonly paths: ArenaPaths,
    public readonly config: ArenaConfig
  ) {}

  public static async create(
    gitRoot: string,
    configSource: string,
    requirementsSource: string
  ): Promise<ArenaProject> {
    const arenaDir = path.join(gitRoot, '.arena');
    const configDest = path.join(arenaDir, 'arena.json');
    const requirementsDest = path.join(arenaDir, 'requirements.md');

    await ensureDir(arenaDir);
    await ensureDir(path.join(arenaDir, 'worktrees'));
    await ensureDir(path.join(arenaDir, 'logs'));

    await copyFile(path.resolve(configSource), configDest);
    await copyFile(path.resolve(requirementsSource), requirementsDest);

    const config = await loadArenaConfig(configDest);
    const paths = resolveArenaPaths(gitRoot, configDest, requirementsDest);

    return new ArenaProject(paths, config);
  }

  public static async load(
    configPath: string,
    requirementsPath?: string
  ): Promise<ArenaProject> {
    const config = await loadArenaConfig(configPath);
    const gitRoot = await findGitRoot(path.dirname(configPath));

    const resolvedRequirements = requirementsPath
      ?? path.join(path.dirname(configPath), 'requirements.md');

    const paths = resolveArenaPaths(gitRoot, configPath, resolvedRequirements);
    return new ArenaProject(paths, config);
  }

  public get workspaces(): VariantWorkspace[] {
    return this.config.variants.map((variant) => ({
      variant,
      worktreePath: path.join(this.paths.worktreeDir, variant.name)
    }));
  }

  public async readRequirements(): Promise<string> {
    return readTextFile(this.paths.requirementsPath);
  }

  public async isInitialized(): Promise<boolean> {
    return exists(this.paths.arenaDir);
  }

  public async ensureGitignore(): Promise<void> {
    const gitignorePath = path.join(this.paths.gitRoot, '.gitignore');
    const entry = '.arena/';

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
}
