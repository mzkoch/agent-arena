import { describe, it, expect } from 'vitest';
import { buildProviderRegistry, getProvider } from '../providers/registry.js';

describe('Provider Registry', () => {
  it('should include built-in copilot-cli provider', () => {
    const registry = buildProviderRegistry();
    const provider = getProvider(registry, 'copilot-cli');
    expect(provider.command).toBe('copilot');
    expect(provider.baseArgs).toContain('--autopilot');
    expect(provider.baseArgs).toContain('--yolo');
    expect(provider.promptDelivery).toBe('flag');
    expect(provider.promptFlag).toBe('-i');
  });

  it('should include built-in claude-code provider', () => {
    const registry = buildProviderRegistry();
    const provider = getProvider(registry, 'claude-code');
    expect(provider.command).toBe('claude');
    expect(provider.baseArgs).toContain('--dangerously-skip-permissions');
    expect(provider.promptDelivery).toBe('positional');
  });

  it('should merge user-defined providers', () => {
    const userProviders = {
      'custom-agent': {
        command: 'my-agent',
        baseArgs: ['--auto'],
        modelFlag: '--model',
        promptDelivery: 'stdin',
        exitCommand: '/quit',
      },
    };
    const registry = buildProviderRegistry(userProviders);
    const provider = getProvider(registry, 'custom-agent');
    expect(provider.command).toBe('my-agent');
    expect(provider.promptDelivery).toBe('stdin');
  });

  it('should allow user providers to override built-ins', () => {
    const userProviders = {
      'copilot-cli': {
        command: 'copilot-beta',
        baseArgs: ['--autopilot'],
        modelFlag: '--model',
        promptDelivery: 'flag',
        promptFlag: '-i',
        exitCommand: '/exit',
      },
    };
    const registry = buildProviderRegistry(userProviders);
    const provider = getProvider(registry, 'copilot-cli');
    expect(provider.command).toBe('copilot-beta');
  });

  it('should throw for unknown provider', () => {
    const registry = buildProviderRegistry();
    expect(() => getProvider(registry, 'nonexistent')).toThrow('Unknown agent provider');
  });
});
