import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { EvaluationReport, EvaluationVariantMetrics, VariantWorkspace } from '../domain/types';
import { NodeCommandRunner } from '../git/command-runner';
import { GitRepositoryManager } from '../git/repository';
import { writeTextFile } from '../utils/files';
import { createNullLogger } from '../utils/logger';

const isTestFile = (filePath: string): boolean =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath) || filePath.includes('__tests__');

const toPortablePath = (value: string): string => value.split(path.sep).join('/');

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

const countLines = async (filePath: string): Promise<number> => {
  const content = await readFile(filePath);
  if (content.length === 0 || content.includes(0)) {
    return 0;
  }

  const text = content.toString('utf8');
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      count++;
    }
  }

  return count;
};

const parseNumStat = (stdout: string): { addedLineCount: number; deletedLineCount: number } =>
  stdout.split(/\r?\n/u).reduce(
    (totals, line) => {
      const [added, deleted] = line.split('\t');
      if (!added || !deleted || added === '-' || deleted === '-') {
        return totals;
      }

      return {
        addedLineCount: totals.addedLineCount + Number.parseInt(added, 10),
        deletedLineCount: totals.deletedLineCount + Number.parseInt(deleted, 10)
      };
    },
    { addedLineCount: 0, deletedLineCount: 0 }
  );

const collectVariantMetrics = async (
  workspace: VariantWorkspace,
  baseRef: string,
  baseFiles: Set<string>,
  git: GitRepositoryManager
): Promise<Omit<EvaluationVariantMetrics, 'score' | 'notes'>> => {
  const files = await walkFiles(workspace.worktreePath);
  const relativeFiles = files.map((filePath) => toPortablePath(path.relative(workspace.worktreePath, filePath)));

  const untrackedPaths = await git.getUntrackedFiles(workspace.worktreePath);
  const diffPaths = await git.getChangedFiles(workspace.worktreePath, baseRef);
  const numStatRaw = await git.getDiffNumStatRaw(workspace.worktreePath, baseRef);
  const { addedLineCount: trackedAddedLineCount, deletedLineCount: trackedDeletedLineCount } =
    parseNumStat(numStatRaw);
  const commitCount = await git.getCommitCountSinceRef(workspace.worktreePath, baseRef);

  let addedLineCount = trackedAddedLineCount;
  for (const untrackedPath of untrackedPaths) {
    addedLineCount += await countLines(path.join(workspace.worktreePath, untrackedPath));
  }

  const addedFiles = relativeFiles.filter((filePath) => !baseFiles.has(filePath));
  const changedPaths = new Set([...diffPaths, ...untrackedPaths]);
  const hasChanges = changedPaths.size > 0;

  return {
    name: workspace.variant.name,
    worktreePath: workspace.worktreePath,
    baseRef,
    hasChanges,
    commitCount,
    changedFileCount: changedPaths.size,
    addedLineCount,
    deletedLineCount: trackedDeletedLineCount,
    newTestFileCount: addedFiles.filter(isTestFile).length,
    fileCount: files.length,
    testFileCount: relativeFiles.filter(isTestFile).length,
    hasReadme: relativeFiles.some((filePath) => path.basename(filePath).toLowerCase() === 'readme.md'),
    hasDesignDoc: relativeFiles.some((filePath) => path.basename(filePath).toLowerCase() === 'design.md'),
    readmeChanged: [...changedPaths].some((filePath) => path.basename(filePath).toLowerCase() === 'readme.md'),
    designDocChanged: [...changedPaths].some((filePath) => path.basename(filePath).toLowerCase() === 'design.md')
  };
};

