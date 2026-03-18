import { describe, expect, it, vi } from 'vitest';
import {
  parseChoicesFlag,
  discoverModels,
  discoverModelsFromConfig,
  levenshteinDistance,
  findClosestModel,
  buildModelValidationError,
  type CommandExecutor
} from './model-discovery';
import type { ProviderConfig, ModelDiscoveryConfig } from '../domain/types';
import { DEFAULT_COMPLETION_PROTOCOL } from './builtins';

const makeProvider = (overrides: Partial<ProviderConfig> = {}): ProviderConfig => ({
  command: 'test-cli',
  baseArgs: [],
  promptDelivery: 'positional',
  exitCommand: '/exit',
  completionProtocol: { ...DEFAULT_COMPLETION_PROTOCOL },
  ...overrides
});

describe('parseChoicesFlag', () => {
  it('extracts models from a standard --model choices line', () => {
    const output = '  --model <model>  (choices: "gpt-5", "claude-opus-4.6", "gemini-3-pro-preview")';
    expect(parseChoicesFlag(output)).toEqual(['gpt-5', 'claude-opus-4.6', 'gemini-3-pro-preview']);
  });

  it('handles multi-line choices output', () => {
    const output = `Usage: copilot [options]

  --model <model>  (choices: "gpt-5",
    "claude-opus-4.6",
    "gemini-3-pro-preview")

  --help  Show help`;
    expect(parseChoicesFlag(output)).toEqual(['gpt-5', 'claude-opus-4.6', 'gemini-3-pro-preview']);
  });

  it('returns empty array when no --model flag found', () => {
    expect(parseChoicesFlag('some random help output')).toEqual([]);
  });

  it('returns empty array when choices section has no quoted models', () => {
    const output = '--model <model>  (choices: )';
    expect(parseChoicesFlag(output)).toEqual([]);
  });

  it('handles single model in choices', () => {
    const output = '--model <model> (choices: "gpt-5")';
    expect(parseChoicesFlag(output)).toEqual(['gpt-5']);
  });
});

describe('discoverModels', () => {
  it('returns supportedModels when static list is provided', async () => {
    const provider = makeProvider({
      supportedModels: ['model-a', 'model-b']
    });
    const result = await discoverModels(provider);
    expect(result).toEqual(['model-a', 'model-b']);
  });

  it('returns null when no discovery config or supported models', async () => {
    const provider = makeProvider();
    const result = await discoverModels(provider);
    expect(result).toBeNull();
  });

  it('discovers models via command execution', async () => {
    const executor: CommandExecutor = vi.fn().mockResolvedValue({
      stdout: '--model <model> (choices: "gpt-5", "gpt-5.1")',
      stderr: ''
    });

    const provider = makeProvider({
      modelDiscovery: {
        command: 'copilot',
        args: ['--help'],
        parseStrategy: 'choices-flag'
      }
    });

    const result = await discoverModels(provider, executor);
    expect(result).toEqual(['gpt-5', 'gpt-5.1']);
    expect(executor).toHaveBeenCalledWith('copilot', ['--help'], { timeout: 5000 });
  });

  it('returns null when command fails (not found)', async () => {
    const executor: CommandExecutor = vi.fn().mockRejectedValue(new Error('ENOENT'));

    const provider = makeProvider({
      modelDiscovery: {
        command: 'nonexistent',
        args: ['--help'],
        parseStrategy: 'choices-flag'
      }
    });

    const result = await discoverModels(provider, executor);
    expect(result).toBeNull();
  });

  it('returns null for unknown parse strategy', async () => {
    const executor: CommandExecutor = vi.fn().mockResolvedValue({
      stdout: 'some output',
      stderr: ''
    });

    const provider = makeProvider({
      modelDiscovery: {
        command: 'test',
        args: [],
        parseStrategy: 'unknown-strategy'
      }
    });

    const result = await discoverModels(provider, executor);
    expect(result).toBeNull();
  });

  it('prefers supportedModels over modelDiscovery', async () => {
    const executor: CommandExecutor = vi.fn();
    const provider = makeProvider({
      supportedModels: ['static-model'],
      modelDiscovery: {
        command: 'test',
        args: ['--help'],
        parseStrategy: 'choices-flag'
      }
    });

    const result = await discoverModels(provider, executor);
    expect(result).toEqual(['static-model']);
    expect(executor).not.toHaveBeenCalled();
  });
});

