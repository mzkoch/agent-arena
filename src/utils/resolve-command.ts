import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * Resolve a bare command name to its absolute path using the platform's
 * native lookup tool (`which` on Unix, `where` on Windows).
 *
 * Commands that are already absolute or contain path separators are
 * returned as-is.
 */
export const resolveCommand = (command: string): string => {
  if (path.isAbsolute(command) || command.includes(path.sep) || command.includes('/')) {
    return command;
  }

  const isWindows = process.platform === 'win32';
  const tool = isWindows ? 'where' : 'which';

  try {
    const result = execFileSync(tool, [command], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    // `where` on Windows may return multiple lines — take the first match
    const resolved = result.split(/\r?\n/)[0]?.trim();
    if (!resolved) throw new Error('empty result');
    return resolved;
  } catch {
    throw new Error(
      `"${command}" not found in PATH — is the provider CLI installed and available?`
    );
  }
};
