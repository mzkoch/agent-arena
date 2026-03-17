import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProviderConfig } from '../domain/types';
import { ensureTrustedFolder } from './trusted-folders';

describe('ensureTrustedFolder', () => {
  it('creates and updates the trusted folders array', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-trusted-'));
    const configFile = path.join(tempDir, 'settings.json');
    const provider: ProviderConfig = {
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
      trustedFolders: {
        configFile,
        jsonKey: 'trusted_folders'
      }
    };

    await ensureTrustedFolder(provider, '/tmp/worktree-a');
    await ensureTrustedFolder(provider, '/tmp/worktree-a');
    await ensureTrustedFolder(provider, '/tmp/worktree-b');

    const parsed = JSON.parse(await readFile(configFile, 'utf8')) as {
      trusted_folders: string[];
    };
    expect(parsed.trusted_folders).toEqual(['/tmp/worktree-a', '/tmp/worktree-b']);
  });
});
