import { access, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { initializeArena, isArenaInitialized, loadRuntimeContext, removeSessionFile } from './runtime';

const logger = {
  debug() {},
  info() {},
  warn() {},
  error() {}
};

describe('cli runtime helpers', () => {
  it('loads runtime context and initializes an arena repo', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-runtime-'));
    const configPath = path.join(tempDir, 'arena.json');
    const requirementsPath = path.join(tempDir, 'REQUIREMENTS.md');

    await writeFile(
      configPath,
      JSON.stringify({
        repoName: 'demo-repo',
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

    const context = await loadRuntimeContext(configPath, requirementsPath, logger);
    expect(context.requirementsContent).toBe('# Requirements');
    expect(await isArenaInitialized(context.paths)).toBe(false);

    await initializeArena(context);
    expect(await isArenaInitialized(context.paths)).toBe(true);

    const worktreeRequirements = await readFile(
      path.join(context.workspaces[0]!.worktreePath, 'REQUIREMENTS.md'),
      'utf8'
    );
    expect(worktreeRequirements).toContain('# Requirements');
  });

  it('removes session files', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-runtime-'));
    const sessionFile = path.join(tempDir, '.arena-session.json');
    await writeFile(sessionFile, '{}');
    await removeSessionFile(sessionFile);
    await expect(access(sessionFile)).rejects.toThrow();
  });
});
