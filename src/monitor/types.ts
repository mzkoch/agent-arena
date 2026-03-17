import type { EventEmitter } from 'node:events';

// Agent lifecycle status
export type AgentStatus = 'pending' | 'running' | 'idle' | 'completed' | 'failed' | 'killed';

// Per-agent state tracked by orchestrator
export interface AgentState {
  variantName: string;
  provider: string;
  model: string;
  status: AgentStatus;
  pid?: number;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number;
  error?: string;
}

// Full arena status snapshot
export interface ArenaStatus {
  repoPath: string;
  agents: AgentState[];
  startedAt: string;
}

// --- IPC Wire Protocol (NDJSON) ---

// Server → Client
export interface SnapshotMessage {
  type: 'snapshot';
  status: ArenaStatus;
  outputBuffers: Record<string, string[]>;
}

export interface AgentOutputEvent {
  type: 'agent-output';
  variantName: string;
  line: string;
}

export interface AgentCompletedEvent {
  type: 'agent-completed';
  variantName: string;
  exitCode: number | null;
}

export interface AgentStartedEvent {
  type: 'agent-started';
  variantName: string;
  pid: number;
}

export interface AgentErrorEvent {
  type: 'agent-error';
  variantName: string;
  error: string;
}

export type ArenaEvent =
  | AgentOutputEvent
  | AgentCompletedEvent
  | AgentStartedEvent
  | AgentErrorEvent;

export interface EventMessage {
  type: 'event';
  event: ArenaEvent;
}

// Client → Server
export interface InputMessage {
  type: 'input';
  variantName: string;
  data: string;
}

export type ServerMessage = SnapshotMessage | EventMessage;
export type ClientMessage = InputMessage;

// --- ArenaProvider interface ---
// Abstraction used by the TUI. Both Orchestrator and RemoteMonitor implement this.

export interface ArenaProvider extends EventEmitter {
  getStatus(): ArenaStatus;
  getOutputBuffer(variantName: string): string[];
  sendInput(variantName: string, data: string): void;
  killAgent(variantName: string): Promise<void>;
  restartAgent(variantName: string): Promise<void>;
  shutdown(): Promise<void>;

  // Events emitted:
  // 'agent-output' (variantName: string, line: string)
  // 'agent-started' (variantName: string, pid: number)
  // 'agent-completed' (variantName: string, exitCode: number | null)
  // 'agent-error' (variantName: string, error: string)
  // 'status-changed' ()
}

// Session file written by headless launcher for monitor to find
export interface ArenaSession {
  port: number;
  pid: number;
  startedAt: string;
  repoPath: string;
  variants: string[];
}
