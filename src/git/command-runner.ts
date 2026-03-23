import { spawn } from 'node:child_process';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface CommandRunner {
  run(command: string, args: string[], options?: CommandOptions): Promise<CommandResult>;
}

export class NodeCommandRunner implements CommandRunner {
  public async run(
    command: string,
    args: string[],
    options: CommandOptions = {}
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let timer: NodeJS.Timeout | undefined;

      if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, options.timeoutMs);
      }

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        if (timer) clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 0,
          timedOut
        });
      });
    });
  }
}
