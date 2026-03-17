import type { AgentProvider } from './types.js';

export const claudeCodeProvider: AgentProvider = {
  command: 'claude',
  baseArgs: ['--dangerously-skip-permissions'],
  modelFlag: '--model',
  promptDelivery: 'positional',
  exitCommand: '/exit',
  completionProtocol: {
    idleTimeoutMs: 30_000,
    maxChecks: 3,
    responseTimeoutMs: 60_000,
    doneMarker: 'ARENA_DONE',
    continueMarker: 'ARENA_CONTINUING',
  },
};
