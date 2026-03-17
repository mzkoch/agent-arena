import type { VariantEvaluation } from './evaluator.js';

/**
 * Generate a markdown comparison report from evaluation results.
 */
export function generateReport(evaluations: VariantEvaluation[]): string {
  const sorted = [...evaluations].sort((a, b) => b.score - a.score);
  const winner = sorted[0];

  let md = '# Arena Comparison Report\n\n';
  md += `Generated: ${new Date().toISOString()}\n\n`;

  // Summary table
  md += '## Results\n\n';
  md += '| Variant | Files | Tests | Docker | README | DESIGN.md | Score |\n';
  md += '|---------|-------|-------|--------|--------|-----------|-------|\n';

  for (const ev of sorted) {
    const docker = ev.hasDockerfile || ev.hasDockerCompose ? '✅' : '❌';
    const readme = ev.hasReadme ? '✅' : '❌';
    const design = ev.hasDesignDoc ? '✅' : '❌';
    md += `| ${ev.variantName} | ${ev.fileCount} | ${ev.testFileCount} | ${docker} | ${readme} | ${design} | **${ev.score}** |\n`;
  }

  md += '\n';

  // Recommendation
  if (sorted.length > 0) {
    md += '## Recommendation\n\n';
    if (sorted.length === 1) {
      md += `**${winner.variantName}** is the only variant with a score of **${winner.score}**.\n`;
    } else {
      const runnerUp = sorted[1];
      const margin = winner.score - runnerUp.score;
      md += `**${winner.variantName}** leads with a score of **${winner.score}**`;
      if (margin > 0) {
        md += ` (${margin} points ahead of ${runnerUp.variantName})`;
      } else {
        md += ` (tied with ${runnerUp.variantName})`;
      }
      md += '.\n';
    }
  }

  md += '\n## Details\n\n';

  for (const ev of sorted) {
    md += `### ${ev.variantName}\n\n`;
    md += `- **Path**: \`${ev.worktreePath}\`\n`;
    md += `- **Files**: ${ev.fileCount}\n`;
    md += `- **Test files**: ${ev.testFileCount}\n`;
    md += `- **Docker**: ${ev.hasDockerfile || ev.hasDockerCompose ? 'Yes' : 'No'}\n`;
    md += `- **README**: ${ev.hasReadme ? 'Yes' : 'No'}\n`;
    md += `- **Design Doc**: ${ev.hasDesignDoc ? 'Yes' : 'No'}\n`;
    md += `- **Score**: ${ev.score}\n\n`;
  }

  return md;
}
