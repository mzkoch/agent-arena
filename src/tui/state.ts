import type { AgentSnapshot, ArenaSnapshot } from '../domain/types';
import { isTerminalStatus } from '../domain/types';
import type { TerminalDelta, TerminalSnapshot } from '../terminal/types';
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

export const applyDelta = (
  terminal: TerminalSnapshot,
  delta: TerminalDelta
): TerminalSnapshot => {
  const lines = [...terminal.lines];
  for (const change of delta.changedLines) {
    if (change.row >= 0 && change.row < lines.length) {
      lines[change.row] = change.content;
    }
  }
  return {
    ...terminal,
    lines,
    cursor: delta.cursor ?? terminal.cursor,
    version: delta.version,
  };
};

export const applyServerMessage = (
  snapshot: ArenaSnapshot,
  message: ServerToClientMessage
): ArenaSnapshot => {
  switch (message.type) {
    case 'snapshot':
      return message.snapshot;
    case 'agent-state':
      return replaceAgent(snapshot, message.snapshot);
    case 'agent-terminal': {
      const agent = snapshot.agents.find((a) => a.name === message.agent);
      if (!agent) return snapshot;

      // Strict version check: reject if not sequential
      if (message.delta.version !== agent.terminal.version + 1) {
        // Version gap — caller should request a full snapshot
        return snapshot;
      }

      const updatedTerminal = applyDelta(agent.terminal, message.delta);
      return replaceAgent(snapshot, { ...agent, terminal: updatedTerminal });
    }
    case 'agent-terminal-snapshot': {
      const agent = snapshot.agents.find((a) => a.name === message.agent);
      if (!agent) return snapshot;
      return replaceAgent(snapshot, { ...agent, terminal: message.snapshot });
    }
    case 'error':
      return snapshot;
    default:
      return snapshot;
  }
};

export const detectVersionGap = (
  snapshot: ArenaSnapshot,
  message: ServerToClientMessage
): string | null => {
  if (message.type !== 'agent-terminal') return null;
  const agent = snapshot.agents.find((a) => a.name === message.agent);
  if (!agent) return null;
  if (message.delta.version !== agent.terminal.version + 1) {
    return message.agent;
  }
  return null;
};

export { isTerminalStatus };

export const hasActiveAgents = (snapshot: ArenaSnapshot): boolean =>
  snapshot.agents.some((agent) => !isTerminalStatus(agent.status));
