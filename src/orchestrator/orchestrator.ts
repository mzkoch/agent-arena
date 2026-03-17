import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ArenaConfig } from '../config/types.js';
import { resolveWorktreeDir, resolveRepoPath } from '../config/loader.js';
import type { AgentProvider } from '../providers/types.js';
import { buildProviderRegistry, getProvider } from '../providers/registry.js';
import { AgentRunner } from './agent-runner.js';
import { writePromptFiles, buildInitialPrompt } from './prompt-builder.js';
import { initRepo, createWorktree, getWorktreePath, cleanWorktrees } from '../utils/git.js';
import type { ArenaProvider, ArenaStatus, AgentState } from '../monitor/types.js';

export class Orchestrator extends EventEmitter implements ArenaProvider {
  private config: ArenaConfig;
  private requirements: string;
  private repoPath: string;
  private worktreeDir: string;
  private providerRegistry: Record<string, AgentProvider>;
  private runners: Map<string, AgentRunner> = new Map();
  private startedAt: string;

  constructor(config: ArenaConfig, requirements: string, basePath?: string) {
    super();
    this.config = config;
    this.requirements = requirements;
    const base = basePath ?? process.cwd();
    this.repoPath = resolveRepoPath(config, base);
    this.worktreeDir = resolveWorktreeDir(config, base);
    this.providerRegistry = buildProviderRegistry(config.providers as Record<string, unknown> | undefined);
    this.startedAt = new Date().toISOString();
  }

  /**
   * Initialize the git repository and create worktrees for each variant.
   */
  async init(): Promise<void> {
    // Create repo
    await initRepo(this.repoPath);

    // Create worktrees
    for (const variant of this.config.variants) {
      const branch = variant.branch ?? `variant/${variant.name}`;
      const wtPath = getWorktreePath(this.worktreeDir, variant.name);
      await createWorktree(this.repoPath, wtPath, branch);
    }
  }

  /**
   * Set up trusted folders for all providers that need it.
   */
  async setupTrustedFolders(): Promise<void> {
    // Collect worktree paths
    const worktreePaths = this.config.variants.map(v =>
      getWorktreePath(this.worktreeDir, v.name)
    );

    // Get unique providers used by variants
    const usedProviders = new Set(this.config.variants.map(v => v.provider));

    for (const providerName of usedProviders) {
      const provider = getProvider(this.providerRegistry, providerName);
      if (!provider.trustedFolders) continue;

      const configFile = provider.trustedFolders.configFile.replace('~', os.homedir());
      const jsonKey = provider.trustedFolders.jsonKey;

      // Read existing config or create empty object
      let configData: Record<string, unknown> = {};
      try {
        const raw = await fs.readFile(configFile, 'utf-8');
        configData = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // File doesn't exist or invalid JSON, start fresh
        await fs.mkdir(path.dirname(configFile), { recursive: true });
      }

      // Merge worktree paths into the trusted folders array
      const existing = Array.isArray(configData[jsonKey]) ? configData[jsonKey] as string[] : [];
      const merged = [...new Set([...existing, ...worktreePaths])];
      configData[jsonKey] = merged;

      await fs.writeFile(configFile, JSON.stringify(configData, null, 2), 'utf-8');
    }
  }

  /**
   * Launch all agents. Writes prompt files and starts runners.
   */
  async launch(): Promise<void> {
    await this.setupTrustedFolders();

    for (const variant of this.config.variants) {
      const provider = getProvider(this.providerRegistry, variant.provider);
      const wtPath = getWorktreePath(this.worktreeDir, variant.name);

      // Write requirements and instructions into worktree
      await writePromptFiles(wtPath, this.requirements, variant, provider.completionProtocol);

      // Create and start runner
      const runner = new AgentRunner({
        variantName: variant.name,
        provider,
        model: variant.model,
        worktreePath: wtPath,
        initialPrompt: buildInitialPrompt(),
        maxContinues: this.config.maxContinues,
        timeoutMs: this.config.agentTimeoutMs,
      });

      this.setupRunnerListeners(runner);
      this.runners.set(variant.name, runner);
      runner.start();
    }
  }

  private setupRunnerListeners(runner: AgentRunner): void {
    runner.on('output', (variantName: string, line: string) => {
      this.emit('agent-output', variantName, line);
    });
    runner.on('started', (variantName: string, pid: number) => {
      this.emit('agent-started', variantName, pid);
      this.emit('status-changed');
    });
    runner.on('completed', (variantName: string, exitCode: number | null) => {
      this.emit('agent-completed', variantName, exitCode);
      this.emit('status-changed');
    });
  }

  // --- ArenaProvider interface ---

  getStatus(): ArenaStatus {
    const agents: AgentState[] = this.config.variants.map(variant => {
      const runner = this.runners.get(variant.name);
      return {
        variantName: variant.name,
        provider: variant.provider,
        model: variant.model,
        status: runner?.status ?? 'pending',
        pid: runner?.pid,
        startedAt: runner?.startedAt,
        completedAt: runner?.completedAt,
        exitCode: runner?.exitCode,
        error: runner?.error,
      };
    });

    return {
      repoPath: this.repoPath,
      agents,
      startedAt: this.startedAt,
    };
  }

  getOutputBuffer(variantName: string): string[] {
    const runner = this.runners.get(variantName);
    return runner?.getOutputLines() ?? [];
  }

  sendInput(variantName: string, data: string): void {
    const runner = this.runners.get(variantName);
    if (runner) {
      runner.write(data);
    }
  }

  async killAgent(variantName: string): Promise<void> {
    const runner = this.runners.get(variantName);
    if (runner) {
      await runner.stop();
      this.emit('status-changed');
    }
  }

  async restartAgent(variantName: string): Promise<void> {
    const runner = this.runners.get(variantName);
    if (runner) {
      await runner.stop();
      runner.start();
      this.emit('status-changed');
    }
  }

  async shutdown(): Promise<void> {
    const stopPromises = Array.from(this.runners.values()).map(r => r.stop());
    await Promise.allSettled(stopPromises);
    this.emit('status-changed');
  }

  getRepoPath(): string {
    return this.repoPath;
  }

  getWorktreeDir(): string {
    return this.worktreeDir;
  }
}
