#!/usr/bin/env node

import { access, rm } from 'node:fs/promises';
import { Command } from 'commander';
import packageJson from '../package.json';
import { findGitRoot } from './config/load';
import { evaluateWorkspaces, writeComparisonReport } from './evaluation/report';
import { readSessionFile, writeSessionFile } from './ipc/session-file';
import { ArenaIpcClient } from './ipc/client';
import { ArenaIpcServer } from './ipc/server';
import { ArenaOrchestrator } from './orchestrator/arena-orchestrator';
import { createLogger } from './utils/logger';
import { LocalArenaController, RemoteArenaController } from './tui/controller';
import { renderArenaApp } from './tui/render';
import { hasActiveAgents } from './tui/state';
import {
  ensureSessionFile,
  initializeArena,
  isArenaInitialized,
  loadRuntimeContext,
  removeSessionFile
} from './cli/runtime';
import type { ArenaSnapshot } from './domain/types';
import { GitRepositoryManager } from './git/repository';
import { NodeCommandRunner } from './git/command-runner';

const program = new Command();

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const waitForCompletion = async (
  orchestrator: ArenaOrchestrator,
  headless: boolean
): Promise<ArenaSnapshot> =>
  new Promise((resolve) => {
    const maybeResolve = (): void => {
      const snapshot = orchestrator.getSnapshot(headless);
      if (!hasActiveAgents(snapshot)) {
        orchestrator.off('message', maybeResolve);
        resolve(snapshot);
      }
    };

    orchestrator.on('message', maybeResolve);
    maybeResolve();
  });

const registerCleanup = (
  cleanup: () => Promise<void>
): (() => void) => {
  const handler = (): void => {
    void cleanup().finally(() => {
      process.exit(0);
    });
  };

  process.once('SIGINT', handler);
  process.once('SIGTERM', handler);

  return () => {
    process.off('SIGINT', handler);
    process.off('SIGTERM', handler);
  };
};

program
  .name('arena')
  .description('Cross-platform arena for competing autonomous coding agents.')
  .showHelpAfterError()
  .option('-v, --verbose', 'Increase log verbosity');

program
  .command('init')
  .argument('[name]', 'Arena name (default: "default")')
  .option('--config <path>', 'Path to arena.json to copy into .arena/<name>/')
  .option('--requirements <path>', 'Path to requirements.md to copy into .arena/<name>/')
  .action(async (name: string | undefined, options: { config?: string; requirements?: string }) => {
    const logger = createLogger(Boolean(program.opts().verbose));
    const gitRoot = await findGitRoot();

    const hasBothSources = Boolean(options.config) && Boolean(options.requirements);
    const hasEitherSource = Boolean(options.config) || Boolean(options.requirements);

    if (hasEitherSource && !hasBothSources) {
      throw new Error(
        'Both --config and --requirements must be provided together, or omit both to scaffold a new arena.'
      );
    }

    const context = await initializeArena(
      gitRoot,
      {
        configSource: options.config,
        requirementsSource: options.requirements,
        arenaName: name
      },
      logger
    );

    process.stdout.write(
      `Initialized arena "${context.paths.arenaName}" at ${context.paths.arenaDir} with ${context.workspaces.length} worktrees.\n`
    );
  });

program
  .command('launch')
  .argument('[name]', 'Arena name')
  .option('--headless', 'Run without local TUI')
  .action(async (name: string | undefined, options: { headless?: boolean }) => {
    const logger = createLogger(Boolean(program.opts().verbose));
    const context = await loadRuntimeContext(name, logger);

    if (!(await isArenaInitialized(context.paths))) {
      throw new Error(
        'Arena not initialized. Run "arena init" first.'
      );
    }

    const orchestrator = new ArenaOrchestrator(
      context.config,
      context.workspaces,
      context.paths.gitRoot,
      logger
    );

    const server = new ArenaIpcServer({
      logger,
      snapshotProvider: () => ({
        type: 'snapshot',
        snapshot: orchestrator.getSnapshot(Boolean(options.headless))
      }),
      onMessage: async (message) => {
        switch (message.type) {
          case 'input':
            orchestrator.sendInput(message.agent, message.data);
            break;
          case 'kill':
            await orchestrator.killAgent(message.agent);
            break;
          case 'restart':
            await orchestrator.restartAgent(message.agent);
            break;
        }
      }
    });

    orchestrator.on('message', (message) => {
      server.broadcast(message);
    });

    const port = await server.listen();
    await writeSessionFile(
      context.paths.sessionFilePath,
      ensureSessionFile(context.paths, {
        port,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        gitRoot: context.paths.gitRoot,
        variants: context.workspaces.map((workspace) => workspace.variant.name)
      })
    );

    await orchestrator.startAll();

    let cleaned = false;
    const cleanup = async (): Promise<void> => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      await orchestrator.close();
      await server.close();
      await removeSessionFile(context.paths.sessionFilePath);
    };

    const unregisterCleanup = registerCleanup(cleanup);

    if (options.headless || !process.stdout.isTTY) {
      process.stdout.write(
        `Headless arena running. Git root: ${context.paths.gitRoot} | Port: ${port} | Session: ${context.paths.sessionFilePath}\n`
      );
      const snapshot = await waitForCompletion(orchestrator, true);
      unregisterCleanup();
      await cleanup();
      process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
      return;
    }

    const controller = new LocalArenaController(orchestrator);
    await renderArenaApp(controller, 'Agent Arena', async () => {
      unregisterCleanup();
      await cleanup();
    });
  });

