import type { ArenaSessionFile } from '../domain/types';
import { readJsonFile, writeJsonFile } from '../utils/files';

export const writeSessionFile = async (
  sessionFilePath: string,
  session: ArenaSessionFile
): Promise<void> => {
  await writeJsonFile(sessionFilePath, session);
};

export const readSessionFile = async (sessionFilePath: string): Promise<ArenaSessionFile> =>
  readJsonFile<ArenaSessionFile>(sessionFilePath);
