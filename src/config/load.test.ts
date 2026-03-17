import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadArenaConfig, resolveArenaPaths } from './load';

describe('loadArenaConfig', () => {
  it('applies defaults for provider, branch, and numeric fields', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-config-'));
    const configPath = path.join(tempDir, 'arena.json');
    await writeFile(
      configPath,
      JSON.stringify({
        repoName: 'demo',
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
      branch: 'variant/node-cli'
    });
  });

  it('rejects duplicated variant names with a clear message', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-config-'));
    const configPath = path.join(tempDir, 'arena.json');
    await writeFile(
      configPath,
      JSON.stringify({
        repoName: 'demo',
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

  it('resolves repo, worktree, and session paths', () => {
    const configPath = '/tmp/example/arena.json';
    const requirementsPath = '/tmp/example/requirements.md';
    const paths = resolveArenaPaths(configPath, requirementsPath, {
      repoName: 'demo',
      maxContinues: 50,
      agentTimeoutMs: 10,
      providers: {},
      variants: []
    });

    expect(paths.repoPath).toBe(path.resolve('/tmp/example', 'demo'));
    expect(paths.worktreeDir).toBe(path.resolve('/tmp/example', 'demo-worktrees'));
    expect(paths.sessionFilePath).toBe(path.resolve('/tmp/example', 'demo', '.arena-session.json'));
  });
});
