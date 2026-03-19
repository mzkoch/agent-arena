import { access, readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  acceptVariant,
  checkUnmergedWork,
  createArena,
  initializeArena,
  isArenaInitialized,
  listArenas,
  loadRuntimeContext,
  projectInit,
  removeSessionFile,
  setupWorkspacesForLaunch,
  validateArenaName
} from './runtime';
import * as loadModule from '../config/load';
import { saveModelCache } from '../providers/model-cache';

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

/** Pre-populate model cache so validation runs instantly without spawning discovery. */
const seedModelCache = async (gitRoot: string): Promise<void> => {
  const cacheDir = path.join(gitRoot, '.arena');
  await mkdir(cacheDir, { recursive: true });
  await saveModelCache(path.join(cacheDir, '.model-cache.json'), {
    'copilot-cli': {
      models: ['gpt-5', 'gpt-5.1', 'claude-sonnet-4.5', 'claude-opus-4.6', 'gemini-3-pro-preview'],
      discoveredAt: new Date().toISOString(),
      ttlMs: 3_600_000
    }
  });
};

describe('validateArenaName', () => {
  it('accepts valid names', () => {
    expect(() => validateArenaName('default')).not.toThrow();
    expect(() => validateArenaName('my-arena')).not.toThrow();
    expect(() => validateArenaName('test-123')).not.toThrow();
  });

  it('rejects empty names', () => {
    expect(() => validateArenaName('')).toThrow(/must not be empty/);
  });

  it('rejects names over 64 characters', () => {
    expect(() => validateArenaName('a'.repeat(65))).toThrow(/at most 64/);
  });

  it('rejects names with uppercase letters', () => {
    expect(() => validateArenaName('MyArena')).toThrow(/invalid/);
  });

  it('rejects names with path traversal', () => {
    expect(() => validateArenaName('..hack')).toThrow(/invalid/);
  });

  it('rejects names starting with hyphens', () => {
    expect(() => validateArenaName('-bad')).toThrow(/invalid/);
  });
});

