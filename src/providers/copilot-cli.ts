import type { AgentProvider } from './types.js';

export const copilotCliProvider: AgentProvider = {
  command: 'copilot',
  baseArgs: ['--autopilot', '--yolo'],
  modelFlag: '--model',
  promptDelivery: 'flag',
  promptFlag: '-i',
  maxContinuesFlag: '--max-autopilot-continues',
  exitCommand: '/exit',
  completionProtocol: {
    idleTimeoutMs: 30_000,
    maxChecks: 3,
    responseTimeoutMs: 60_000,
    doneMarker: 'ARENA_DONE',
    continueMarker: 'ARENA_CONTINUING',
  },
  trustedFolders: {
    configFile: '~/.copilot/config.json',
    jsonKey: 'trusted_folders',
  },
};
