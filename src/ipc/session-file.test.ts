import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSessionFile, writeSessionFile } from './session-file';

describe('session file helpers', () => {
  it('writes and reads session files', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-session-'));
    const filePath = path.join(tempDir, '.arena-session.json');

    await writeSessionFile(filePath, {
      port: 1234,
      pid: 999,
      startedAt: new Date(0).toISOString(),
      repoPath: '/tmp/repo',
      variants: ['a']
    });

    expect(await readSessionFile(filePath)).toMatchObject({ port: 1234, pid: 999 });
  });

  it('reads existing session JSON', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arena-session-'));
    const filePath = path.join(tempDir, '.arena-session.json');
    await writeFile(filePath, '{"port":1,"pid":2,"startedAt":"x","repoPath":"y","variants":[]}\n');
    expect((await readSessionFile(filePath)).repoPath).toBe('y');
  });
});
