import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ProviderConfig, VariantConfig } from '../domain/types';
import { ProviderRegistry, buildProviderCommand } from './registry';
import { saveModelCache } from './model-cache';

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
    responseTimeoutMs: 1
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

  it('includes maxContinuesFlag in args for copilot-cli', () => {
    const registry = new ProviderRegistry();
    const provider = registry.get('copilot-cli');
    const copilotVariant: VariantConfig = {
      name: 'test',
      provider: 'copilot-cli',
      model: 'gpt-5',
      techStack: 'TypeScript',
      designPhilosophy: 'Clean',
      branch: 'variant/test'
    };
    const command = buildProviderCommand(provider, copilotVariant, 'hello', 25);
    expect(command.args).toContain('--max-autopilot-continues');
    expect(command.args).toContain('25');
    const flagIdx = command.args.indexOf('--max-autopilot-continues');
    expect(command.args[flagIdx + 1]).toBe('25');
  });

  it('omits maxContinuesFlag when provider does not define it', () => {
    const providerWithoutFlag: ProviderConfig = {
      ...baseProvider,
      maxContinuesFlag: undefined
    };
    const command = buildProviderCommand(providerWithoutFlag, variant, 'hello', 10);
    expect(command.args).not.toContain('--max-steps');
    expect(command.args).not.toContain('10');
  });

  it('discovers models via registry method using cache', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'registry-disc-'));
    const arenaDir = path.join(tempDir, '.arena');
    await mkdir(arenaDir, { recursive: true });

    const cachePath = path.join(arenaDir, '.model-cache.json');
    await saveModelCache(cachePath, {
      'copilot-cli': {
        models: ['gpt-5', 'gpt-5.1'],
        discoveredAt: new Date().toISOString(),
        ttlMs: 3600000
      }
    });

    const registry = new ProviderRegistry();
    const models = await registry.discoverModels('copilot-cli', cachePath);
    expect(models).toEqual(['gpt-5', 'gpt-5.1']);
  });

  it('validates model returns null for valid model', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'registry-val-'));
    const arenaDir = path.join(tempDir, '.arena');
    await mkdir(arenaDir, { recursive: true });

    const cachePath = path.join(arenaDir, '.model-cache.json');
    await saveModelCache(cachePath, {
      'copilot-cli': {
        models: ['gpt-5', 'gpt-5.1'],
        discoveredAt: new Date().toISOString(),
        ttlMs: 3600000
      }
    });

    const registry = new ProviderRegistry();
    const error = await registry.validateModel('copilot-cli', 'gpt-5', cachePath);
    expect(error).toBeNull();
  });

  it('validates model returns error for invalid model', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'registry-val-'));
    const arenaDir = path.join(tempDir, '.arena');
    await mkdir(arenaDir, { recursive: true });

    const cachePath = path.join(arenaDir, '.model-cache.json');
    await saveModelCache(cachePath, {
      'copilot-cli': {
        models: ['gpt-5', 'gpt-5.1'],
        discoveredAt: new Date().toISOString(),
        ttlMs: 3600000
      }
    });

    const registry = new ProviderRegistry();
    const error = await registry.validateModel('copilot-cli', 'bad-model', cachePath);
    expect(error).toContain('Invalid model "bad-model"');
    expect(error).toContain('copilot-cli');
  });

  it('findClosestModel returns closest match', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'registry-close-'));
    const arenaDir = path.join(tempDir, '.arena');
    await mkdir(arenaDir, { recursive: true });

    const cachePath = path.join(arenaDir, '.model-cache.json');
    await saveModelCache(cachePath, {
      'copilot-cli': {
        models: ['gpt-5', 'gemini-3-pro-preview'],
        discoveredAt: new Date().toISOString(),
        ttlMs: 3600000
      }
    });

    const registry = new ProviderRegistry();
    const closest = await registry.findClosestModel('copilot-cli', 'gemini-3-pro', cachePath);
    expect(closest).toBe('gemini-3-pro-preview');
  });
});
