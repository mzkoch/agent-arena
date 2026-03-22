import type { TerminalSnapshot } from '../terminal/types';

export type ProviderPromptDelivery = 'positional' | 'flag' | 'stdin';

export type AgentStatus =
  | 'pending'
  | 'running'
  | 'idle'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'killed';

/** Terminal statuses that must never revert to a non-terminal status. */
export const isTerminalStatus = (status: AgentStatus): boolean =>
  status === 'completed' || status === 'failed' || status === 'killed';

export interface CompletionVerificationCommand {
  command: string;
  args: string[];
  timeoutMs: number;
}

export interface CompletionVerificationConfig {
  enabled: boolean;
  requireCommit: boolean;
  requireCleanWorktree: boolean;
  command?: CompletionVerificationCommand | undefined;
}

export interface CompletionProtocol {
  idleTimeoutMs: number;
  maxChecks: number;
  responseTimeoutMs: number;
  doneMarker: string;
  continueMarker: string;
}

export interface FlatArrayTrustedFoldersConfig {
  strategy: 'flat-array';
  configFile: string;
  jsonKey: string;
}

export interface NestedObjectTrustedFoldersConfig {
  strategy: 'nested-object';
  configFile: string;
  jsonKey: string;
  nestedKey: string;
}

export type TrustedFoldersConfig =
  | FlatArrayTrustedFoldersConfig
  | NestedObjectTrustedFoldersConfig;

export interface ModelDiscoveryConfig {
  command: string;
  args: string[];
  parseStrategy: string;
}

export interface ProviderConfig {
  command: string;
  baseArgs: string[];
  modelFlag?: string | undefined;
  promptDelivery: ProviderPromptDelivery;
  promptFlag?: string | undefined;
  maxContinuesFlag?: string | undefined;
  exitCommand: string;
  completionProtocol: CompletionProtocol;
  trustedFolders?: TrustedFoldersConfig | undefined;
  modelDiscovery?: ModelDiscoveryConfig | undefined;
  supportedModels?: string[] | undefined;
}

export interface VariantConfig {
  name: string;
  provider: string;
  model: string;
  techStack: string;
  designPhilosophy: string;
  branch: string;
}

export interface ArenaConfig {
  repoName?: string | undefined;
  maxContinues: number;
  agentTimeoutMs: number;
  completionVerification: CompletionVerificationConfig;
  providers: Record<string, ProviderConfig>;
  variants: VariantConfig[];
}

export interface ArenaPaths {
  arenaName: string;
  configPath: string;
  requirementsPath: string;
  gitRoot: string;
  arenaDir: string;
  worktreeDir: string;
  sessionFilePath: string;
  logDir: string;
  reportPath: string;
}

export interface VariantWorkspace {
  variant: VariantConfig;
  worktreePath: string;
}

export interface AgentSnapshot {
  name: string;
  provider: string;
  model: string;
  branch: string;
  worktreePath: string;
  status: AgentStatus;
  pid?: number | undefined;
  elapsedMs: number;
  terminal: TerminalSnapshot;
  checksPerformed: number;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  exitCode?: number | undefined;
  completionReason?: string | undefined;
  error?: string | undefined;
  interactive: boolean;
}

export interface ArenaSnapshot {
  gitRoot: string;
  startedAt: string;
  headless: boolean;
  agents: AgentSnapshot[];
}

export interface ArenaSessionFile {
  port: number;
  pid: number;
  startedAt: string;
  gitRoot: string;
  variants: string[];
}

export interface EvaluationVariantMetrics {
  name: string;
  worktreePath: string;
  baseRef: string;
  hasChanges: boolean;
  commitCount: number;
  changedFileCount: number;
  addedLineCount: number;
  deletedLineCount: number;
  newTestFileCount: number;
  fileCount: number;
  testFileCount: number;
  hasReadme: boolean;
  hasDesignDoc: boolean;
  readmeChanged: boolean;
  designDocChanged: boolean;
  score: number;
  notes: string[];
}

export interface EvaluationReport {
  generatedAt: string;
  gitRoot: string;
  baseRef: string;
  winner: string;
  variants: EvaluationVariantMetrics[];
  markdown: string;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}
