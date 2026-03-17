import { mkdir, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import type { ProviderConfig, TrustedFoldersConfig } from '../domain/types';
import { ensureDir, expandHomeDir, readJsonFile, writeJsonFile } from '../utils/files';

const LOCK_SUFFIX = '.arena-lock';
const LOCK_RETRY_DELAY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 30_000;
const LOCK_HEARTBEAT_MS = 5_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const resolveConfigFilePath = (trustedFolders: TrustedFoldersConfig): string =>
  path.resolve(expandHomeDir(trustedFolders.configFile));

/**
 * Build a grouping key that includes the config file path AND the schema
 * (strategy, jsonKey, nestedKey) so two providers targeting the same file
 * with different layouts are never merged into a single batch.
 */
const buildGroupKey = (trustedFolders: TrustedFoldersConfig): string => {
  const configFilePath = resolveConfigFilePath(trustedFolders);
  const parts = [
    configFilePath,
    trustedFolders.strategy,
    trustedFolders.jsonKey,
    trustedFolders.strategy === 'nested-object' ? trustedFolders.nestedKey : ''
  ];
  return parts.join('\0');
};

const readConfigSafe = async (configFilePath: string): Promise<Record<string, unknown>> => {
  try {
    return await readJsonFile<Record<string, unknown>>(configFilePath);
  } catch {
    return {};
  }
};

const getLockAgeMs = async (lockPath: string): Promise<number | undefined> => {
  try {
    const metadata = await stat(lockPath);
    return Date.now() - metadata.mtimeMs;
  } catch {
    return undefined;
  }
};

/**
 * Touch the lock directory's mtime to signal the lock is still actively held.
 * This prevents other processes from treating a long-running but legitimate
 * lock as stale.
 */
const startHeartbeat = (lockPath: string): NodeJS.Timeout => {
  return setInterval(() => {
    const now = new Date();
    void utimes(lockPath, now, now).catch(() => {});
  }, LOCK_HEARTBEAT_MS);
};

/**
 * Cross-process file lock using atomic mkdir. The lock directory is created
 * atomically; concurrent processes that try to mkdir the same path will get
 * EEXIST. Stale locks (older than LOCK_STALE_MS with no heartbeat) are
 * automatically removed. Active locks refresh their mtime via a heartbeat
 * to prevent false stale detection.
 */
export const withFileLock = async <T>(
  targetFilePath: string,
  operation: () => Promise<T>
): Promise<T> => {
  await ensureDir(path.dirname(targetFilePath));
  const lockPath = `${targetFilePath}${LOCK_SUFFIX}`;
  const startedAt = Date.now();

  while (true) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'EEXIST') {
        throw error;
      }

      const lockAgeMs = await getLockAgeMs(lockPath);
      if (lockAgeMs !== undefined && lockAgeMs > LOCK_STALE_MS) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }

      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out acquiring lock for ${targetFilePath}`);
      }

      await sleep(LOCK_RETRY_DELAY_MS);
    }
  }

  const heartbeat = startHeartbeat(lockPath);
  try {
    return await operation();
  } finally {
    clearInterval(heartbeat);
    // Best-effort cleanup: swallow errors so the original operation
    // error (if any) is not masked by a cleanup failure.
    await rm(lockPath, { recursive: true, force: true }).catch(() => {});
  }
};

/**
 * Apply trusted folder updates to a config object in-place.
 * Returns true if the config was modified.
 */
const applyTrustedFolderUpdate = (
  config: Record<string, unknown>,
  trustedFolders: TrustedFoldersConfig,
  folderPaths: readonly string[]
): boolean => {
  const uniquePaths = [...new Set(folderPaths)];
  if (uniquePaths.length === 0) {
    return false;
  }

  const { jsonKey } = trustedFolders;

  if (trustedFolders.strategy === 'flat-array') {
    const folders = Array.isArray(config[jsonKey]) ? (config[jsonKey] as unknown[]) : [];
    const normalizedFolders = folders.filter((v): v is string => typeof v === 'string');
    let changed = false;

    for (const folderPath of uniquePaths) {
      if (!normalizedFolders.includes(folderPath)) {
        normalizedFolders.push(folderPath);
        changed = true;
      }
    }

    if (changed) {
      config[jsonKey] = normalizedFolders;
    }
    return changed;
  }

  const { nestedKey } = trustedFolders;
  const rawProjects = config[jsonKey];
  const projects = isRecord(rawProjects) ? { ...rawProjects } : {};
  let changed = false;

  for (const folderPath of uniquePaths) {
    const rawEntry = projects[folderPath];
    const entry = isRecord(rawEntry) ? rawEntry : {};

    if (entry[nestedKey] !== true) {
      projects[folderPath] = { ...entry, [nestedKey]: true };
      changed = true;
    }
  }

  if (changed) {
    config[jsonKey] = projects;
  }
  return changed;
};

/**
 * Register a single folder path in a provider's trusted folders config.
 * Uses file locking for cross-process safety.
 */
export const ensureTrustedFolder = async (
  provider: ProviderConfig,
  folderPath: string
): Promise<void> =>
  ensureTrustedFolders(provider, [folderPath]);

/**
 * Batch-register multiple folder paths for a single provider.
 * Performs one locked read-modify-write per call.
 */
export const ensureTrustedFolders = async (
  provider: ProviderConfig,
  folderPaths: readonly string[]
): Promise<void> => {
  if (!provider.trustedFolders) {
    return;
  }

  const configFilePath = resolveConfigFilePath(provider.trustedFolders);
  const trustedFolders = provider.trustedFolders;

  await withFileLock(configFilePath, async () => {
    const config = await readConfigSafe(configFilePath);
    if (applyTrustedFolderUpdate(config, trustedFolders, folderPaths)) {
      await writeJsonFile(configFilePath, config);
    }
  });
};

export interface TrustedFolderRegistration {
  provider: ProviderConfig;
  folderPath: string;
}

/**
 * Batch-register trusted folders for multiple providers. Groups entries
 * by resolved config file path AND schema (strategy/jsonKey/nestedKey)
 * so each unique combination is written independently. Acquires a file
 * lock per config file for cross-process safety.
 */
export const registerTrustedFolders = async (
  registrations: readonly TrustedFolderRegistration[]
): Promise<void> => {
  const grouped = new Map<string, { trustedFolders: TrustedFoldersConfig; configFilePath: string; folderPaths: string[] }>();

  for (const { provider, folderPath } of registrations) {
    if (!provider.trustedFolders) {
      continue;
    }

    const key = buildGroupKey(provider.trustedFolders);
    let group = grouped.get(key);
    if (!group) {
      group = {
        trustedFolders: provider.trustedFolders,
        configFilePath: resolveConfigFilePath(provider.trustedFolders),
        folderPaths: []
      };
      grouped.set(key, group);
    }
    if (!group.folderPaths.includes(folderPath)) {
      group.folderPaths.push(folderPath);
    }
  }

  await Promise.all(
    [...grouped.values()].map(async ({ trustedFolders, configFilePath, folderPaths }) =>
      withFileLock(configFilePath, async () => {
        const config = await readConfigSafe(configFilePath);
        if (applyTrustedFolderUpdate(config, trustedFolders, folderPaths)) {
          await writeJsonFile(configFilePath, config);
        }
      })
    )
  );
};