describe('projectInit', () => {
  it('creates .arena/ directory and adds to .gitignore', async () => {
    const gitRoot = await createGitRepo();
    await projectInit(gitRoot, logger);

    await access(path.join(gitRoot, '.arena'));
    const gitignore = await readFile(path.join(gitRoot, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.arena/');
  });

  it('is idempotent', async () => {
    const gitRoot = await createGitRepo();
    await projectInit(gitRoot, logger);
    await projectInit(gitRoot, logger);

    const gitignore = await readFile(path.join(gitRoot, '.gitignore'), 'utf8');
    const matches = gitignore.match(/\.arena\//g);
    expect(matches).toHaveLength(1);
  });
});

describe('createArena', () => {
  it('creates an arena with scaffolded config', async () => {
    const gitRoot = await createGitRepo();
    const project = await createArena(gitRoot, 'my-test', {}, logger);

    expect(project.paths.arenaName).toBe('my-test');
    await access(project.paths.configPath);
    await access(project.paths.requirementsPath);
  });

  it('creates an arena from source files', async () => {
    const gitRoot = await createGitRepo();
    const configPath = path.join(gitRoot, 'arena.json');
    const reqPath = path.join(gitRoot, 'REQUIREMENTS.md');

    await writeFile(configPath, JSON.stringify({
      variants: [{ name: 'alpha', model: 'gpt-5', techStack: 'TypeScript', designPhilosophy: 'Clean' }]
    }));
    await writeFile(reqPath, '# Requirements');

    const project = await createArena(gitRoot, 'from-source', {
      configSource: configPath,
      requirementsSource: reqPath
    }, logger);

    expect(project.paths.arenaName).toBe('from-source');
    expect(project.config.variants[0]!.name).toBe('alpha');
  });

  it('rejects duplicate arena names', async () => {
    const gitRoot = await createGitRepo();
    await createArena(gitRoot, 'first', {}, logger);
    await expect(createArena(gitRoot, 'first', {}, logger)).rejects.toThrow(/already exists/);
  });

  it('validates arena names', async () => {
    const gitRoot = await createGitRepo();
    await expect(createArena(gitRoot, 'INVALID', {}, logger)).rejects.toThrow(/invalid/i);
  });

  it('throws when only one of config/requirements is provided', async () => {
    const gitRoot = await createGitRepo();
    const configPath = path.join(gitRoot, 'arena.json');
    await writeFile(configPath, '{}');

    await expect(
      createArena(gitRoot, 'bad', { configSource: configPath }, logger)
    ).rejects.toThrow(/both/i);
  });
});

describe('listArenas', () => {
  it('returns empty when no arenas exist', async () => {
    const gitRoot = await createGitRepo();
    const arenas = await listArenas(gitRoot, logger);
    expect(arenas).toEqual([]);
  });

  it('lists created arenas', async () => {
    const gitRoot = await createGitRepo();
    await createArena(gitRoot, 'alpha', {}, logger);
    await createArena(gitRoot, 'beta', {}, logger);

    const arenas = await listArenas(gitRoot, logger);
    expect(arenas).toHaveLength(2);
    expect(arenas.map((a) => a.name)).toEqual(['alpha', 'beta']);
    expect(arenas[0]!.status).toBe('created');
  });
});

describe('setupWorkspacesForLaunch', () => {
  it('creates worktrees with variant files in .arena/ subdir', async () => {
    const gitRoot = await createGitRepo();
    await createArena(gitRoot, 'launch-test', {}, logger);
    await seedModelCache(gitRoot);

    const origCwd = process.cwd();
    process.chdir(gitRoot);
    try {
      const context = await loadRuntimeContext('launch-test', logger);
      await setupWorkspacesForLaunch(context);

      const worktreePath = context.workspaces[0]!.worktreePath;
      const reqPath = path.join(worktreePath, '.arena', 'REQUIREMENTS.md');
      const instrPath = path.join(worktreePath, '.arena', 'ARENA-INSTRUCTIONS.md');

      await access(reqPath);
      await access(instrPath);

      const gitignore = await readFile(path.join(worktreePath, '.gitignore'), 'utf8');
      expect(gitignore).toContain('.arena/');
    } finally {
      process.chdir(origCwd);
    }
  });
});

describe('acceptVariant', () => {
  it('creates accept branch from variant tip', async () => {
    const gitRoot = await createGitRepo();
    const configPath = path.join(gitRoot, 'arena.json');
    const reqPath = path.join(gitRoot, 'REQUIREMENTS.md');

    await writeFile(configPath, JSON.stringify({
      variants: [{ name: 'winner', model: 'gpt-5', techStack: 'TS', designPhilosophy: 'Clean' }]
    }));
    await writeFile(reqPath, '# Req');

    await createArena(gitRoot, 'accept-test', {
      configSource: configPath,
      requirementsSource: reqPath
    }, logger);
    await seedModelCache(gitRoot);

    const origCwd = process.cwd();
    process.chdir(gitRoot);
    try {
      const context = await loadRuntimeContext('accept-test', logger);
      await setupWorkspacesForLaunch(context);

      // Make a commit on the variant branch
      const wtPath = context.workspaces[0]!.worktreePath;
      await writeFile(path.join(wtPath, 'test.txt'), 'hello');
      await execFileAsync('git', ['-C', wtPath, 'add', '.']);
      await execFileAsync('git', ['-C', wtPath, '-c', 'user.name=Test', '-c', 'user.email=test@test.com', 'commit', '-m', 'work']);

      const branch = await acceptVariant(gitRoot, 'accept-test', 'winner', logger);
      expect(branch).toBe('accept/accept-test/winner');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('rejects unknown variant names', async () => {
    const gitRoot = await createGitRepo();
    await createArena(gitRoot, 'reject-test', {}, logger);
    await seedModelCache(gitRoot);

    await expect(
      acceptVariant(gitRoot, 'reject-test', 'nonexistent', logger)
    ).rejects.toThrow(/not found/i);
  });
});

describe('checkUnmergedWork', () => {
  it('returns empty when no branches have work', async () => {
    const gitRoot = await createGitRepo();
    await createArena(gitRoot, 'check-test', {}, logger);
    await seedModelCache(gitRoot);

    const origCwd = process.cwd();
    process.chdir(gitRoot);
    try {
      const context = await loadRuntimeContext('check-test', logger);
      const warnings = await checkUnmergedWork(gitRoot, context.config, logger);
      expect(warnings).toEqual([]);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('returns warnings for branches with unmerged commits', async () => {
    const gitRoot = await createGitRepo();
    await createArena(gitRoot, 'safety-test', {}, logger);
    await seedModelCache(gitRoot);

    const origCwd = process.cwd();
    process.chdir(gitRoot);
    try {
      const context = await loadRuntimeContext('safety-test', logger);
      const variant = context.config.variants[0]!;

      // Create a worktree and make a commit on the variant branch
      const worktreePath = path.join(gitRoot, '.arena', 'safety-test', 'worktrees', variant.name);
      await mkdir(worktreePath, { recursive: true });
      await execFileAsync('git', ['-C', gitRoot, 'worktree', 'add', worktreePath, '-b', variant.branch]);
      await writeFile(path.join(worktreePath, 'test.txt'), 'hello');
      await execFileAsync('git', ['-C', worktreePath, '-c', 'user.name=Test', '-c', 'user.email=test@test.com', 'add', '.']);
      await execFileAsync('git', ['-C', worktreePath, '-c', 'user.name=Test', '-c', 'user.email=test@test.com', 'commit', '-m', 'variant work']);

      const warnings = await checkUnmergedWork(gitRoot, context.config, logger);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain(variant.branch);
      expect(warnings[0]).toContain('commit(s) ahead of');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('detects uncommitted changes in worktrees', async () => {
    const gitRoot = await createGitRepo();
    await createArena(gitRoot, 'dirty-test', {}, logger);
    await seedModelCache(gitRoot);

    const origCwd = process.cwd();
    process.chdir(gitRoot);
    try {
      const context = await loadRuntimeContext('dirty-test', logger);
      const variant = context.config.variants[0]!;

      // Create a worktree with dirty files but no commits ahead
      const worktreePath = path.join(gitRoot, '.arena', 'dirty-test', 'worktrees', variant.name);
      await mkdir(worktreePath, { recursive: true });
      await execFileAsync('git', ['-C', gitRoot, 'worktree', 'add', worktreePath, '-b', variant.branch]);
      await writeFile(path.join(worktreePath, 'dirty.txt'), 'uncommitted');

      const warnings = await checkUnmergedWork(gitRoot, context.config, logger);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('uncommitted changes');
    } finally {
      process.chdir(origCwd);
    }
  });

});

/**
 * Helper: set up a git repo with an arena containing a specific model name and
 * a pre-populated model cache so validation can run without network calls.
 */
const setupArenaWithModel = async (
  modelName: string,
  arenaName: string = 'test-arena'
): Promise<{ gitRoot: string; arenaDir: string }> => {
  const gitRoot = await createGitRepo();
  const arenaDir = path.join(gitRoot, '.arena', arenaName);
  await mkdir(arenaDir, { recursive: true });

  await writeFile(
    path.join(arenaDir, 'arena.json'),
    JSON.stringify({
      variants: [
        {
          name: 'variant-1',
          model: modelName,
          techStack: 'TypeScript',
          designPhilosophy: 'Clean'
        }
      ]
    })
  );
  await writeFile(path.join(arenaDir, 'requirements.md'), '# Requirements');

  // Pre-populate model cache so validation runs without network
  const cachePath = path.join(gitRoot, '.arena', '.model-cache.json');
  await saveModelCache(cachePath, {
    'copilot-cli': {
      models: ['gpt-5', 'gpt-5.1', 'claude-opus-4.6', 'gemini-3-pro-preview'],
      discoveredAt: new Date().toISOString(),
      ttlMs: 3_600_000
    }
  });

  return { gitRoot, arenaDir };
};

describe('model validation at CLI call sites (issue #40 regression)', () => {
  it('loadRuntimeContext throws on invalid model name', async () => {
    const { gitRoot } = await setupArenaWithModel('nonexistent-model');

    const origCwd = process.cwd();
    process.chdir(gitRoot);
    try {
      await expect(
        loadRuntimeContext('test-arena', logger)
      ).rejects.toThrow(/model validation failed/i);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('loadRuntimeContext succeeds with valid model', async () => {
    const { gitRoot } = await setupArenaWithModel('gpt-5');

    const origCwd = process.cwd();
    process.chdir(gitRoot);
    try {
      const context = await loadRuntimeContext('test-arena', logger);
      expect(context.config.variants[0]!.model).toBe('gpt-5');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('acceptVariant throws on invalid model name', async () => {
    const { gitRoot } = await setupArenaWithModel('nonexistent-model');

    await expect(
      acceptVariant(gitRoot, 'test-arena', 'variant-1', logger)
    ).rejects.toThrow(/model validation failed/i);
  });

  it('listArenas does NOT trigger model validation (skips it)', async () => {
    const { gitRoot } = await setupArenaWithModel('nonexistent-model');

    // If validation ran, this would throw. It should succeed silently.
    const arenas = await listArenas(gitRoot, logger);
    expect(arenas).toHaveLength(1);
    expect(arenas[0]!.name).toBe('test-arena');
    expect(arenas[0]!.variantCount).toBe(1);
  });

  it('invalid model produces actionable error with suggestion', async () => {
    const { gitRoot } = await setupArenaWithModel('gemini-3-pro');

    const origCwd = process.cwd();
    process.chdir(gitRoot);
    try {
      await expect(
        loadRuntimeContext('test-arena', logger)
      ).rejects.toThrow(/did you mean "gemini-3-pro-preview"/i);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('passes gitRoot to loadArenaConfig at every call site', async () => {
    const { gitRoot } = await setupArenaWithModel('gpt-5');
    const loadArenaConfigSpy = vi.spyOn(loadModule, 'loadArenaConfig');

    const origCwd = process.cwd();
    process.chdir(gitRoot);
    try {
      await loadRuntimeContext('test-arena', logger);
    } finally {
      process.chdir(origCwd);
    }
    await listArenas(gitRoot, logger);
    await expect(
      acceptVariant(gitRoot, 'test-arena', 'missing-variant', logger)
    ).rejects.toThrow(/not found/i);

    expect(loadArenaConfigSpy).toHaveBeenCalledTimes(3);

    const [runtimeCall, listCall, acceptCall] = loadArenaConfigSpy.mock.calls;
    const canonicalGitRoot = await realpath(gitRoot);

    const runtimeOptions = runtimeCall?.[2] as { gitRoot: string } | undefined;
    expect(runtimeOptions).toBeDefined();
    expect(await realpath(runtimeOptions!.gitRoot)).toBe(canonicalGitRoot);

    const listOptions = listCall?.[2] as { gitRoot: string; skipModelValidation?: boolean } | undefined;
    expect(listOptions).toMatchObject({ skipModelValidation: true });
    expect(await realpath(listOptions!.gitRoot)).toBe(canonicalGitRoot);

    const acceptOptions = acceptCall?.[2] as { gitRoot: string } | undefined;
    expect(acceptOptions).toBeDefined();
    expect(await realpath(acceptOptions!.gitRoot)).toBe(canonicalGitRoot);

    loadArenaConfigSpy.mockRestore();
  });
});

describe('cli runtime helpers (legacy)', () => {
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

    // Files should be in .arena/ subdir inside worktree
    const worktreeRequirements = await readFile(
      path.join(context.workspaces[0]!.worktreePath, '.arena', 'REQUIREMENTS.md'),
      'utf8'
    );
    expect(worktreeRequirements).toContain('# Requirements');

    // Worktree .gitignore should include .arena/
    const wtGitignore = await readFile(
      path.join(context.workspaces[0]!.worktreePath, '.gitignore'),
      'utf8'
    );
    expect(wtGitignore).toContain('.arena/');

    const gitignore = await readFile(path.join(gitRoot, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.arena/');
  }, 20_000);

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
  }, 20_000);

  it('scaffolds an arena without source files', async () => {
    const gitRoot = await createGitRepo();

    const context = await initializeArena(gitRoot, {}, logger);
    expect(await isArenaInitialized(context.paths)).toBe(true);
    expect(context.paths.arenaName).toBe('default');

    await access(context.paths.configPath);
    await access(context.paths.requirementsPath);
  }, 20_000);

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
    await seedModelCache(gitRoot);

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
    await seedModelCache(gitRoot);

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
});