program
  .command('monitor')
  .argument('[name]', 'Arena name')
  .action(async (name: string | undefined) => {
    const logger = createLogger(Boolean(program.opts().verbose));
    const context = await loadRuntimeContext(name, logger);
    const session = await readSessionFile(context.paths.sessionFilePath);
    const client = new ArenaIpcClient();
    const snapshotMessage = await client.connect(session.port);
    const controller = new RemoteArenaController(client, snapshotMessage.snapshot);
    await renderArenaApp(controller, 'Agent Arena Monitor', () => {
      client.close();
    });
  });

program
  .command('status')
  .argument('[name]', 'Arena name')
  .action(async (name: string | undefined) => {
    const logger = createLogger(Boolean(program.opts().verbose));
    const context = await loadRuntimeContext(name, logger);

    if (await fileExists(context.paths.sessionFilePath)) {
      const session = await readSessionFile(context.paths.sessionFilePath);
      const client = new ArenaIpcClient();
      const snapshot = await client.connect(session.port);
      process.stdout.write(`${JSON.stringify(snapshot.snapshot, null, 2)}\n`);
      client.close();
      return;
    }

    const offlineSnapshot = {
      gitRoot: context.paths.gitRoot,
      startedAt: new Date(0).toISOString(),
      headless: false,
      agents: context.workspaces.map((workspace) => ({
        name: workspace.variant.name,
        provider: workspace.variant.provider,
        model: workspace.variant.model,
        branch: workspace.variant.branch,
        worktreePath: workspace.worktreePath,
        status: 'pending' as const,
        elapsedMs: 0,
        lineCount: 0,
        outputLines: [],
        checksPerformed: 0,
        interactive: false
      }))
    };
    process.stdout.write(`${JSON.stringify(offlineSnapshot, null, 2)}\n`);
  });

program
  .command('evaluate')
  .argument('[name]', 'Arena name')
  .action(async (name: string | undefined) => {
    const logger = createLogger(Boolean(program.opts().verbose));
    const context = await loadRuntimeContext(name, logger);
    const report = await evaluateWorkspaces(context.paths.gitRoot, context.workspaces);
    const reportPath = await writeComparisonReport(context.paths.reportPath, report);
    process.stdout.write(`${reportPath}\n`);
  });

program
  .command('clean')
  .argument('[name]', 'Arena name')
  .option('--keep-config', 'Keep arena.json and requirements.md')
  .action(async (name: string | undefined, options: { keepConfig?: boolean }) => {
    const logger = createLogger(Boolean(program.opts().verbose));
    const context = await loadRuntimeContext(name, logger);

    const repository = new GitRepositoryManager(new NodeCommandRunner(), logger);
    const branches = context.config.variants.map((v) => v.branch);
    await repository.clean(context.paths.gitRoot, branches);
    await removeSessionFile(context.paths.sessionFilePath);

    if (!options.keepConfig) {
      await rm(context.paths.arenaDir, { recursive: true, force: true });
      process.stdout.write(`Cleaned arena "${context.paths.arenaName}" at ${context.paths.arenaDir}.\n`);
    } else {
      process.stdout.write(`Cleaned arena worktrees and branches (kept config).\n`);
    }
  });

program.command('version').action(() => {
  process.stdout.write(`${packageJson.version}\n`);
});

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
