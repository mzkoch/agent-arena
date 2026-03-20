import type { AgentStatus, Logger } from '../domain/types';

export interface AgentSummaryEntry {
  variant: string;
  status: AgentStatus;
  durationMs: number;
  exitCode?: number | undefined;
  completionReason?: string | undefined;
  changedFiles?: number | undefined;
  linesAdded?: number | undefined;
}

export interface ArenaSummary {
  agents: AgentSummaryEntry[];
  errors: string[];
  warnings: string[];
}

export interface ArenaLogger extends Logger {
  /** Log a structured event to session.jsonl */
  logEvent(event: string, data?: Record<string, unknown>): void;
  /** Capture raw PTY output for a variant */
  logPty(variant: string, chunk: string): void;
  /** Write completion summary */
  writeSummary(summary: ArenaSummary): void;
  /** Flush and close all file handles */
  close(): Promise<void>;
}
