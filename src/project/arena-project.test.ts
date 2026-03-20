import { mkdtemp, writeFile, readFile, mkdir, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ArenaProject } from './arena-project';

const execFileAsync = promisify(execFile);

const createGitRepo = async (): Promise<string> => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-project-'));
  await execFileAsync('git', ['init', tempDir]);
  await execFileAsync('git', [
    '-C', tempDir, '-c', 'user.name=Test', '-c', 'user.email=test@test.com',
    'commit', '--allow-empty', '-m', 'init'
  ]);
  return tempDir;
};

describe('ArenaProject', () => {
  it('creates a new arena project with .arena/<name>/ directory structure', async () => {
    const gitRoot = await createGitRepo();
    const configSource = path.join(gitRoot, 'arena.json');
    const requirementsSource = path.join(gitRoot, 'REQUIREMENTS.md');

    await writeFile(
      configSource,
      JSON.stringify({
        variants: [
          {
            name: 'alpha',
            model: 'gpt-5',
            techStack: 'TypeScript',
            designPhilosophy: 'Clean'
          }
        ]
      })
    );
    await writeFile(requirementsSource, '# Build something');

    const project = await ArenaProject.create(gitRoot, configSource, requirementsSource);
    expect(project.paths.arenaDir).toBe(path.join(gitRoot, '.arena', 'default'));
    expect(project.paths.arenaName).toBe('default');
    expect(project.config.variants).toHaveLength(1);
    expect(project.config.variants[0]!.branch).toBe('arena/default/alpha');

    await access(path.join(gitRoot, '.arena', 'default', 'arena.json'));
    await access(path.join(gitRoot, '.arena', 'default', 'requirements.md'));
    await access(path.join(gitRoot, '.arena', 'default', 'worktrees'));
    await access(path.join(gitRoot, '.arena', 'default', 'logs'));
  });

  it('creates a named arena project', async () => {
    const gitRoot = await createGitRepo();
    const configSource = path.join(gitRoot, 'arena.json');
    const requirementsSource = path.join(gitRoot, 'REQUIREMENTS.md');

    await writeFile(
      configSource,
      JSON.stringify({
        variants: [
          {
            name: 'alpha',
            model: 'gpt-5',
            techStack: 'TypeScript',
            designPhilosophy: 'Clean'
          }
        ]
      })
    );
    await writeFile(requirementsSource, '# Build something');

    const project = await ArenaProject.create(gitRoot, configSource, requirementsSource, 'my-arena');
    expect(project.paths.arenaDir).toBe(path.join(gitRoot, '.arena', 'my-arena'));
    expect(project.paths.arenaName).toBe('my-arena');
  });

  it('scaffolds an arena without source files', async () => {
    const gitRoot = await createGitRepo();

    const project = await ArenaProject.scaffold(gitRoot, 'scaffolded');
    expect(project.paths.arenaDir).toBe(path.join(gitRoot, '.arena', 'scaffolded'));
    expect(project.config.variants).toHaveLength(1);

    await access(project.paths.configPath);
    await access(project.paths.requirementsPath);
  });

  it('loads an existing arena project by name', async () => {
    const gitRoot = await createGitRepo();
    const arenaDir = path.join(gitRoot, '.arena', 'beta');
    await mkdir(arenaDir, { recursive: true });
    const configPath = path.join(arenaDir, 'arena.json');
    const reqPath = path.join(arenaDir, 'requirements.md');

    await writeFile(
      configPath,
      JSON.stringify({
        variants: [
          {
            name: 'beta',
            model: 'gpt-5',
            techStack: 'Go',
            designPhilosophy: 'Fast'
          }
        ]
      })
    );
    await writeFile(reqPath, '# Requirements');

    const project = await ArenaProject.load(gitRoot, 'beta');
    expect(project.config.variants[0]!.name).toBe('beta');
    expect(project.paths.arenaName).toBe('beta');
  });

  it('returns correct workspaces', async () => {
    const gitRoot = await createGitRepo();
    const configSource = path.join(gitRoot, 'arena.json');
    const requirementsSource = path.join(gitRoot, 'REQUIREMENTS.md');

    await writeFile(
      configSource,
      JSON.stringify({
        variants: [
          { name: 'a', model: 'm', techStack: 'ts', designPhilosophy: 'dp' },
          { name: 'b', model: 'm', techStack: 'ts', designPhilosophy: 'dp' }
        ]
      })
    );
    await writeFile(requirementsSource, '# Req');

    const project = await ArenaProject.create(gitRoot, configSource, requirementsSource);
    expect(project.workspaces).toHaveLength(2);
    expect(project.workspaces[0]!.worktreePath).toBe(path.join(gitRoot, '.arena', 'default', 'worktrees', 'a'));
    expect(project.workspaces[1]!.worktreePath).toBe(path.join(gitRoot, '.arena', 'default', 'worktrees', 'b'));
  });

  it('reads requirements content', async () => {
    const gitRoot = await createGitRepo();
    const configSource = path.join(gitRoot, 'arena.json');
    const requirementsSource = path.join(gitRoot, 'req.md');

    await writeFile(configSource, JSON.stringify({
      variants: [{ name: 'c', model: 'm', techStack: 'ts', designPhilosophy: 'dp' }]
    }));
    await writeFile(requirementsSource, '# My Requirements');

    const project = await ArenaProject.create(gitRoot, configSource, requirementsSource);
    const content = await project.readRequirements();
    expect(content).toBe('# My Requirements');
  });

  it('checks initialization state', async () => {
    const gitRoot = await createGitRepo();
    const configSource = path.join(gitRoot, 'arena.json');
    const requirementsSource = path.join(gitRoot, 'req.md');

    await writeFile(configSource, JSON.stringify({
      variants: [{ name: 'd', model: 'm', techStack: 'ts', designPhilosophy: 'dp' }]
    }));
    await writeFile(requirementsSource, '# Req');

    const project = await ArenaProject.create(gitRoot, configSource, requirementsSource);
    expect(await project.isInitialized()).toBe(true);
  });

  it('adds .arena/ to .gitignore idempotently', async () => {
    const gitRoot = await createGitRepo();
    const configSource = path.join(gitRoot, 'arena.json');
    const requirementsSource = path.join(gitRoot, 'req.md');

    await writeFile(configSource, JSON.stringify({
      variants: [{ name: 'e', model: 'm', techStack: 'ts', designPhilosophy: 'dp' }]
    }));
    await writeFile(requirementsSource, '# Req');

    const project = await ArenaProject.create(gitRoot, configSource, requirementsSource);

    await project.ensureGitignore();
    const first = await readFile(path.join(gitRoot, '.gitignore'), 'utf8');
    expect(first).toContain('.arena/');

    await project.ensureGitignore();
    const second = await readFile(path.join(gitRoot, '.gitignore'), 'utf8');
    expect(second).toBe(first);
  });

  it('creates .gitignore from scratch when none exists', async () => {
    const gitRoot = await createGitRepo();
    const project = await ArenaProject.scaffold(gitRoot);

    // Ensure there is no .gitignore yet
    const gitignorePath = path.join(gitRoot, '.gitignore');
    await expect(access(gitignorePath)).rejects.toHaveProperty('code', 'ENOENT');

    await project.ensureGitignore();
    const content = await readFile(gitignorePath, 'utf8');
    expect(content).toContain('# Arena');
    expect(content).toContain('.arena/');
  });

  it('appends to .gitignore without trailing newline', async () => {
    const gitRoot = await createGitRepo();
    const gitignorePath = path.join(gitRoot, '.gitignore');
    await writeFile(gitignorePath, 'node_modules/'); // no trailing newline

    const project = await ArenaProject.scaffold(gitRoot, 'test');
    await project.ensureGitignore();

    const content = await readFile(gitignorePath, 'utf8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.arena/');
    // Should have proper separation
    expect(content).toContain('\n# Arena\n');
  });

  it('scaffold uses default name when none provided', async () => {
    const gitRoot = await createGitRepo();
    const project = await ArenaProject.scaffold(gitRoot);
    expect(project.paths.arenaName).toBe('default');
  });
});
