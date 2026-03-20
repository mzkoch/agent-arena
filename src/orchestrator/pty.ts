import { spawn } from 'node-pty';
import { resolveCommand } from '../utils/resolve-command';

export interface PtyProcess {
  pid: number;
  write(data: string): void;
  kill(): void;
  resize(cols: number, rows: number): void;
  onData(listener: (chunk: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
}

export interface PtySpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
}

export type PtyFactory = (
  command: string,
  args: string[],
  options: PtySpawnOptions
) => PtyProcess;

export const nodePtyFactory: PtyFactory = (command, args, options) =>
  spawn(resolveCommand(command), args, {
    name: 'xterm-color',
    cols: options.cols ?? 120,
    rows: options.rows ?? 40,
    cwd: options.cwd,
    env: options.env
  });
