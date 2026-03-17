import fs from 'node:fs/promises';
import path from 'node:path';

const EXCLUDED_DIRS = new Set([
  'node_modules', '__pycache__', '.git', 'target', 'dist',
  '.next', '.nuxt', 'build', 'vendor', '.venv', 'venv',
]);

export interface VariantEvaluation {
  variantName: string;
  worktreePath: string;
  fileCount: number;
  testFileCount: number;
  hasDockerfile: boolean;
  hasDockerCompose: boolean;
  hasReadme: boolean;
  hasDesignDoc: boolean;
  score: number;
}

/**
 * Recursively count files, excluding common build/dependency directories.
 */
async function countFiles(dir: string): Promise<{ total: number; testFiles: number }> {
  let total = 0;
  let testFiles = 0;

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await countFiles(fullPath);
      total += sub.total;
      testFiles += sub.testFiles;
    } else if (entry.isFile()) {
      total++;
      const lower = entry.name.toLowerCase();
      if (
        lower.includes('test') ||
        lower.includes('spec') ||
        lower.startsWith('test_')
      ) {
        testFiles++;
      }
    }
  }

  return { total, testFiles };
}

/**
 * Check if a file exists in the given directory.
 */
async function fileExists(dir: string, filename: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, filename));
    return true;
  } catch {
    return false;
  }
}

/**
 * Evaluate a single variant worktree.
 */
export async function evaluateVariant(
  variantName: string,
  worktreePath: string,
): Promise<VariantEvaluation> {
  const { total, testFiles } = await countFiles(worktreePath);

  const hasDockerfile = await fileExists(worktreePath, 'Dockerfile');
  const hasDockerCompose =
    (await fileExists(worktreePath, 'docker-compose.yml')) ||
    (await fileExists(worktreePath, 'docker-compose.yaml'));
  const hasReadme = await fileExists(worktreePath, 'README.md');
  const hasDesignDoc = await fileExists(worktreePath, 'DESIGN.md');

  // Simple scoring: files contribute 1pt each (max 50), test files 2pt each,
  // docker 10pt, readme 5pt, design doc 5pt
  const score =
    Math.min(total, 50) +
    testFiles * 2 +
    (hasDockerfile || hasDockerCompose ? 10 : 0) +
    (hasReadme ? 5 : 0) +
    (hasDesignDoc ? 5 : 0);

  return {
    variantName,
    worktreePath,
    fileCount: total,
    testFileCount: testFiles,
    hasDockerfile,
    hasDockerCompose,
    hasReadme,
    hasDesignDoc,
    score,
  };
}

/**
 * Evaluate all variants.
 */
export async function evaluateAll(
  variants: Array<{ name: string; worktreePath: string }>,
): Promise<VariantEvaluation[]> {
  const results: VariantEvaluation[] = [];
  for (const { name, worktreePath } of variants) {
    try {
      const evaluation = await evaluateVariant(name, worktreePath);
      results.push(evaluation);
    } catch (err) {
      results.push({
        variantName: name,
        worktreePath,
        fileCount: 0,
        testFileCount: 0,
        hasDockerfile: false,
        hasDockerCompose: false,
        hasReadme: false,
        hasDesignDoc: false,
        score: 0,
      });
    }
  }
  return results;
}
