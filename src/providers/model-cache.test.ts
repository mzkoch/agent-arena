import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  getModelCachePath,
  loadModelCache,
  saveModelCache,
  isCacheFresh,
  getCachedModels,
  type ModelCacheEntry,
  type ModelCache
} from './model-cache';
import type { ProviderConfig } from '../domain/types';
import { DEFAULT_COMPLETION_PROTOCOL } from './builtins';
import type { CommandExecutor } from './model-discovery';

const makeProvider = (overrides: Partial<ProviderConfig> = {}): ProviderConfig => ({
  command: 'test-cli',
  baseArgs: [],
  promptDelivery: 'positional',
  exitCommand: '/exit',
  completionProtocol: { ...DEFAULT_COMPLETION_PROTOCOL },
  ...overrides
});

describe('getModelCachePath', () => {
  it('resolves to .arena/.model-cache.json', () => {
    const result = getModelCachePath('/project');
    expect(result).toBe(path.join('/project', '.arena', '.model-cache.json'));
  });
});

describe('loadModelCache', () => {
  it('returns empty object when file does not exist', async () => {
    const result = await loadModelCache('/nonexistent/.model-cache.json');
    expect(result).toEqual({});
  });

  it('loads cache from file', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'model-cache-'));
    const cachePath = path.join(tempDir, '.model-cache.json');
    const cache: ModelCache = {
      'copilot-cli': {
        models: ['gpt-5'],
        discoveredAt: new Date().toISOString(),
        ttlMs: 3600000
      }
    };
    await writeFile(cachePath, JSON.stringify(cache));

    const result = await loadModelCache(cachePath);
    expect(result['copilot-cli']?.models).toEqual(['gpt-5']);
  });
});

describe('saveModelCache', () => {
  it('writes cache to disk', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'model-cache-'));
    const cachePath = path.join(tempDir, '.model-cache.json');
    const cache: ModelCache = {
      'test-provider': {
        models: ['model-a'],
        discoveredAt: new Date().toISOString(),
        ttlMs: 1000
      }
    };

    await saveModelCache(cachePath, cache);
    const loaded = await loadModelCache(cachePath);
    expect(loaded['test-provider']?.models).toEqual(['model-a']);
  });
});

describe('isCacheFresh', () => {
  it('returns true for a fresh entry', () => {
    const entry: ModelCacheEntry = {
      models: ['gpt-5'],
      discoveredAt: new Date().toISOString(),
      ttlMs: 3600000
    };
    expect(isCacheFresh(entry)).toBe(true);
  });

  it('returns false for an expired entry', () => {
    const entry: ModelCacheEntry = {
      models: ['gpt-5'],
      discoveredAt: new Date(Date.now() - 7200000).toISOString(),
      ttlMs: 3600000
    };
    expect(isCacheFresh(entry)).toBe(false);
  });

  it('returns false for a zero TTL entry', () => {
    const entry: ModelCacheEntry = {
      models: ['gpt-5'],
      discoveredAt: new Date().toISOString(),
      ttlMs: 0
    };
    expect(isCacheFresh(entry)).toBe(false);
  });
});

describe('getCachedModels', () => {
  it('returns cached models when cache is fresh', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'model-cache-'));
    const cachePath = path.join(tempDir, '.model-cache.json');
    const cache: ModelCache = {
      'copilot-cli': {
        models: ['gpt-5', 'claude-opus-4.6'],
        discoveredAt: new Date().toISOString(),
        ttlMs: 3600000
      }
    };
    await writeFile(cachePath, JSON.stringify(cache));

    const provider = makeProvider();
    const executor: CommandExecutor = vi.fn();

    const result = await getCachedModels('copilot-cli', provider, cachePath, executor);
    expect(result).toEqual(['gpt-5', 'claude-opus-4.6']);
    expect(executor).not.toHaveBeenCalled();
  });

  it('rediscovers when cache is stale', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'model-cache-'));
    const cachePath = path.join(tempDir, '.model-cache.json');
    const cache: ModelCache = {
      'copilot-cli': {
        models: ['old-model'],
        discoveredAt: new Date(Date.now() - 7200000).toISOString(),
        ttlMs: 3600000
      }
    };
    await writeFile(cachePath, JSON.stringify(cache));

    const executor: CommandExecutor = vi.fn().mockResolvedValue({
      stdout: '--model <model> (choices: "new-model-a", "new-model-b")',
      stderr: ''
    });

    const provider = makeProvider({
      modelDiscovery: {
        command: 'copilot',
        args: ['--help'],
        parseStrategy: 'choices-flag'
      }
    });

    const result = await getCachedModels('copilot-cli', provider, cachePath, executor);
    expect(result).toEqual(['new-model-a', 'new-model-b']);
    expect(executor).toHaveBeenCalled();
  });

  it('discovers when no cache exists', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'model-cache-'));
    const cachePath = path.join(tempDir, '.model-cache.json');

    const executor: CommandExecutor = vi.fn().mockResolvedValue({
      stdout: '--model <model> (choices: "model-x")',
      stderr: ''
    });

    const provider = makeProvider({
      modelDiscovery: {
        command: 'copilot',
        args: ['--help'],
        parseStrategy: 'choices-flag'
      }
    });

    const result = await getCachedModels('copilot-cli', provider, cachePath, executor);
    expect(result).toEqual(['model-x']);

    // Verify cache was saved
    const freshCache = await loadModelCache(cachePath);
    expect(freshCache['copilot-cli']?.models).toEqual(['model-x']);
  });

  it('returns null when discovery fails and no cache', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'model-cache-'));
    const cachePath = path.join(tempDir, '.model-cache.json');

    const provider = makeProvider();
    const result = await getCachedModels('custom', provider, cachePath);
    expect(result).toBeNull();
  });
});
