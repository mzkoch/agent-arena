import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, loadRequirements, resolveWorktreeDir, resolveRepoPath } from '../config/loader.js';

describe('Config Loader', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arena-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should load a valid config file', async () => {
    const config = {
      repoName: 'test-arena',
      variants: [
        {
          name: 'node-test',
          model: 'test-model',
          techStack: 'Node.js',
          designPhilosophy: 'Simple',
        },
      ],
    };
    const configPath = path.join(tmpDir, 'arena.json');
    await fs.writeFile(configPath, JSON.stringify(config));

    const result = await loadConfig(configPath);
    expect(result.repoName).toBe('test-arena');
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0].name).toBe('node-test');
    expect(result.variants[0].provider).toBe('copilot-cli'); // default
    expect(result.maxContinues).toBe(50); // default
  });

  it('should reject config with missing repoName', async () => {
    const config = {
      variants: [
        { name: 'test', model: 'm', techStack: 't', designPhilosophy: 'd' },
      ],
    };
    const configPath = path.join(tmpDir, 'arena.json');
    await fs.writeFile(configPath, JSON.stringify(config));

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it('should reject config with duplicate variant names', async () => {
    const config = {
      repoName: 'test',
      variants: [
        { name: 'same', model: 'm', techStack: 't', designPhilosophy: 'd' },
        { name: 'same', model: 'm2', techStack: 't2', designPhilosophy: 'd2' },
      ],
    };
    const configPath = path.join(tmpDir, 'arena.json');
    await fs.writeFile(configPath, JSON.stringify(config));

    await expect(loadConfig(configPath)).rejects.toThrow('Variant names must be unique');
  });

  it('should reject invalid variant names', async () => {
    const config = {
      repoName: 'test',
      variants: [
        { name: 'Invalid Name!', model: 'm', techStack: 't', designPhilosophy: 'd' },
      ],
    };
    const configPath = path.join(tmpDir, 'arena.json');
    await fs.writeFile(configPath, JSON.stringify(config));

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it('should load requirements from a markdown file', async () => {
    const content = '# My Requirements\n\nBuild a thing.';
    const reqPath = path.join(tmpDir, 'requirements.md');
    await fs.writeFile(reqPath, content);

    const result = await loadRequirements(reqPath);
    expect(result).toBe(content);
  });
});

describe('Path Resolution', () => {
  it('should resolve worktree dir with default', () => {
    const config = {
      repoName: 'my-project',
      maxContinues: 50,
      variants: [{ name: 'a', provider: 'copilot-cli', model: 'm', techStack: 't', designPhilosophy: 'd' }],
    };
    const result = resolveWorktreeDir(config, '/base');
    expect(result).toBe(path.resolve('/base', 'my-project-worktrees'));
  });

  it('should resolve worktree dir with custom path', () => {
    const config = {
      repoName: 'my-project',
      worktreeDir: '/custom/path',
      maxContinues: 50,
      variants: [{ name: 'a', provider: 'copilot-cli', model: 'm', techStack: 't', designPhilosophy: 'd' }],
    };
    const result = resolveWorktreeDir(config, '/base');
    expect(result).toBe(path.resolve('/custom/path'));
  });
});
