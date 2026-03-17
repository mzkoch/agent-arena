import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '../domain/types';
import * as fileUtils from '../utils/files';
import {
  ensureTrustedFolder,
  ensureTrustedFolders,
  registerTrustedFolders,
  withFileLock
} from './trusted-folders';

const makeProvider = (
  trustedFolders: ProviderConfig['trustedFolders']
): ProviderConfig => ({
  command: 'demo',
  baseArgs: [],
  promptDelivery: 'positional',
  exitCommand: '/exit',
  completionProtocol: {
    idleTimeoutMs: 1,
    maxChecks: 1,
    responseTimeoutMs: 1,
    doneMarker: 'DONE',
    continueMarker: 'CONT'
  },
  trustedFolders
});

const readConfig = async (filePath: string) =>
  JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ensureTrustedFolder', () => {
  it('is a no-op when trustedFolders is not configured', async () => {
    const provider = makeProvider(undefined);
    await expect(ensureTrustedFolder(provider, '/tmp/worktree-a')).resolves.toBeUndefined();
  });

  describe('flat-array strategy', () => {
    it('creates config and appends folders, is idempotent', async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-trusted-'));
      const configFile = path.join(tempDir, 'settings.json');
      const provider = makeProvider({
        strategy: 'flat-array',
        configFile,
        jsonKey: 'trusted_folders'
      });

      await ensureTrustedFolder(provider, '/tmp/worktree-a');
      await ensureTrustedFolder(provider, '/tmp/worktree-a');
      await ensureTrustedFolder(provider, '/tmp/worktree-b');

      const parsed = await readConfig(configFile);
      expect(parsed.trusted_folders).toEqual(['/tmp/worktree-a', '/tmp/worktree-b']);
    });
  });

  describe('nested-object strategy', () => {
    it('creates config and sets the flag, is idempotent', async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-trusted-'));
      const configFile = path.join(tempDir, 'claude.json');
      const provider = makeProvider({
        strategy: 'nested-object',
        configFile,
        jsonKey: 'projects',
        nestedKey: 'hasTrustDialogAccepted'
      });

      await ensureTrustedFolder(provider, '/tmp/worktree-a');
      await ensureTrustedFolder(provider, '/tmp/worktree-a');
      await ensureTrustedFolder(provider, '/tmp/worktree-b');

      const parsed = await readConfig(configFile);
      expect(parsed.projects).toEqual({
        '/tmp/worktree-a': { hasTrustDialogAccepted: true },
        '/tmp/worktree-b': { hasTrustDialogAccepted: true }
      });
    });

    it('preserves existing project data', async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-trusted-'));
      const configFile = path.join(tempDir, 'claude.json');

      await fileUtils.writeJsonFile(configFile, {
        projects: {
          '/tmp/worktree-a': {
            allowedTools: ['bash', 'read'],
            hasTrustDialogAccepted: false
          }
        }
      });

      const provider = makeProvider({
        strategy: 'nested-object',
        configFile,
        jsonKey: 'projects',
        nestedKey: 'hasTrustDialogAccepted'
      });

      await ensureTrustedFolder(provider, '/tmp/worktree-a');

      const parsed = await readConfig(configFile);
      const projects = parsed.projects as Record<string, Record<string, unknown>>;
      expect(projects['/tmp/worktree-a']).toEqual({
        allowedTools: ['bash', 'read'],
        hasTrustDialogAccepted: true
      });
    });
  });
});

