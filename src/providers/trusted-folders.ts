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
    const existing = (config[jsonKey] ?? {}) as Record<string, Record<string, unknown>>;
    const projectEntry = existing[folderPath] ?? {};

    if (projectEntry[nestedKey] !== true) {
      existing[folderPath] = { ...projectEntry, [nestedKey]: true };
      config[jsonKey] = existing;
      await writeJsonFile(configFilePath, config);
    }
  }
};
