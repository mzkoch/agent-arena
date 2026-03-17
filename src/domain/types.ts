export type ProviderPromptDelivery = 'positional' | 'flag' | 'stdin';

export type AgentStatus =
  | 'pending'
  | 'running'
  | 'idle'
  | 'completed'
  | 'failed'
  | 'killed';

export interface CompletionProtocol {
  idleTimeoutMs: number;
  maxChecks: number;
  responseTimeoutMs: number;
  doneMarker: string;
  continueMarker: string;
}

export interface TrustedFoldersConfig {
  configFile: string;
  jsonKey: string;
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
  repoName: string;
  maxContinues: number;
  agentTimeoutMs: number;
  worktreeDir?: string | undefined;
  providers: Record<string, ProviderConfig>;
  variants: VariantConfig[];
}

export interface ArenaPaths {
  configPath: string;
  requirementsPath: string;
  repoPath: string;
  worktreeDir: string;
  sessionFilePath: string;
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
  lineCount: number;
  outputLines: string[];
  checksPerformed: number;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  exitCode?: number | undefined;
  error?: string | undefined;
  interactive: boolean;
}

export interface ArenaSnapshot {
  repoPath: string;
  startedAt: string;
  headless: boolean;
  agents: AgentSnapshot[];
}

export interface ArenaSessionFile {
  port: number;
  pid: number;
  startedAt: string;
  repoPath: string;
  variants: string[];
}

export interface EvaluationVariantMetrics {
  name: string;
  worktreePath: string;
  fileCount: number;
  testFileCount: number;
  hasReadme: boolean;
  hasDesignDoc: boolean;
  score: number;
  notes: string[];
}

export interface EvaluationReport {
  generatedAt: string;
  repoPath: string;
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
