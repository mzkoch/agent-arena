import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const normalizeLineEndings = (value: string): string =>
  value.replace(/\r\n/g, '\n');

export const expandHomeDir = (value: string): string => {
  if (value === '~') {
    return os.homedir();
  }

  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
};

export const ensureDir = async (directoryPath: string): Promise<void> => {
  await mkdir(directoryPath, { recursive: true });
};

export const writeTextFile = async (
  filePath: string,
  content: string
): Promise<void> => {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content, 'utf8');
};

export const readTextFile = async (filePath: string): Promise<string> =>
  readFile(filePath, 'utf8');

export const readJsonFile = async <T>(filePath: string): Promise<T> => {
  const content = await readTextFile(filePath);
  return JSON.parse(content) as T;
};

export const writeJsonFile = async (
  filePath: string,
  value: unknown
): Promise<void> => {
  await writeTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
};