export const scoreVariant = (metrics: Omit<EvaluationVariantMetrics, 'score' | 'notes'>): EvaluationVariantMetrics => {
  const notes: string[] = [];
  notes.push(`Compared against ${metrics.baseRef}`);
  notes.push(`${metrics.commitCount} commits ahead of ${metrics.baseRef}`);

  if (!metrics.hasChanges) {
    notes.push(`No changes detected relative to ${metrics.baseRef}`);
    if (metrics.commitCount > 0) {
      notes.push('Branch has commits ahead of the baseline, but its net diff is zero');
    }

    return {
      ...metrics,
      score: 0,
      notes
    };
  }

  let score = 0;
  score += Math.min(metrics.changedFileCount * 4, 40);
  score += Math.min(metrics.commitCount * 5, 15);
  score += Math.min(Math.floor((metrics.addedLineCount + metrics.deletedLineCount) / 10), 15);
  score += Math.min(metrics.newTestFileCount * 12, 24);
  if (metrics.readmeChanged) {
    score += 3;
  }
  if (metrics.designDocChanged) {
    score += 3;
  }

  notes.push(`${metrics.changedFileCount} changed files detected`);
  notes.push(`${metrics.addedLineCount} lines added, ${metrics.deletedLineCount} lines deleted`);
  if (metrics.newTestFileCount === 0) {
    notes.push('No new test files added');
  } else {
    notes.push(`${metrics.newTestFileCount} new test files added`);
  }
  notes.push(metrics.hasReadme ? 'README present' : 'README missing');
  notes.push(metrics.hasDesignDoc ? 'DESIGN.md present' : 'DESIGN.md missing');
  notes.push(metrics.readmeChanged ? 'README changed' : 'README unchanged');
  notes.push(metrics.designDocChanged ? 'DESIGN.md changed' : 'DESIGN.md unchanged');

  return {
    ...metrics,
    score: Math.min(score, 100),
    notes
  };
};

export const evaluateWorkspaces = async (
  gitRoot: string,
  workspaces: VariantWorkspace[],
  git?: GitRepositoryManager
): Promise<EvaluationReport> => {
  const manager = git ?? new GitRepositoryManager(new NodeCommandRunner(), createNullLogger());
  const baseRef = await manager.resolveBaseRef(gitRoot);
  const baseFiles = await manager.listTreeFiles(gitRoot, baseRef);
  const variants = await Promise.all(
    workspaces.map(async (workspace) => {
      const metrics = await collectVariantMetrics(workspace, baseRef, baseFiles, manager);
      return scoreVariant(metrics);
    })
  );

  const winner =
    [...variants]
      .filter((variant) => variant.hasChanges)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.newTestFileCount - left.newTestFileCount ||
          right.changedFileCount - left.changedFileCount ||
          right.commitCount - left.commitCount ||
          left.name.localeCompare(right.name)
      )[0]?.name ?? 'n/a';
  const markdown = renderComparisonReport(gitRoot, baseRef, variants, winner);

  return {
    generatedAt: new Date().toISOString(),
    gitRoot,
    baseRef,
    winner,
    variants,
    markdown
  };
};

export const renderComparisonReport = (
  gitRoot: string,
  baseRef: string,
  variants: EvaluationVariantMetrics[],
  winner: string
): string => `# Comparison Report

Generated: ${new Date().toISOString()}

Repository: \`${gitRoot}\`
Baseline: \`${baseRef}\`

Recommended winner: **${winner}**

| Variant | Status | Score | Commits | Changed Files | +Lines | -Lines | New Tests |
|---------|:------:|------:|--------:|--------------:|-------:|-------:|----------:|
${variants
  .map(
    (variant) =>
      `| ${variant.name} | ${variant.hasChanges ? 'Changed' : 'No changes'} | ${variant.score} | ${
        variant.commitCount
      } | ${variant.changedFileCount} | ${variant.addedLineCount} | ${variant.deletedLineCount} | ${
        variant.newTestFileCount
      } |`
  )
  .join('\n')}

## Variant Details

${variants
  .map(
    (variant) => `### ${variant.name}

- Worktree: \`${variant.worktreePath}\`
- Baseline: \`${variant.baseRef}\`
- Status: ${variant.hasChanges ? 'Produced changes' : 'No changes detected'}
- Score: ${variant.score}
- Commits ahead: ${variant.commitCount}
- Changed files: ${variant.changedFileCount}
- Line delta: +${variant.addedLineCount} / -${variant.deletedLineCount}
- New test files: ${variant.newTestFileCount}
- README: ${variant.hasReadme ? 'Present' : 'Missing'}${variant.readmeChanged ? ' (changed)' : ''}
- DESIGN.md: ${variant.hasDesignDoc ? 'Present' : 'Missing'}${variant.designDocChanged ? ' (changed)' : ''}
- Notes:
${variant.notes.map((note) => `  - ${note}`).join('\n')}`
  )
  .join('\n\n')}
`;

export const writeComparisonReport = async (
  reportPath: string,
  report: EvaluationReport
): Promise<string> => {
  await writeTextFile(reportPath, report.markdown);
  return reportPath;
};
