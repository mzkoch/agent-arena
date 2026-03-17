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

  const key = provider.trustedFolders.jsonKey;
  const folders = Array.isArray(config[key]) ? (config[key] as unknown[]) : [];
  const normalizedFolders = folders.filter((value): value is string => typeof value === 'string');

  if (!normalizedFolders.includes(folderPath)) {
    config[key] = [...normalizedFolders, folderPath];
    await writeJsonFile(configFilePath, config);
  }
};
