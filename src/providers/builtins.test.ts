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
});
