import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { EvaluationReport, EvaluationVariantMetrics, VariantWorkspace } from '../domain/types';
import { writeTextFile } from '../utils/files';

const isTestFile = (filePath: string): boolean =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath) || filePath.includes('__tests__');

const walkFiles = async (directoryPath: string): Promise<string[]> => {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === '.git') {
      continue;
    }

    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(entryPath)));
    } else {
      files.push(entryPath);
    }
  }

  return files;
};

export const scoreVariant = (metrics: Omit<EvaluationVariantMetrics, 'score' | 'notes'>): EvaluationVariantMetrics => {
  const notes: string[] = [];
  let score = Math.min(metrics.fileCount, 20);

  score += metrics.testFileCount * 3;
  if (metrics.hasReadme) {
    score += 10;
    notes.push('README present');
  } else {
    notes.push('README missing');
  }

  if (metrics.hasDesignDoc) {
    score += 10;
    notes.push('DESIGN.md present');
  } else {
    notes.push('DESIGN.md missing');
  }

  if (metrics.testFileCount === 0) {
    notes.push('No test files detected');
  } else {
    notes.push(`${metrics.testFileCount} test files detected`);
  }

  return {
    ...metrics,
    score,
    notes
  };
};

export const evaluateWorkspaces = async (
  repoPath: string,
  workspaces: VariantWorkspace[]
): Promise<EvaluationReport> => {
  const variants = await Promise.all(
    workspaces.map(async (workspace) => {
      const files = await walkFiles(workspace.worktreePath);
      return scoreVariant({
        name: workspace.variant.name,
        worktreePath: workspace.worktreePath,
        fileCount: files.length,
        testFileCount: files.filter(isTestFile).length,
        hasReadme: files.some((filePath) => path.basename(filePath).toLowerCase() === 'readme.md'),
        hasDesignDoc: files.some((filePath) => path.basename(filePath).toLowerCase() === 'design.md')
      });
    })
  );

  const winner = [...variants].sort((left, right) => right.score - left.score)[0]?.name ?? 'n/a';
  const markdown = renderComparisonReport(repoPath, variants, winner);

  return {
    generatedAt: new Date().toISOString(),
    repoPath,
    winner,
    variants,
    markdown
  };
};

export const renderComparisonReport = (
  repoPath: string,
  variants: EvaluationVariantMetrics[],
  winner: string
): string => `# Comparison Report

Generated: ${new Date().toISOString()}

Repository: \`${repoPath}\`

Recommended winner: **${winner}**

| Variant | Score | Files | Tests | README | DESIGN |
|---------|------:|------:|------:|:------:|:------:|
${variants
  .map(
    (variant) =>
      `| ${variant.name} | ${variant.score} | ${variant.fileCount} | ${variant.testFileCount} | ${
        variant.hasReadme ? 'Yes' : 'No'
      } | ${variant.hasDesignDoc ? 'Yes' : 'No'} |`
  )
  .join('\n')}

## Variant Details

${variants
  .map(
    (variant) => `### ${variant.name}

- Worktree: \`${variant.worktreePath}\`
- Score: ${variant.score}
- Notes:
${variant.notes.map((note) => `  - ${note}`).join('\n')}`
  )
  .join('\n\n')}
`;

export const writeComparisonReport = async (
  repoPath: string,
  report: EvaluationReport
): Promise<string> => {
  const outputPath = path.join(repoPath, 'comparison-report.md');
  await writeTextFile(outputPath, report.markdown);
  return outputPath;
};
