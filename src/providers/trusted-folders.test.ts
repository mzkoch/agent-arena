import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProviderConfig } from '../domain/types';
import { writeJsonFile } from '../utils/files';
import { ensureTrustedFolder } from './trusted-folders';

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

      await writeJsonFile(configFile, {
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
