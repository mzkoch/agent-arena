import type { AgentSnapshot, ArenaSnapshot } from '../domain/types';
import type { ServerToClientMessage } from '../ipc/protocol';

const replaceAgent = (
  snapshot: ArenaSnapshot,
  updatedAgent: AgentSnapshot
): ArenaSnapshot => ({
  ...snapshot,
  agents: snapshot.agents.map((agent) =>
    agent.name === updatedAgent.name ? updatedAgent : agent
  )
});

export const applyServerMessage = (
  snapshot: ArenaSnapshot,
  message: ServerToClientMessage
): ArenaSnapshot => {
  switch (message.type) {
    case 'snapshot':
      return message.snapshot;
    case 'agent-state':
      return replaceAgent(snapshot, message.snapshot);
    case 'agent-output':
    case 'error':
      return snapshot;
    default:
      return snapshot;
  }
};

export const isTerminalStatus = (status: AgentSnapshot['status']): boolean =>
  status === 'completed' || status === 'failed' || status === 'killed';

export const hasActiveAgents = (snapshot: ArenaSnapshot): boolean =>
  snapshot.agents.some((agent) => !isTerminalStatus(agent.status));
