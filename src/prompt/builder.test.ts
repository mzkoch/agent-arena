import { describe, expect, it } from 'vitest';
import { buildArenaInstructions, buildLaunchPrompt, buildStatusCheckPrompt } from './builder';

describe('prompt builder', () => {
  it('renders arena instructions with variant constraints and markers', () => {
    const instructions = buildArenaInstructions(
      {
        name: 'ink',
        provider: 'copilot-cli',
        model: 'gpt-5',
        techStack: 'TypeScript + Ink',
        designPhilosophy: 'Composable UI',
        branch: 'variant/ink'
      },
      {
        idleTimeoutMs: 1,
        maxChecks: 1,
        responseTimeoutMs: 1,
        doneMarker: 'ARENA_DONE',
        continueMarker: 'ARENA_CONTINUING'
      }
    );

    expect(instructions).toContain('TypeScript + Ink');
    expect(instructions).toContain('Composable UI');
    expect(instructions).toContain('ARENA_DONE');
  });

  it('builds launch and status prompts', () => {
    expect(buildLaunchPrompt()).toMatch(/Read REQUIREMENTS\.md/);
    expect(
      buildStatusCheckPrompt({
        idleTimeoutMs: 1,
        maxChecks: 1,
        responseTimeoutMs: 1,
        doneMarker: 'DONE',
        continueMarker: 'CONT'
      })
    ).toContain('DONE');
  });
});