describe('discoverModelsFromConfig', () => {
  it('returns null when parse strategy is unsupported', async () => {
    const config: ModelDiscoveryConfig = {
      command: 'test',
      args: [],
      parseStrategy: 'unsupported'
    };
    const result = await discoverModelsFromConfig(config);
    expect(result).toBeNull();
  });

  it('returns null when command output has no models', async () => {
    const executor: CommandExecutor = vi.fn().mockResolvedValue({
      stdout: 'no models here',
      stderr: ''
    });

    const config: ModelDiscoveryConfig = {
      command: 'test',
      args: [],
      parseStrategy: 'choices-flag'
    };
    const result = await discoverModelsFromConfig(config, executor);
    expect(result).toBeNull();
  });

  it('combines stdout and stderr for parsing', async () => {
    const executor: CommandExecutor = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: '--model <model> (choices: "gpt-5")'
    });

    const config: ModelDiscoveryConfig = {
      command: 'test',
      args: [],
      parseStrategy: 'choices-flag'
    };
    const result = await discoverModelsFromConfig(config, executor);
    expect(result).toEqual(['gpt-5']);
  });
});

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('computes correct distance for single character difference', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1);
  });

  it('computes correct distance for insertions', () => {
    expect(levenshteinDistance('gpt', 'gpt-5')).toBe(2);
  });

  it('handles empty strings', () => {
    expect(levenshteinDistance('', 'hello')).toBe(5);
    expect(levenshteinDistance('hello', '')).toBe(5);
    expect(levenshteinDistance('', '')).toBe(0);
  });

  it('computes correct distance for complex edits', () => {
    expect(levenshteinDistance('gemini-3-pro', 'gemini-3-pro-preview')).toBe(8);
  });
});

describe('findClosestModel', () => {
  const models = ['gpt-5', 'gpt-5.1', 'claude-opus-4.6', 'gemini-3-pro-preview'];

  it('finds exact match', () => {
    expect(findClosestModel('gpt-5', models)).toBe('gpt-5');
  });

  it('finds close match (missing suffix)', () => {
    expect(findClosestModel('gemini-3-pro', models)).toBe('gemini-3-pro-preview');
  });

  it('finds close match (typo)', () => {
    expect(findClosestModel('gpt-5.2', models)).toBe('gpt-5.1');
  });

  it('returns null for completely unrelated string', () => {
    expect(findClosestModel('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', models)).toBeNull();
  });

  it('returns null for empty model list', () => {
    expect(findClosestModel('gpt-5', [])).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(findClosestModel('GPT-5', models)).toBe('gpt-5');
  });
});

describe('buildModelValidationError', () => {
  const models = ['gpt-5', 'gpt-5.1', 'claude-opus-4.6'];

  it('includes suggestion when close match found', () => {
    const error = buildModelValidationError('gpt-5.2', 'copilot-cli', models);
    expect(error).toContain('Invalid model "gpt-5.2"');
    expect(error).toContain('copilot-cli');
    expect(error).toContain('Did you mean');
    expect(error).toContain('Valid models:');
    expect(error).toContain('gpt-5');
  });

  it('lists all valid models', () => {
    const error = buildModelValidationError('bad-model', 'copilot-cli', models);
    for (const model of models) {
      expect(error).toContain(model);
    }
  });

  it('omits suggestion when no close match', () => {
    const error = buildModelValidationError('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'copilot-cli', models);
    expect(error).not.toContain('Did you mean');
  });
});
