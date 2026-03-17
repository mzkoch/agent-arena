import { describe, expect, it } from 'vitest';
import type { ProviderConfig, VariantConfig } from '../domain/types';
import { ProviderRegistry, buildProviderCommand } from './registry';

const variant: VariantConfig = {
  name: 'demo',
  provider: 'custom',
  model: 'gpt-5',
  techStack: 'TypeScript',
  designPhilosophy: 'Testable',
  branch: 'variant/demo'
};

const baseProvider: ProviderConfig = {
  command: 'custom-cli',
  baseArgs: ['--safe'],
  promptDelivery: 'flag',
  promptFlag: '--prompt',
  modelFlag: '--model',
  maxContinuesFlag: '--max-steps',
  exitCommand: '/exit',
  completionProtocol: {
    idleTimeoutMs: 1,
    maxChecks: 1,
    responseTimeoutMs: 1,
    doneMarker: 'DONE',
    continueMarker: 'CONT'
  }
};

describe('ProviderRegistry', () => {
  it('includes built-in providers', () => {
    const registry = new ProviderRegistry();
    expect(registry.get('copilot-cli').command).toBe('copilot');
    expect(registry.list()).toContain('claude-code');
  });

  it('allows custom overrides', () => {
    const registry = new ProviderRegistry({
      'copilot-cli': baseProvider
    });
    expect(registry.get('copilot-cli').command).toBe('custom-cli');
  });

  it('builds commands for flag delivery', () => {
    const command = buildProviderCommand(baseProvider, variant, 'hello', 12);
    expect(command).toEqual({
      command: 'custom-cli',
      args: ['--safe', '--model', 'gpt-5', '--max-steps', '12', '--prompt', 'hello']
    });
  });

  it('builds commands for positional and stdin delivery', () => {
    const positional = buildProviderCommand(
      { ...baseProvider, promptDelivery: 'positional', promptFlag: undefined },
      variant,
      'hello',
      5
    );
    const stdin = buildProviderCommand(
      { ...baseProvider, promptDelivery: 'stdin', promptFlag: undefined },
      variant,
      'hello',
      5
    );

    expect(positional.args.at(-1)).toBe('hello');
    expect(stdin.stdinPayload).toBe('hello\n');
  });
});
