import { describe, expect, it } from 'vitest';
import { buildArenaInstructions, buildLaunchPrompt, buildStatusCheckPrompt } from './builder';

describe('prompt builder', () => {
  it('renders arena instructions with variant constraints and envelope signals', () => {
    const instructions = buildArenaInstructions({
      name: 'ink',
      provider: 'copilot-cli',
      model: 'gpt-5',
      techStack: 'TypeScript + Ink',
      designPhilosophy: 'Composable UI',
      branch: 'variant/ink'
    });

    expect(instructions).toContain('TypeScript + Ink');
    expect(instructions).toContain('Composable UI');
    expect(instructions).toContain('<<<ARENA_SIGNAL:{"status":"done"}>>>');
    expect(instructions).toContain('<<<ARENA_SIGNAL:{"status":"continue"}>>>');
    expect(instructions).toContain('orchestrator verifies your work');
  });

  it('does not contain legacy marker references', () => {
    const instructions = buildArenaInstructions({
      name: 'test',
      provider: 'copilot-cli',
      model: 'gpt-5',
      techStack: 'TypeScript',
      designPhilosophy: 'Test',
      branch: 'variant/test'
    });

    expect(instructions).not.toContain('ARENA_DONE');
    expect(instructions).not.toContain('ARENA_CONTINUING');
  });

  it('builds launch prompt', () => {
    expect(buildLaunchPrompt()).toMatch(/Read \.arena\/REQUIREMENTS\.md/);
  });

  it('builds status check prompt with envelope format', () => {
    const prompt = buildStatusCheckPrompt();
    expect(prompt).toContain('<<<ARENA_SIGNAL:{"status":"done"}>>>');
    expect(prompt).toContain('<<<ARENA_SIGNAL:{"status":"continue"}>>>');
  });
});
