import { describe, expect, it } from 'vitest';
import { LocalArenaController, RemoteArenaController } from './controller';
import type { ArenaIpcClient } from '../ipc/client';
import type { ArenaOrchestrator } from '../orchestrator/arena-orchestrator';

describe('ArenaControllerCapabilities', () => {
  it('LocalArenaController has full capabilities', () => {
    const controller = new LocalArenaController({} as ArenaOrchestrator);

    expect(controller.capabilities).toEqual({
      mode: 'local',
      canSendInput: true,
      canKill: true,
      canRestart: true,
      canResizePty: true,
    });
  });

  it('RemoteArenaController monitor has restricted capabilities', () => {
    const snapshot = { gitRoot: '', startedAt: '', headless: false, agents: [] };
    const controller = new RemoteArenaController({} as ArenaIpcClient, snapshot, 'monitor');

    expect(controller.capabilities).toEqual({
      mode: 'monitor',
      canSendInput: false,
      canKill: false,
      canRestart: false,
      canResizePty: false,
    });
  });

  it('RemoteArenaController controller has mutation capabilities but no PTY resize', () => {
    const snapshot = { gitRoot: '', startedAt: '', headless: false, agents: [] };
    const controller = new RemoteArenaController({} as ArenaIpcClient, snapshot, 'controller');

    expect(controller.capabilities).toEqual({
      mode: 'local',
      canSendInput: true,
      canKill: true,
      canRestart: true,
      canResizePty: false,
    });
  });
});
