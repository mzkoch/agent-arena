import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { writePromptFiles, buildInitialPrompt } from '../orchestrator/prompt-builder.js';
import type { Variant } from '../config/types.js';
import type { CompletionProtocol } from '../providers/types.js';

describe('Prompt Builder', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arena-prompt-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const mockVariant: Variant = {
    name: 'test-variant',
    provider: 'copilot-cli',
    model: 'test-model',
    techStack: 'Node.js with Express',
    designPhilosophy: 'Keep it simple',
  };

  const mockProtocol: CompletionProtocol = {
    idleTimeoutMs: 30000,
    maxChecks: 3,
    responseTimeoutMs: 60000,
    doneMarker: 'ARENA_DONE',
    continueMarker: 'ARENA_CONTINUING',
  };

  it('should write REQUIREMENTS.md to worktree', async () => {
    const requirements = '# Test Requirements\n\nBuild something cool.';
    await writePromptFiles(tmpDir, requirements, mockVariant, mockProtocol);

    const content = await fs.readFile(path.join(tmpDir, 'REQUIREMENTS.md'), 'utf-8');
    expect(content).toBe(requirements);
  });

  it('should write ARENA-INSTRUCTIONS.md with variant config and completion protocol', async () => {
    await writePromptFiles(tmpDir, 'reqs', mockVariant, mockProtocol);

    const content = await fs.readFile(path.join(tmpDir, 'ARENA-INSTRUCTIONS.md'), 'utf-8');
    expect(content).toContain('Node.js with Express');
    expect(content).toContain('Keep it simple');
    expect(content).toContain('ARENA_DONE');
    expect(content).toContain('ARENA_CONTINUING');
  });

  it('should return a short initial prompt', () => {
    const prompt = buildInitialPrompt();
    expect(prompt).toContain('REQUIREMENTS.md');
    expect(prompt).toContain('ARENA-INSTRUCTIONS.md');
    expect(prompt.length).toBeLessThan(200);
  });
});
