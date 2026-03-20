import { describe, expect, it } from 'vitest';
import { BUILTIN_PROVIDERS } from './builtins';

describe('BUILTIN_PROVIDERS', () => {
  it('copilot-cli has maxContinuesFlag set to --max-autopilot-continues', () => {
    const provider = BUILTIN_PROVIDERS['copilot-cli'];
    expect(provider).toBeDefined();
    expect(provider!.maxContinuesFlag).toBe('--max-autopilot-continues');
  });

  it('all providers with --autopilot baseArg have maxContinuesFlag defined', () => {
    for (const [name, provider] of Object.entries(BUILTIN_PROVIDERS)) {
      if (provider.baseArgs.includes('--autopilot')) {
        expect(
          provider.maxContinuesFlag,
          `Provider "${name}" uses --autopilot but is missing maxContinuesFlag`
        ).toBeDefined();
        expect(
          typeof provider.maxContinuesFlag,
          `Provider "${name}" maxContinuesFlag should be a string`
        ).toBe('string');
      }
    }
  });

  it('copilot-cli uses prompt-models discovery strategy', () => {
    const provider = BUILTIN_PROVIDERS['copilot-cli'];
    expect(provider!.modelDiscovery).toBeDefined();
    expect(provider!.modelDiscovery!.parseStrategy).toBe('prompt-models');
    expect(provider!.modelDiscovery!.command).toBe('copilot');
    expect(provider!.modelDiscovery!.args).toContain('-p');
  });

  it('claude-code uses prompt-models discovery strategy', () => {
    const provider = BUILTIN_PROVIDERS['claude-code'];
    expect(provider!.modelDiscovery).toBeDefined();
    expect(provider!.modelDiscovery!.parseStrategy).toBe('prompt-models');
    expect(provider!.modelDiscovery!.command).toBe('claude');
    expect(provider!.modelDiscovery!.args).toContain('-p');
  });

  it('both providers share the same discovery prompt', () => {
    const copilot = BUILTIN_PROVIDERS['copilot-cli']!.modelDiscovery!;
    const claude = BUILTIN_PROVIDERS['claude-code']!.modelDiscovery!;
    // Both should use -p flag followed by the same prompt text
    expect(copilot.args[0]).toBe('-p');
    expect(claude.args[0]).toBe('-p');
    expect(copilot.args[1]).toBe(claude.args[1]);
  });
});
