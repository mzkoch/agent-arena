#!/usr/bin/env node

import { Command } from 'commander';
import React from 'react';
import { render } from 'ink';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, loadRequirements, resolveRepoPath, resolveWorktreeDir } from './config/loader.js';
import { Orchestrator } from './orchestrator/orchestrator.js';
import { IpcServer } from './monitor/ipc-server.js';
import { RemoteMonitor } from './monitor/ipc-client.js';
import { App } from './ui/App.js';
import { evaluateAll } from './evaluation/evaluator.js';
import { generateReport } from './evaluation/report-generator.js';
import { cleanWorktrees } from './utils/git.js';
import { getWorktreePath } from './utils/git.js';
import chalk from 'chalk';

const program = new Command();

program
  .name('arena')
  .description('Spawn multiple AI agents to build competing implementations')
  .version('1.0.0');

program
  .command('init')
  .description('Create git repo and worktrees for each variant')
  .argument('<config>', 'Path to arena.json config file')
  .argument('<requirements>', 'Path to requirements.md file')
  .action(async (configPath: string, _requirementsPath: string) => {
    try {
      const config = await loadConfig(configPath);
      const orchestrator = new Orchestrator(config, '');
      await orchestrator.init();
      console.log(chalk.green('✓ Repository and worktrees created'));
      console.log(`  Repo: ${orchestrator.getRepoPath()}`);
      console.log(`  Worktrees: ${orchestrator.getWorktreeDir()}`);
      for (const v of config.variants) {
        console.log(`    - ${v.name} (${v.provider})`);
      }
    } catch (err) {
      console.error(chalk.red('Error:'), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('launch')
  .description('Launch all agents')
  .argument('<config>', 'Path to arena.json config file')
  .argument('<requirements>', 'Path to requirements.md file')
  .option('--headless', 'Skip TUI, start IPC server instead')
  .option('--repo-path <path>', 'Path to existing repo (skip init)')
  .action(async (configPath: string, requirementsPath: string, opts: { headless?: boolean; repoPath?: string }) => {
    try {
      const config = await loadConfig(configPath);
      const requirements = await loadRequirements(requirementsPath);
      const orchestrator = new Orchestrator(config, requirements, opts.repoPath ? path.dirname(opts.repoPath) : undefined);

      // Init if no repo-path provided
      if (!opts.repoPath) {
        await orchestrator.init();
      }

      // Launch agents
      await orchestrator.launch();
      console.log(chalk.green(`✓ Launched ${config.variants.length} agents`));

      if (opts.headless) {
        // Start IPC server
        const ipcServer = new IpcServer(
          orchestrator,
          orchestrator.getRepoPath(),
          config.variants.map(v => v.name),
        );
        const port = await ipcServer.start();
        console.log(chalk.cyan(`IPC server listening on port ${port}`));

        // Graceful shutdown
        const shutdown = async () => {
          console.log(chalk.yellow('\nShutting down...'));
          await orchestrator.shutdown();
          await ipcServer.stop();
          process.exit(0);
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
      } else {
        // Show TUI
        const { waitUntilExit } = render(
          React.createElement(App, { provider: orchestrator }),
        );

        await waitUntilExit();
        await orchestrator.shutdown();
      }
    } catch (err) {
      console.error(chalk.red('Error:'), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('monitor')
  .description('Connect to running arena and show TUI')
  .argument('<config>', 'Path to arena.json config file')
  .argument('<requirements>', 'Path to requirements.md file')
  .option('--repo-path <path>', 'Path to repo with .arena-session.json')
  .action(async (configPath: string, _requirementsPath: string, opts: { repoPath?: string }) => {
    try {
      const config = await loadConfig(configPath);
      const repoPath = opts.repoPath ?? resolveRepoPath(config, process.cwd());

      const monitor = await RemoteMonitor.connectFromSession(repoPath);
      console.log(chalk.green('✓ Connected to arena session'));

      const { waitUntilExit } = render(
        React.createElement(App, { provider: monitor }),
      );

      await waitUntilExit();
      await monitor.shutdown();
    } catch (err) {
      console.error(chalk.red('Error:'), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Print JSON status of worktrees')
  .argument('<config>', 'Path to arena.json config file')
  .argument('<requirements>', 'Path to requirements.md file')
  .option('--repo-path <path>', 'Path to repo with .arena-session.json')
  .action(async (configPath: string, _requirementsPath: string, opts: { repoPath?: string }) => {
    try {
      const config = await loadConfig(configPath);
      const repoPath = opts.repoPath ?? resolveRepoPath(config, process.cwd());

      const monitor = await RemoteMonitor.connectFromSession(repoPath);

      // Wait for snapshot
      await new Promise<void>((resolve) => {
        monitor.on('snapshot', () => resolve());
        setTimeout(() => resolve(), 3000);
      });

      const status = monitor.getStatus();
      console.log(JSON.stringify(status, null, 2));
      await monitor.shutdown();
    } catch (err) {
      console.error(chalk.red('Error:'), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('evaluate')
  .description('Scan worktrees and generate comparison report')
  .argument('<config>', 'Path to arena.json config file')
  .argument('<requirements>', 'Path to requirements.md file')
  .option('--repo-path <path>', 'Path to repo')
  .action(async (configPath: string, _requirementsPath: string, opts: { repoPath?: string }) => {
    try {
      const config = await loadConfig(configPath);
      const base = opts.repoPath ? path.dirname(opts.repoPath) : process.cwd();
      const worktreeDir = resolveWorktreeDir(config, base);

      const variants = config.variants.map(v => ({
        name: v.name,
        worktreePath: getWorktreePath(worktreeDir, v.name),
      }));

      console.log(chalk.cyan('Evaluating worktrees...'));
      const evaluations = await evaluateAll(variants);
      const report = generateReport(evaluations);

      const reportPath = path.resolve('comparison-report.md');
      await fs.writeFile(reportPath, report, 'utf-8');
      console.log(chalk.green(`✓ Report written to ${reportPath}`));

      // Also print summary
      for (const ev of evaluations) {
        const icon = ev.score > 0 ? '✓' : '○';
        console.log(`  ${icon} ${ev.variantName}: ${ev.fileCount} files, ${ev.testFileCount} tests, score ${ev.score}`);
      }
    } catch (err) {
      console.error(chalk.red('Error:'), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('clean')
  .description('Remove all arena worktrees')
  .argument('<repo-path>', 'Path to the arena git repo')
  .action(async (repoPath: string) => {
    try {
      const resolved = path.resolve(repoPath);
      await cleanWorktrees(resolved);
      console.log(chalk.green('✓ All worktrees removed'));

      // Clean up session file
      try {
        await fs.unlink(path.join(resolved, '.arena-session.json'));
      } catch {
        // Might not exist
      }
    } catch (err) {
      console.error(chalk.red('Error:'), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse();
