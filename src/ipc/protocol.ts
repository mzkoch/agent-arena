import type { AgentSnapshot, AgentStatus, ArenaSnapshot } from '../domain/types';
import type { TerminalDelta, TerminalSnapshot } from '../terminal/types';

export interface SnapshotMessage {
  type: 'snapshot';
  snapshot: ArenaSnapshot;
}

export interface AgentTerminalMessage {
  type: 'agent-terminal';
  agent: string;
  delta: TerminalDelta;
}

export interface AgentTerminalSnapshotMessage {
  type: 'agent-terminal-snapshot';
  agent: string;
  snapshot: TerminalSnapshot;
}

export interface AgentStateMessage {
  type: 'agent-state';
  agent: string;
  status: AgentStatus;
  snapshot: AgentSnapshot;
}

export interface ServerErrorMessage {
  type: 'error';
  message: string;
}

export type ServerToClientMessage =
  | SnapshotMessage
  | AgentTerminalMessage
  | AgentTerminalSnapshotMessage
  | AgentStateMessage
  | ServerErrorMessage;

export interface InputMessage {
  type: 'input';
  agent: string;
  data: string;
}

export interface KillMessage {
  type: 'kill';
  agent: string;
}

export interface RestartMessage {
  type: 'restart';
  agent: string;
}

export interface ConnectMessage {
  type: 'connect';
  clientType: 'controller' | 'monitor';
}

export interface DisconnectMessage {
  type: 'disconnect';
}

export interface RequestSnapshotMessage {
  type: 'request-snapshot';
  agent: string;
}

export type ClientToServerMessage =
  | InputMessage
  | KillMessage
  | RestartMessage
  | ConnectMessage
  | DisconnectMessage
  | RequestSnapshotMessage;

export const MUTATING_MESSAGE_TYPES = new Set<string>(['input', 'kill', 'restart']);

export const serializeNdjsonMessage = (
  message: ServerToClientMessage | ClientToServerMessage
): string => `${JSON.stringify(message)}\n`;

export class NdjsonParser<TMessage> {
  private buffer = '';

  public push(chunk: string): TMessage[] {
    this.buffer += chunk;
    const messages: TMessage[] = [];
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        messages.push(JSON.parse(trimmed) as TMessage);
      }
    }

    return messages;
  }
}