describe('ensureTrustedFolders (batch)', () => {
  it('writes all paths in a single operation', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-trusted-'));
    const configFile = path.join(tempDir, 'settings.json');
    const provider = makeProvider({
      strategy: 'flat-array',
      configFile,
      jsonKey: 'trusted_folders'
    });
    const writeSpy = vi.spyOn(fileUtils, 'writeJsonFile');

    await ensureTrustedFolders(provider, [
      '/tmp/worktree-a',
      '/tmp/worktree-b',
      '/tmp/worktree-c'
    ]);

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const parsed = await readConfig(configFile);
    expect(parsed.trusted_folders).toEqual([
      '/tmp/worktree-a',
      '/tmp/worktree-b',
      '/tmp/worktree-c'
    ]);
  });

  it('deduplicates folder paths', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-trusted-'));
    const configFile = path.join(tempDir, 'settings.json');
    const provider = makeProvider({
      strategy: 'flat-array',
      configFile,
      jsonKey: 'trusted_folders'
    });

    await ensureTrustedFolders(provider, [
      '/tmp/worktree-a',
      '/tmp/worktree-a',
      '/tmp/worktree-b'
    ]);

    const parsed = await readConfig(configFile);
    expect(parsed.trusted_folders).toEqual(['/tmp/worktree-a', '/tmp/worktree-b']);
  });

  it('preserves existing folders in the config', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-trusted-'));
    const configFile = path.join(tempDir, 'settings.json');

    await fileUtils.writeJsonFile(configFile, { trusted_folders: ['/existing/path'] });

    const provider = makeProvider({
      strategy: 'flat-array',
      configFile,
      jsonKey: 'trusted_folders'
    });

    await ensureTrustedFolders(provider, ['/tmp/worktree-a', '/tmp/worktree-b']);

    const parsed = await readConfig(configFile);
    expect(parsed.trusted_folders).toEqual([
      '/existing/path',
      '/tmp/worktree-a',
      '/tmp/worktree-b'
    ]);
  });

  it('is a no-op when all paths already exist', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-trusted-'));
    const configFile = path.join(tempDir, 'settings.json');

    await fileUtils.writeJsonFile(configFile, {
      trusted_folders: ['/tmp/worktree-a', '/tmp/worktree-b']
    });

    const provider = makeProvider({
      strategy: 'flat-array',
      configFile,
      jsonKey: 'trusted_folders'
    });
    const writeSpy = vi.spyOn(fileUtils, 'writeJsonFile');

    await ensureTrustedFolders(provider, ['/tmp/worktree-a', '/tmp/worktree-b']);

    // writeJsonFile should not have been called (beyond the setup call above)
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('batches nested-object strategy', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-trusted-'));
    const configFile = path.join(tempDir, 'claude.json');
    const provider = makeProvider({
      strategy: 'nested-object',
      configFile,
      jsonKey: 'projects',
      nestedKey: 'hasTrustDialogAccepted'
    });

    await ensureTrustedFolders(provider, ['/tmp/worktree-a', '/tmp/worktree-b']);

    const parsed = await readConfig(configFile);
    expect(parsed.projects).toEqual({
      '/tmp/worktree-a': { hasTrustDialogAccepted: true },
      '/tmp/worktree-b': { hasTrustDialogAccepted: true }
    });
  });
});

