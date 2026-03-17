import { access, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { discoverArenaConfig, findGitRoot, loadArenaConfig, resolveArenaPaths } from './load';

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
      branch: 'arena/node-cli'
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
  it('resolves all paths within the .arena/ directory', () => {
    const gitRoot = '/tmp/my-project';
    const configPath = '/tmp/my-project/.arena/arena.json';
    const requirementsPath = '/tmp/my-project/.arena/requirements.md';
    const paths = resolveArenaPaths(gitRoot, configPath, requirementsPath);

    expect(paths.gitRoot).toBe('/tmp/my-project');
    expect(paths.arenaDir).toBe(path.join('/tmp/my-project', '.arena'));
    expect(paths.worktreeDir).toBe(path.join('/tmp/my-project', '.arena', 'worktrees'));
    expect(paths.sessionFilePath).toBe(path.join('/tmp/my-project', '.arena', 'session.json'));
    expect(paths.logDir).toBe(path.join('/tmp/my-project', '.arena', 'logs'));
    expect(paths.reportPath).toBe(path.join('/tmp/my-project', '.arena', 'comparison-report.md'));
  });
});

describe('findGitRoot', () => {
  it('throws when not in a git repository', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-nogit-'));
    await expect(findGitRoot(tempDir)).rejects.toThrow(/not inside a git repository/i);
  });
});

describe('discoverArenaConfig', () => {
  it('discovers .arena/arena.json from a git repository', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-discover-'));
    await execFileAsync('git', ['init', tempDir]);
    const arenaDir = path.join(tempDir, '.arena');
    const configPath = path.join(arenaDir, 'arena.json');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(arenaDir, { recursive: true });
    await writeFile(configPath, '{}');

    const discovered = await discoverArenaConfig(tempDir);
    const { realpath: rp } = await import('node:fs/promises');
    expect(await rp(discovered)).toBe(await rp(configPath));
  });

  it('throws when .arena/arena.json does not exist', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-discover-'));
    await execFileAsync('git', ['init', tempDir]);

    await expect(discoverArenaConfig(tempDir)).rejects.toThrow(/no arena configuration found/i);
  });
});
