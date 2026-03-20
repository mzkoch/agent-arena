import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  normalizeLineEndings,
  expandHomeDir,
  ensureDir,
  writeTextFile,
  readTextFile,
  readJsonFile,
  writeJsonFile
} from './files';

describe('normalizeLineEndings', () => {
  it('replaces \\r\\n with \\n', () => {
    expect(normalizeLineEndings('a\r\nb\r\n')).toBe('a\nb\n');
  });

  it('leaves \\n untouched', () => {
    expect(normalizeLineEndings('a\nb\n')).toBe('a\nb\n');
  });

  it('handles strings with no line endings', () => {
    expect(normalizeLineEndings('hello')).toBe('hello');
  });
});

describe('expandHomeDir', () => {
  it('expands bare tilde to home dir', () => {
    expect(expandHomeDir('~')).toBe(os.homedir());
  });

  it('expands tilde with forward slash prefix', () => {
    const result = expandHomeDir('~/projects');
    expect(result).toBe(path.join(os.homedir(), 'projects'));
  });

  it('expands tilde with platform separator', () => {
    const result = expandHomeDir(`~${path.sep}code`);
    expect(result).toBe(path.join(os.homedir(), 'code'));
  });

  it('returns non-tilde paths unchanged', () => {
    expect(expandHomeDir('/usr/local')).toBe('/usr/local');
    expect(expandHomeDir('relative/path')).toBe('relative/path');
  });
});

describe('file I/O helpers', () => {
  it('writeTextFile creates directories and writes content', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-files-'));
    const filePath = path.join(tempDir, 'sub', 'dir', 'test.txt');

    await writeTextFile(filePath, 'hello world');

    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('hello world');
  });

  it('readTextFile reads utf8 content', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-files-'));
    const filePath = path.join(tempDir, 'read.txt');

    await writeTextFile(filePath, 'test content');
    const content = await readTextFile(filePath);
    expect(content).toBe('test content');
  });

  it('writeJsonFile / readJsonFile round-trips data', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-files-'));
    const filePath = path.join(tempDir, 'data.json');
    const data = { key: 'value', nested: { count: 42 } };

    await writeJsonFile(filePath, data);
    const result = await readJsonFile<typeof data>(filePath);
    expect(result).toEqual(data);
  });

  it('ensureDir is idempotent', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-files-'));
    const dirPath = path.join(tempDir, 'a', 'b');

    await ensureDir(dirPath);
    await ensureDir(dirPath); // should not throw
  });
});