describe('registerTrustedFolders', () => {
  it('is a no-op when no entries have trustedFolders configured', async () => {
    const provider = makeProvider(undefined);
    await expect(
      registerTrustedFolders([
        { provider, folderPath: '/tmp/worktree-a' },
        { provider, folderPath: '/tmp/worktree-b' }
      ])
    ).resolves.toBeUndefined();
  });

  it('groups entries by config file and writes once per file', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-trusted-'));
    const configFile = path.join(tempDir, 'settings.json');
    const provider = makeProvider({
      strategy: 'flat-array',
      configFile,
      jsonKey: 'trusted_folders'
    });
    const writeSpy = vi.spyOn(fileUtils, 'writeJsonFile');

    await registerTrustedFolders([
      { provider, folderPath: '/tmp/worktree-a' },
      { provider, folderPath: '/tmp/worktree-b' },
      { provider, folderPath: '/tmp/worktree-c' }
    ]);

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const parsed = await readConfig(configFile);
    expect(parsed.trusted_folders).toEqual([
      '/tmp/worktree-a',
      '/tmp/worktree-b',
      '/tmp/worktree-c'
    ]);
  });

  it('handles multiple providers targeting different config files', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-trusted-'));
    const flatConfig = path.join(tempDir, 'copilot.json');
    const nestedConfig = path.join(tempDir, 'claude.json');

    const flatProvider = makeProvider({
      strategy: 'flat-array',
      configFile: flatConfig,
      jsonKey: 'trusted_folders'
    });
    const nestedProvider = makeProvider({
      strategy: 'nested-object',
      configFile: nestedConfig,
      jsonKey: 'projects',
      nestedKey: 'hasTrustDialogAccepted'
    });

    await registerTrustedFolders([
      { provider: flatProvider, folderPath: '/tmp/worktree-a' },
      { provider: nestedProvider, folderPath: '/tmp/worktree-b' },
      { provider: flatProvider, folderPath: '/tmp/worktree-c' }
    ]);

    const flatParsed = await readConfig(flatConfig);
    expect(flatParsed.trusted_folders).toEqual(['/tmp/worktree-a', '/tmp/worktree-c']);

    const nestedParsed = await readConfig(nestedConfig);
    expect(nestedParsed.projects).toEqual({
      '/tmp/worktree-b': { hasTrustDialogAccepted: true }
    });
  });
});

describe('withFileLock', () => {
  it('serializes concurrent operations on the same file', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-lock-'));
    const targetFile = path.join(tempDir, 'target.json');
    const order: number[] = [];

    await Promise.all(
      [1, 2, 3].map((i) =>
        withFileLock(targetFile, async () => {
          order.push(i);
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 10);
          });
        })
      )
    );

    expect(order).toHaveLength(3);
    // All three completed; exact order is non-deterministic but all must finish
    expect(new Set(order)).toEqual(new Set([1, 2, 3]));
  });

  it('releases the lock after an error', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-lock-'));
    const targetFile = path.join(tempDir, 'target.json');

    await expect(
      withFileLock(targetFile, () => {
        throw new Error('intentional');
      })
    ).rejects.toThrow('intentional');

    // Lock should be released — a subsequent lock should succeed immediately
    await expect(
      withFileLock(targetFile, () => Promise.resolve('ok'))
    ).resolves.toBe('ok');
  });

  it('cleans up stale locks', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-lock-'));
    const targetFile = path.join(tempDir, 'target.json');
    const lockPath = `${targetFile}.arena-lock`;

    // Create a stale lock by making the directory and backdating it
    const { utimes } = await import('node:fs/promises');
    await fileUtils.ensureDir(lockPath);
    const staleTime = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleTime, staleTime);

    // Should succeed by cleaning up the stale lock
    await expect(
      withFileLock(targetFile, () => Promise.resolve('ok'))
    ).resolves.toBe('ok');

    // Clean up
    await rm(lockPath, { recursive: true, force: true }).catch(() => {});
  });
});

describe('concurrent in-process race condition', () => {
  it('preserves all folders when ensureTrustedFolder is called concurrently', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-trusted-'));
    const configFile = path.join(tempDir, 'settings.json');
    const provider = makeProvider({
      strategy: 'flat-array',
      configFile,
      jsonKey: 'trusted_folders'
    });

    // Simulate the original race: concurrent calls via Promise.all
    await Promise.all([
      ensureTrustedFolder(provider, '/tmp/worktree-a'),
      ensureTrustedFolder(provider, '/tmp/worktree-b'),
      ensureTrustedFolder(provider, '/tmp/worktree-c'),
      ensureTrustedFolder(provider, '/tmp/worktree-d'),
      ensureTrustedFolder(provider, '/tmp/worktree-e')
    ]);

    const parsed = await readConfig(configFile);
    const folders = (parsed.trusted_folders as string[]).sort();
    expect(folders).toEqual([
      '/tmp/worktree-a',
      '/tmp/worktree-b',
      '/tmp/worktree-c',
      '/tmp/worktree-d',
      '/tmp/worktree-e'
    ]);
  });
});
