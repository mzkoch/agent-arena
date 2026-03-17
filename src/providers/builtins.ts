import type { ProviderConfig } from '../domain/types';

export const DEFAULT_COMPLETION_PROTOCOL = {
  idleTimeoutMs: 30_000,
  maxChecks: 3,
  responseTimeoutMs: 60_000,
  doneMarker: 'ARENA_DONE',
  continueMarker: 'ARENA_CONTINUING'
} as const;

export const BUILTIN_PROVIDERS: Record<string, ProviderConfig> = {
  'copilot-cli': {
    command: 'copilot',
    baseArgs: ['--autopilot', '--yolo'],
    modelFlag: '--model',
    promptDelivery: 'flag',
    promptFlag: '-i',
    exitCommand: '/exit',
    completionProtocol: { ...DEFAULT_COMPLETION_PROTOCOL }
  },
  'claude-code': {
    command: 'claude',
    baseArgs: ['--dangerously-skip-permissions'],
    modelFlag: '--model',
    promptDelivery: 'positional',
    exitCommand: '/exit',
    completionProtocol: { ...DEFAULT_COMPLETION_PROTOCOL }
  }
};
