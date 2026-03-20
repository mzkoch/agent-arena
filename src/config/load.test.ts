import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { discoverArenaConfig, findGitRoot, listArenaNames, loadArenaConfig, resolveArenaName, resolveArenaPaths } from './load';
import { saveModelCache } from '../providers/model-cache';

const execFileAsync = promisify(execFile);

describe('loadArenaConfig', () => {
  it('applies defaults for provider, branch, and numeric fields', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-config-'));
    const configPath = path.join(tempDir, 'arena.json');
    await writeFile(
      configPath,
      JSON.stringify({
        variants: [
          {
            name: 'node-cli',
            model: 'gpt-5',
            techStack: 'TypeScript',
            designPhilosophy: 'Keep it simple'
          }
        ]
      })
    );

    const config = await loadArenaConfig(configPath);
    expect(config.maxContinues).toBe(50);
    expect(config.agentTimeoutMs).toBe(3_600_000);
    expect(config.variants[0]).toMatchObject({
      provider: 'copilot-cli',
      branch: 'arena/default/node-cli'
    });
  });

  it('rejects duplicated variant names with a clear message', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-config-'));
    const configPath = path.join(tempDir, 'arena.json');
    await writeFile(
      configPath,
      JSON.stringify({
        variants: [
          {
            name: 'duplicate',
            model: 'gpt-5',
            techStack: 'TypeScript',
            designPhilosophy: 'A'
          },
          {
            name: 'duplicate',
            model: 'gpt-5.1',
            techStack: 'Node',
            designPhilosophy: 'B'
          }
        ]
      })
    );

    await expect(loadArenaConfig(configPath)).rejects.toThrow(/duplicated/i);
  });
});

describe('resolveArenaPaths', () => {
  it('resolves all paths within the .arena/<name>/ directory', () => {
    const gitRoot = '/tmp/my-project';
    const paths = resolveArenaPaths(gitRoot, 'default');

    expect(paths.arenaName).toBe('default');
    expect(paths.gitRoot).toBe('/tmp/my-project');
    expect(paths.arenaDir).toBe(path.join('/tmp/my-project', '.arena', 'default'));
    expect(paths.configPath).toBe(path.join('/tmp/my-project', '.arena', 'default', 'arena.json'));
    expect(paths.requirementsPath).toBe(path.join('/tmp/my-project', '.arena', 'default', 'requirements.md'));
    expect(paths.worktreeDir).toBe(path.join('/tmp/my-project', '.arena', 'default', 'worktrees'));
    expect(paths.sessionFilePath).toBe(path.join('/tmp/my-project', '.arena', 'default', 'session.json'));
    expect(paths.logDir).toBe(path.join('/tmp/my-project', '.arena', 'default', 'logs'));
    expect(paths.reportPath).toBe(path.join('/tmp/my-project', '.arena', 'default', 'comparison-report.md'));
  });

  it('resolves paths for a named arena', () => {
    const gitRoot = '/tmp/my-project';
    const paths = resolveArenaPaths(gitRoot, 'my-arena');

    expect(paths.arenaName).toBe('my-arena');
    expect(paths.arenaDir).toBe(path.join('/tmp/my-project', '.arena', 'my-arena'));
  });
});

describe('findGitRoot', () => {
  it('throws when not in a git repository', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-nogit-'));
    await expect(findGitRoot(tempDir)).rejects.toThrow(/not inside a git repository/i);
  });
});

describe('discoverArenaConfig', () => {
  it('discovers .arena/<name>/arena.json from a git repository', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-discover-'));
    await execFileAsync('git', ['init', tempDir]);
    const arenaDir = path.join(tempDir, '.arena', 'default');
    const configPath = path.join(arenaDir, 'arena.json');
    await mkdir(arenaDir, { recursive: true });
    await writeFile(configPath, '{}');

    const discovered = await discoverArenaConfig(tempDir, 'default');
    const { realpath: rp } = await import('node:fs/promises');
    expect(await rp(discovered)).toBe(await rp(configPath));
  });

  it('throws when .arena/<name>/arena.json does not exist', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-discover-'));
    await execFileAsync('git', ['init', tempDir]);

    await expect(discoverArenaConfig(tempDir, 'default')).rejects.toThrow(/no arena configuration found/i);
  });
});

