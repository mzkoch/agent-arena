import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { evaluateWorkspaces, renderComparisonReport, scoreVariant } from './report';

const execFileAsync = promisify(execFile);

const createGitRepo = async (): Promise<string> => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-eval-'));
  await execFileAsync('git', ['init', '--initial-branch=main', tempDir]);
  await writeFile(path.join(tempDir, 'README.md'), '# Base');
  await writeFile(path.join(tempDir, 'DESIGN.md'), '# Design');
  await mkdir(path.join(tempDir, 'src'), { recursive: true });
  await writeFile(path.join(tempDir, 'src', 'app.ts'), 'export const value = 1;\n');
  await execFileAsync('git', ['-C', tempDir, 'add', '.']);
  await execFileAsync('git', [
    '-C',
    tempDir,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-m',
    'initial'
  ]);
  return tempDir;
};

describe('evaluation report', () => {
  it('scores changed variants based on actual diff metrics', () => {
    const scored = scoreVariant({
      name: 'demo',
      worktreePath: '/tmp/demo',
      baseRef: 'main',
      hasChanges: true,
      commitCount: 2,
      changedFileCount: 3,
      addedLineCount: 20,
      deletedLineCount: 4,
      newTestFileCount: 1,
      fileCount: 8,
      testFileCount: 2,
      hasReadme: true,
      hasDesignDoc: false,
      readmeChanged: true,
      designDocChanged: false
    });

    expect(scored.score).toBeGreaterThan(0);
    expect(scored.notes).toContain('Compared against main');
    expect(scored.notes).toContain('1 new test files added');
  });

  it('scores zero-diff variants as no changes', () => {
    const scored = scoreVariant({
      name: 'demo',
      worktreePath: '/tmp/demo',
      baseRef: 'main',
      hasChanges: false,
      commitCount: 0,
      changedFileCount: 0,
      addedLineCount: 0,
      deletedLineCount: 0,
      newTestFileCount: 0,
      fileCount: 8,
      testFileCount: 2,
      hasReadme: true,
      hasDesignDoc: true,
      readmeChanged: false,
      designDocChanged: false
    });

    expect(scored.score).toBe(0);
    expect(scored.notes).toContain('No changes detected relative to main');
  });

  it('notes zero-diff with commits ahead as net-zero diff', () => {
    const scored = scoreVariant({
      name: 'zero-net',
      worktreePath: '/tmp/zero-net',
      baseRef: 'main',
      hasChanges: false,
      commitCount: 3,
      changedFileCount: 0,
      addedLineCount: 0,
      deletedLineCount: 0,
      newTestFileCount: 0,
      fileCount: 5,
      testFileCount: 1,
      hasReadme: true,
      hasDesignDoc: true,
      readmeChanged: false,
      designDocChanged: false
    });

    expect(scored.score).toBe(0);
    expect(scored.notes).toContain('Branch has commits ahead of the baseline, but its net diff is zero');
  });

  it('awards bonus for designDocChanged', () => {
    const withDesignDoc = scoreVariant({
      name: 'with-design',
      worktreePath: '/tmp/with-design',
      baseRef: 'main',
      hasChanges: true,
      commitCount: 1,
      changedFileCount: 1,
      addedLineCount: 10,
      deletedLineCount: 0,
      newTestFileCount: 0,
      fileCount: 5,
      testFileCount: 0,
      hasReadme: false,
      hasDesignDoc: true,
      readmeChanged: false,
      designDocChanged: true
    });

    const withoutDesignDoc = scoreVariant({
      name: 'no-design',
      worktreePath: '/tmp/no-design',
      baseRef: 'main',
      hasChanges: true,
      commitCount: 1,
      changedFileCount: 1,
      addedLineCount: 10,
      deletedLineCount: 0,
      newTestFileCount: 0,
      fileCount: 5,
      testFileCount: 0,
      hasReadme: false,
      hasDesignDoc: false,
      readmeChanged: false,
      designDocChanged: false
    });

    expect(withDesignDoc.score).toBeGreaterThan(withoutDesignDoc.score);
    expect(withDesignDoc.notes).toContain('DESIGN.md changed');
    expect(withoutDesignDoc.notes).toContain('DESIGN.md unchanged');
    expect(withoutDesignDoc.notes).toContain('README missing');
    expect(withoutDesignDoc.notes).toContain('No new test files added');
  });

  it('evaluates workspaces and renders diff-aware markdown', async () => {
    const root = await createGitRepo();
    const worktreeRoot = path.join(root, '.arena', 'worktrees');
    const variantA = path.join(worktreeRoot, 'a');
    const variantB = path.join(worktreeRoot, 'b');
    await execFileAsync('git', ['-C', root, 'worktree', 'add', '-b', 'arena/a', variantA, 'main']);
    await execFileAsync('git', ['-C', root, 'worktree', 'add', '-b', 'arena/b', variantB, 'main']);

    await writeFile(path.join(variantA, 'README.md'), '# A\n');
    await writeFile(path.join(variantA, 'src', 'app.ts'), 'export const value = 2;\n');
    await writeFile(path.join(variantA, 'src', 'app.test.ts'), 'import { expect, it } from "vitest";\n');
    await execFileAsync('git', ['-C', variantA, 'add', '.']);
    await execFileAsync('git', [
      '-C',
      variantA,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-m',
      'variant a changes'
    ]);

    const report = await evaluateWorkspaces(root, [
      {
        variant: {
          name: 'a',
          provider: 'copilot-cli',
          model: 'gpt-5',
          techStack: 'TypeScript',
          designPhilosophy: 'A',
          branch: 'variant/a'
        },
        worktreePath: variantA
      },
      {
        variant: {
          name: 'b',
          provider: 'copilot-cli',
          model: 'gpt-5',
          techStack: 'TypeScript',
          designPhilosophy: 'B',
          branch: 'variant/b'
        },
        worktreePath: variantB
      }
    ]);

    expect(report.winner).toBe('a');
    expect(report.baseRef).toBe('main');

    const variantAReport = report.variants.find((variant) => variant.name === 'a');
    const variantBReport = report.variants.find((variant) => variant.name === 'b');

    expect(variantAReport).toBeDefined();
    expect(variantAReport?.hasChanges).toBe(true);
    expect(variantAReport?.commitCount).toBe(1);
    expect(variantAReport?.newTestFileCount).toBe(1);
    expect(variantBReport?.hasChanges).toBe(false);
    expect(variantBReport?.score).toBe(0);

    expect(renderComparisonReport(root, report.baseRef, report.variants, report.winner)).toContain(
      '| a | Changed |'
    );
    expect(renderComparisonReport(root, report.baseRef, report.variants, report.winner)).toContain(
      '| b | No changes |'
    );
  }, 30_000);

  it('treats untracked files as produced work', async () => {
    const root = await createGitRepo();
    const worktreeRoot = path.join(root, '.arena', 'worktrees');
    const variant = path.join(worktreeRoot, 'dirty');
    await execFileAsync('git', ['-C', root, 'worktree', 'add', '-b', 'arena/dirty', variant, 'main']);
    await writeFile(path.join(variant, 'src', 'new-feature.test.ts'), 'export const testValue = true;\n');

    const report = await evaluateWorkspaces(root, [
      {
        variant: {
          name: 'dirty',
          provider: 'copilot-cli',
          model: 'gpt-5',
          techStack: 'TypeScript',
          designPhilosophy: 'Dirty',
          branch: 'arena/dirty'
        },
        worktreePath: variant
      }
    ]);

    expect(report.winner).toBe('dirty');
    expect(report.variants[0]?.hasChanges).toBe(true);
    expect(report.variants[0]?.newTestFileCount).toBe(1);
    expect(report.variants[0]?.score).toBeGreaterThan(0);
  }, 30_000);
});
