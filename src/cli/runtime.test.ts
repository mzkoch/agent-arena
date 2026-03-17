import { access, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { initializeArena, isArenaInitialized, loadRuntimeContext, removeSessionFile } from './runtime';

const execFileAsync = promisify(execFile);

const logger = {
  debug() {},
  info() {},
  warn() {},
  error() {}
};

const createGitRepo = async (): Promise<string> => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-runtime-'));
  await execFileAsync('git', ['init', tempDir]);
  await execFileAsync('git', ['-C', tempDir, '-c', 'user.name=Test', '-c', 'user.email=test@test.com', 'commit', '--allow-empty', '-m', 'init']);
  return tempDir;
};

describe('cli runtime helpers', () => {
  it('initializes an arena from a git repo with config and requirements', async () => {
    const gitRoot = await createGitRepo();
    const configPath = path.join(gitRoot, 'arena.json');
    const requirementsPath = path.join(gitRoot, 'REQUIREMENTS.md');

    await writeFile(
      configPath,
      JSON.stringify({
        variants: [
          {
            name: 'alpha',
            model: 'gpt-5',
            techStack: 'TypeScript',
            designPhilosophy: 'Composable'
          }
        ]
      })
    );
    await writeFile(requirementsPath, '# Requirements');

    const context = await initializeArena(
      gitRoot,
      { configSource: configPath, requirementsSource: requirementsPath },
      logger
    );
    expect(await isArenaInitialized(context.paths)).toBe(true);

    expect(context.paths.arenaDir).toBe(path.join(gitRoot, '.arena', 'default'));
    expect(context.paths.arenaName).toBe('default');
    expect(context.workspaces).toHaveLength(1);
    expect(context.workspaces[0]!.variant.branch).toBe('arena/default/alpha');

    const worktreeRequirements = await readFile(
      path.join(context.workspaces[0]!.worktreePath, 'REQUIREMENTS.md'),
      'utf8'
    );
    expect(worktreeRequirements).toContain('# Requirements');

    const gitignore = await readFile(path.join(gitRoot, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.arena/');
  });

  it('initializes a named arena', async () => {
    const gitRoot = await createGitRepo();
    const configPath = path.join(gitRoot, 'arena.json');
    const requirementsPath = path.join(gitRoot, 'REQUIREMENTS.md');

    await writeFile(
      configPath,
      JSON.stringify({
        variants: [
          {
            name: 'alpha',
            model: 'gpt-5',
            techStack: 'TypeScript',
            designPhilosophy: 'Composable'
          }
        ]
      })
    );
    await writeFile(requirementsPath, '# Requirements');

    const context = await initializeArena(
      gitRoot,
      { configSource: configPath, requirementsSource: requirementsPath, arenaName: 'my-arena' },
      logger
    );

    expect(context.paths.arenaDir).toBe(path.join(gitRoot, '.arena', 'my-arena'));
    expect(context.paths.arenaName).toBe('my-arena');
  });

  it('scaffolds an arena without source files', async () => {
    const gitRoot = await createGitRepo();

    const context = await initializeArena(gitRoot, {}, logger);
    expect(await isArenaInitialized(context.paths)).toBe(true);
    expect(context.paths.arenaName).toBe('default');

    await access(context.paths.configPath);
    await access(context.paths.requirementsPath);
  });

  it('loads runtime context with auto-discovered config', async () => {
    const gitRoot = await createGitRepo();
    const arenaDir = path.join(gitRoot, '.arena', 'default');
    await mkdir(arenaDir, { recursive: true });

    await writeFile(
      path.join(arenaDir, 'arena.json'),
      JSON.stringify({
        variants: [
          {
            name: 'beta',
            model: 'gpt-5',
            techStack: 'TypeScript',
            designPhilosophy: 'Simple'
          }
        ]
      })
    );
    await writeFile(path.join(arenaDir, 'requirements.md'), '# Req');

    const origCwd = process.cwd();
    process.chdir(gitRoot);
    try {
      const context = await loadRuntimeContext(undefined, logger);
      expect(context.config.variants[0]!.name).toBe('beta');
      expect(context.requirementsContent).toBe('# Req');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('removes session files', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-runtime-'));
    const sessionFile = path.join(tempDir, 'session.json');
    await writeFile(sessionFile, '{}');
    await removeSessionFile(sessionFile);
    await expect(access(sessionFile)).rejects.toThrow();
  });
});

  it('throws when only configSource is provided without requirementsSource', async () => {
    const gitRoot = await createGitRepo();
    const configPath = path.join(gitRoot, 'arena.json');

    await writeFile(
      configPath,
      JSON.stringify({
        variants: [
          {
            name: 'alpha',
            model: 'gpt-5',
            techStack: 'TypeScript',
            designPhilosophy: 'Composable'
          }
        ]
      })
    );

    await expect(
      initializeArena(gitRoot, { configSource: configPath }, logger)
    ).rejects.toThrow('Both configSource and requirementsSource must be provided together');
  });

  it('loads runtime context for a named arena', async () => {
    const gitRoot = await createGitRepo();
    const arenaDir = path.join(gitRoot, '.arena', 'my-experiment');
    await mkdir(arenaDir, { recursive: true });

    await writeFile(
      path.join(arenaDir, 'arena.json'),
      JSON.stringify({
        variants: [
          {
            name: 'gamma',
            model: 'gpt-5',
            techStack: 'TypeScript',
            designPhilosophy: 'Simple'
          }
        ]
      })
    );
    await writeFile(path.join(arenaDir, 'requirements.md'), '# Named');

    const origCwd = process.cwd();
    process.chdir(gitRoot);
    try {
      const context = await loadRuntimeContext('my-experiment', logger);
      expect(context.config.variants[0]!.name).toBe('gamma');
      expect(context.config.variants[0]!.branch).toBe('arena/my-experiment/gamma');
      expect(context.paths.arenaName).toBe('my-experiment');
    } finally {
      process.chdir(origCwd);
    }
  });