describe('listArenaNames', () => {
  it('returns empty when .arena/ does not exist', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-list-'));
    expect(await listArenaNames(tempDir)).toEqual([]);
  });

  it('lists arena names that have arena.json', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-list-'));
    const arenaRoot = path.join(tempDir, '.arena');

    await mkdir(path.join(arenaRoot, 'first'), { recursive: true });
    await writeFile(path.join(arenaRoot, 'first', 'arena.json'), '{}');

    await mkdir(path.join(arenaRoot, 'second'), { recursive: true });
    await writeFile(path.join(arenaRoot, 'second', 'arena.json'), '{}');

    // Directory without arena.json should be excluded
    await mkdir(path.join(arenaRoot, 'empty'), { recursive: true });

    const names = await listArenaNames(tempDir);
    expect(names).toEqual(['first', 'second']);
  });
});

describe('resolveArenaName', () => {
  it('returns explicit name when provided', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-resolve-'));
    expect(await resolveArenaName(tempDir, 'my-arena')).toBe('my-arena');
  });

  it('returns default when no arenas exist', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-resolve-'));
    expect(await resolveArenaName(tempDir)).toBe('default');
  });

  it('returns the single arena when exactly one exists', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-resolve-'));
    const arenaRoot = path.join(tempDir, '.arena', 'only-one');
    await mkdir(arenaRoot, { recursive: true });
    await writeFile(path.join(arenaRoot, 'arena.json'), '{}');

    expect(await resolveArenaName(tempDir)).toBe('only-one');
  });

  it('throws when multiple arenas exist and no name is provided', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-resolve-'));
    const arenaRoot = path.join(tempDir, '.arena');

    await mkdir(path.join(arenaRoot, 'a'), { recursive: true });
    await writeFile(path.join(arenaRoot, 'a', 'arena.json'), '{}');

    await mkdir(path.join(arenaRoot, 'b'), { recursive: true });
    await writeFile(path.join(arenaRoot, 'b', 'arena.json'), '{}');

    await expect(resolveArenaName(tempDir)).rejects.toThrow(/multiple arenas found/i);
  });
});

