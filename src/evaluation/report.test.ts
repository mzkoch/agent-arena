import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateWorkspaces, renderComparisonReport, scoreVariant } from './report';

describe('evaluation report', () => {
  it('scores variants based on docs and tests', () => {
    const scored = scoreVariant({
      name: 'demo',
      worktreePath: '/tmp/demo',
      fileCount: 8,
      testFileCount: 2,
      hasReadme: true,
      hasDesignDoc: false
    });

    expect(scored.score).toBeGreaterThan(0);
    expect(scored.notes).toContain('README present');
    expect(scored.notes).toContain('DESIGN.md missing');
  });

  it('evaluates workspaces and renders markdown', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'arena-eval-'));
    const variantA = path.join(root, 'a');
    const variantB = path.join(root, 'b');
    await mkdir(variantA, { recursive: true });
    await mkdir(variantB, { recursive: true });
    await writeFile(path.join(variantA, 'README.md'), '# A');
    await writeFile(path.join(variantA, 'DESIGN.md'), '# D');
    await writeFile(path.join(variantA, 'app.test.ts'), 'test');
    await writeFile(path.join(variantB, 'index.ts'), 'export {};');

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
    expect(renderComparisonReport(root, report.variants, report.winner)).toContain('Recommended winner');
  });
});
