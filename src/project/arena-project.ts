import { access, copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ArenaPaths, ArenaConfig, VariantWorkspace } from '../domain/types';
import { loadArenaConfig, resolveArenaPaths, resolveArenaName } from '../config/load';
import { ensureDir, readTextFile, writeTextFile } from '../utils/files';

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

  /**
   * Create a new arena project.
   * - If configSource/requirementsSource are provided, files are copied into `.arena/<arenaName>/`.
   * - The arenaName defaults to "default" if not provided.
   */
  public static async create(
    gitRoot: string,
    configSource: string,
    requirementsSource: string,
    arenaName?: string
  ): Promise<ArenaProject> {
    const name = arenaName ?? 'default';
    const paths = resolveArenaPaths(gitRoot, name);

    await ensureDir(paths.arenaDir);
    await ensureDir(paths.worktreeDir);
    await ensureDir(paths.logDir);

    await copyFile(path.resolve(configSource), paths.configPath);
    await copyFile(path.resolve(requirementsSource), paths.requirementsPath);

    const config = await loadArenaConfig(paths.configPath);

    return new ArenaProject(
      resolveArenaPaths(gitRoot, name),
      config
    );
  }

  /**
   * Scaffold a new empty arena with default config and requirements.
   */
  public static async scaffold(
    gitRoot: string,
    arenaName?: string
  ): Promise<ArenaProject> {
    const name = arenaName ?? 'default';
    const paths = resolveArenaPaths(gitRoot, name);

    await ensureDir(paths.arenaDir);
    await ensureDir(paths.worktreeDir);
    await ensureDir(paths.logDir);

    const defaultConfig = JSON.stringify({
      variants: [
        {
          name: 'agent-1',
          model: 'claude-sonnet-4.5',
          techStack: 'TypeScript',
          designPhilosophy: 'Clean and testable'
        }
      ]
    }, null, 2);

    const defaultRequirements = '# Requirements\n\nDescribe what the agents should build.\n';

    await writeTextFile(paths.configPath, defaultConfig);
    await writeTextFile(paths.requirementsPath, defaultRequirements);

    const config = await loadArenaConfig(paths.configPath);
    return new ArenaProject(paths, config);
  }

  public static async load(
    gitRoot: string,
    arenaName?: string
  ): Promise<ArenaProject> {
    const name = await resolveArenaName(gitRoot, arenaName);
    const paths = resolveArenaPaths(gitRoot, name);
    const config = await loadArenaConfig(paths.configPath);
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
