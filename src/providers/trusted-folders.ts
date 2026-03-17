import path from 'node:path';
import type { ProviderConfig } from '../domain/types';
import { expandHomeDir, readJsonFile, writeJsonFile } from '../utils/files';

export const ensureTrustedFolder = async (
  provider: ProviderConfig,
  folderPath: string
): Promise<void> => {
  if (!provider.trustedFolders) {
    return;
  }

  const configFilePath = path.resolve(expandHomeDir(provider.trustedFolders.configFile));
  let config: Record<string, unknown> = {};

  try {
    config = await readJsonFile<Record<string, unknown>>(configFilePath);
  } catch {
    config = {};
  }

  const { jsonKey } = provider.trustedFolders;

  if (provider.trustedFolders.strategy === 'flat-array') {
    const folders = Array.isArray(config[jsonKey]) ? (config[jsonKey] as unknown[]) : [];
    const normalizedFolders = folders.filter((value): value is string => typeof value === 'string');

    if (!normalizedFolders.includes(folderPath)) {
      config[jsonKey] = [...normalizedFolders, folderPath];
      await writeJsonFile(configFilePath, config);
    }
  } else {
    const { nestedKey } = provider.trustedFolders;
    const raw = config[jsonKey];
    const existing =
      typeof raw === 'object' && raw !== null && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const rawEntry = existing[folderPath];
    const projectEntry =
      typeof rawEntry === 'object' && rawEntry !== null && !Array.isArray(rawEntry)
        ? (rawEntry as Record<string, unknown>)
        : {};

    if (projectEntry[nestedKey] !== true) {
      existing[folderPath] = { ...projectEntry, [nestedKey]: true };
      config[jsonKey] = existing;
      await writeJsonFile(configFilePath, config);
    }
  }
};
