import path from 'node:path';
import type { ProviderConfig } from '../domain/types';
import { readJsonFile, writeJsonFile } from '../utils/files';
import { withFileLock } from './trusted-folders';
import { discoverModels, type CommandExecutor } from './model-discovery';

const DEFAULT_TTL_MS = 3_600_000; // 1 hour
const MODEL_CACHE_FILENAME = '.model-cache.json';

export interface ModelCacheEntry {
  models: string[];
  discoveredAt: string;
  ttlMs: number;
}

export type ModelCache = Record<string, ModelCacheEntry>;

/**
 * Resolve the path to the model cache file.
 * Lives at `.arena/.model-cache.json` relative to the git root.
 */
export const getModelCachePath = (gitRoot: string): string =>
  path.join(gitRoot, '.arena', MODEL_CACHE_FILENAME);

/**
 * Load the model cache from disk. Returns an empty object if the file doesn't exist.
 */
export const loadModelCache = async (cachePath: string): Promise<ModelCache> => {
  try {
    return await readJsonFile<ModelCache>(cachePath);
  } catch {
    return {};
  }
};

/**
 * Save the model cache to disk with file locking for cross-process safety.
 */
export const saveModelCache = async (
  cachePath: string,
  cache: ModelCache
): Promise<void> => {
  await withFileLock(cachePath, async () => {
    await writeJsonFile(cachePath, cache);
  });
};

/**
 * Check whether a cache entry is still fresh.
 */
export const isCacheFresh = (entry: ModelCacheEntry): boolean => {
  const discoveredAt = new Date(entry.discoveredAt).getTime();
  const expiresAt = discoveredAt + entry.ttlMs;
  return Date.now() < expiresAt;
};

/**
 * Get models for a provider, using cache when available.
 * Falls back to live discovery when cache is stale or missing.
 */
export const getCachedModels = async (
  providerName: string,
  provider: ProviderConfig,
  cachePath: string,
  executor?: CommandExecutor
): Promise<string[] | null> => {
  const cache = await loadModelCache(cachePath);
  const entry = cache[providerName];

  if (entry && isCacheFresh(entry)) {
    return entry.models;
  }

  // Discover fresh models
  const models = await discoverModels(provider, executor);
  if (models && models.length > 0) {
    cache[providerName] = {
      models,
      discoveredAt: new Date().toISOString(),
      ttlMs: DEFAULT_TTL_MS
    };
    try {
      await saveModelCache(cachePath, cache);
    } catch {
      // Cache write failure is non-fatal — we still have the discovered models
    }
  }

  return models;
};
