import { spawn } from 'node:child_process';

const runCommand = async (command: string, args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}`));
        return;
      }
      resolve();
    });
  });

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export type ProcessTerminator = (pid: number) => Promise<void>;

export const terminateProcessTree: ProcessTerminator = async (pid: number) => {
  if (process.platform === 'win32') {
    await runCommand('taskkill', ['/T', '/F', '/PID', String(pid)]);
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== 'ESRCH') {
      throw error;
    }
  }

  await sleep(250);

  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== 'ESRCH') {
      throw error;
    }
  }
};