describe('loadArenaConfig model validation', () => {
  it('rejects an invalid model when discovery finds valid models', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-model-'));
    const arenaDir = path.join(tempDir, '.arena');
    await mkdir(arenaDir, { recursive: true });

    const configPath = path.join(tempDir, 'arena.json');
    await writeFile(
      configPath,
      JSON.stringify({
        variants: [
          {
            name: 'bad-variant',
            provider: 'copilot-cli',
            model: 'nonexistent-model',
            techStack: 'TypeScript',
            designPhilosophy: 'Test'
          }
        ]
      })
    );

    // Pre-populate cache with valid models
    const cachePath = path.join(arenaDir, '.model-cache.json');
    await saveModelCache(cachePath, {
      'copilot-cli': {
        models: ['gpt-5', 'gpt-5.1', 'claude-opus-4.6'],
        discoveredAt: new Date().toISOString(),
        ttlMs: 3600000
      }
    });

    await expect(
      loadArenaConfig(configPath, 'default', { gitRoot: tempDir })
    ).rejects.toThrow(/model validation failed/i);
  });

  it('includes suggestion for close model match', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-model-'));
    const arenaDir = path.join(tempDir, '.arena');
    await mkdir(arenaDir, { recursive: true });

    const configPath = path.join(tempDir, 'arena.json');
    await writeFile(
      configPath,
      JSON.stringify({
        variants: [
          {
            name: 'typo-variant',
            provider: 'copilot-cli',
            model: 'gemini-3-pro',
            techStack: 'TypeScript',
            designPhilosophy: 'Test'
          }
        ]
      })
    );

    const cachePath = path.join(arenaDir, '.model-cache.json');
    await saveModelCache(cachePath, {
      'copilot-cli': {
        models: ['gpt-5', 'gemini-3-pro-preview'],
        discoveredAt: new Date().toISOString(),
        ttlMs: 3600000
      }
    });

    await expect(
      loadArenaConfig(configPath, 'default', { gitRoot: tempDir })
    ).rejects.toThrow(/did you mean "gemini-3-pro-preview"/i);
  });

  it('skips validation when gitRoot not provided', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-model-'));
    const configPath = path.join(tempDir, 'arena.json');
    await writeFile(
      configPath,
      JSON.stringify({
        variants: [
          {
            name: 'any-model',
            model: 'anything-goes',
            techStack: 'TypeScript',
            designPhilosophy: 'Test'
          }
        ]
      })
    );

    // Should succeed without validation
    const config = await loadArenaConfig(configPath);
    expect(config.variants[0]?.model).toBe('anything-goes');
  });

  it('skips validation when skipModelValidation is true', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-model-'));
    const arenaDir = path.join(tempDir, '.arena');
    await mkdir(arenaDir, { recursive: true });

    const configPath = path.join(tempDir, 'arena.json');
    await writeFile(
      configPath,
      JSON.stringify({
        variants: [
          {
            name: 'skip-variant',
            model: 'nonexistent-model',
            techStack: 'TypeScript',
            designPhilosophy: 'Test'
          }
        ]
      })
    );

    const cachePath = path.join(arenaDir, '.model-cache.json');
    await saveModelCache(cachePath, {
      'copilot-cli': {
        models: ['gpt-5'],
        discoveredAt: new Date().toISOString(),
        ttlMs: 3600000
      }
    });

    const config = await loadArenaConfig(configPath, 'default', {
      gitRoot: tempDir,
      skipModelValidation: true
    });
    expect(config.variants[0]?.model).toBe('nonexistent-model');
  });

  it('allows valid models to pass validation', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-model-'));
    const arenaDir = path.join(tempDir, '.arena');
    await mkdir(arenaDir, { recursive: true });

    const configPath = path.join(tempDir, 'arena.json');
    await writeFile(
      configPath,
      JSON.stringify({
        variants: [
          {
            name: 'good-variant',
            model: 'gpt-5',
            techStack: 'TypeScript',
            designPhilosophy: 'Test'
          }
        ]
      })
    );

    const cachePath = path.join(arenaDir, '.model-cache.json');
    await saveModelCache(cachePath, {
      'copilot-cli': {
        models: ['gpt-5', 'gpt-5.1'],
        discoveredAt: new Date().toISOString(),
        ttlMs: 3600000
      }
    });

    const config = await loadArenaConfig(configPath, 'default', { gitRoot: tempDir });
    expect(config.variants[0]?.model).toBe('gpt-5');
  });

  it('skips validation gracefully when discovery is not configured', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-model-'));
    const arenaDir = path.join(tempDir, '.arena');
    await mkdir(arenaDir, { recursive: true });

    const configPath = path.join(tempDir, 'arena.json');
    await writeFile(
      configPath,
      JSON.stringify({
        providers: {
          'custom-provider': {
            command: 'custom',
            promptDelivery: 'positional',
            exitCommand: '/quit'
          }
        },
        variants: [
          {
            name: 'custom-variant',
            provider: 'custom-provider',
            model: 'any-model',
            techStack: 'TypeScript',
            designPhilosophy: 'Test'
          }
        ]
      })
    );

    // No cache, no discovery config on custom provider — should pass
    const config = await loadArenaConfig(configPath, 'default', { gitRoot: tempDir });
    expect(config.variants[0]?.model).toBe('any-model');
  });
});

describe('schema validation', () => {
  it('rejects promptDelivery=flag without promptFlag', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-schema-'));
    const configPath = path.join(tempDir, 'arena.json');
    await writeFile(
      configPath,
      JSON.stringify({
        providers: {
          'test-provider': {
            command: 'test-cmd',
            promptDelivery: 'flag',
            exitCommand: '/quit'
            // missing promptFlag
          }
        },
        variants: [
          {
            name: 'v1',
            provider: 'test-provider',
            model: 'test-model',
            techStack: 'TypeScript',
            designPhilosophy: 'Test'
          }
        ]
      })
    );

    await expect(loadArenaConfig(configPath)).rejects.toThrow(/promptFlag/);
  });

  it('accepts promptDelivery=flag with promptFlag', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-schema-'));
    const configPath = path.join(tempDir, 'arena.json');
    await writeFile(
      configPath,
      JSON.stringify({
        providers: {
          'test-provider': {
            command: 'test-cmd',
            promptDelivery: 'flag',
            promptFlag: '--prompt',
            exitCommand: '/quit'
          }
        },
        variants: [
          {
            name: 'v1',
            provider: 'test-provider',
            model: 'test-model',
            techStack: 'TypeScript',
            designPhilosophy: 'Test'
          }
        ]
      })
    );

    const config = await loadArenaConfig(configPath);
    expect(config.providers['test-provider']?.promptFlag).toBe('--prompt');
  });
});
