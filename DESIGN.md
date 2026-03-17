# Agent Arena Design

## Goals

Agent Arena must:

- create isolated git worktrees for each competing agent variant
- launch provider-specific agent CLIs in PTYs on macOS, Linux, and Windows
- expose both a local Ink TUI and a remote monitor path through headless IPC
- detect completion through provider-specific status markers
- evaluate worktrees and summarize results in a comparison report

## Architecture Decisions

### 1. Separate CLI from library modules

`src/cli.ts` is a thin Commander entry point. Everything important lives in testable modules under `src/`, including:

- config loading and validation
- provider registry and prompt building
- git/worktree management
- IPC protocol, server, and client
- orchestration logic
- evaluation logic
- TUI adapters and components

This keeps the CLI surface small and preserves clean seams for tests and future embedding.

### 2. Dependency injection at the orchestration edge

`ArenaOrchestrator` accepts injected PTY and process-termination implementations. That keeps the runtime platform-specific but lets tests run with fake PTYs and stub process management.

### 3. PTY-first process management

The orchestrator is designed around PTYs rather than pipes so that interactive agent CLIs behave consistently:

- Unix uses `node-pty` backed by the native PTY implementation
- Windows uses `node-pty` backed by ConPTY

This matches the product requirement that Windows must use a real pseudo console rather than a pipe fallback.

### 4. Event-based state propagation

The orchestrator emits:

- full agent state updates
- incremental output chunks

The same event model feeds both:

- the local Ink TUI
- the IPC server for headless monitoring

That keeps the monitor client and the local dashboard aligned around one state contract.

## Module Layout

```text
src/
  cli.ts                     Commander entrypoint
  cli/runtime.ts             command helpers for init/load/cleanup
  config/                    Zod schemas and config/path resolution
  domain/                    shared types
  evaluation/                worktree scoring and markdown report generation
  git/                       command runner and git worktree utilities
  ipc/                       NDJSON protocol, TCP server/client, session file helpers
  orchestrator/              PTY lifecycle, idle detection, kill/restart logic
  prompt/                    per-worktree instructions and prompts
  providers/                 built-in providers, overrides, trusted folder helpers
  tui/                       Ink app, views, adapters, and state reducers
  utils/                     file, format, buffer, logging, and process helpers
```

## Cross-Platform Strategy

### PTY

`node-pty` provides a single API while still using native PTY/ConPTY implementations per OS.

### Process termination

- Unix: terminate the process group first, then the root process as fallback
- Windows: invoke `taskkill /T /F /PID`

### Paths

All path construction uses Node's `path` utilities. Worktree and session paths are resolved from the config file location so relative configs behave predictably.

### Line endings

Output buffering normalizes `\r\n` to `\n` before downstream parsing.

## Completion Detection Protocol

Each provider owns a `completionProtocol`:

- `idleTimeoutMs`
- `responseTimeoutMs`
- `maxChecks`
- `doneMarker`
- `continueMarker`

Flow:

1. Agent starts in `running`
2. If no output arrives within `idleTimeoutMs`, the orchestrator marks it `idle`
3. The orchestrator writes a status-check prompt into the PTY
4. If output contains `doneMarker`, the agent becomes `completed`
5. If output contains `continueMarker`, the agent returns to `running`
6. If the agent never responds and `maxChecks` is reached, it is treated as completed

## IPC Protocol

Transport: TCP on `127.0.0.1` with an OS-assigned random port.

Encoding: newline-delimited JSON (NDJSON).

### Session file

The headless launcher writes `.arena-session.json` in the arena repo root:

```json
{
  "port": 12345,
  "pid": 99999,
  "startedAt": "2026-01-01T00:00:00.000Z",
  "repoPath": "/path/to/repo",
  "variants": ["alpha", "beta"]
}
```

### Server → client

- `snapshot`
- `agent-output`
- `agent-state`
- `error`

### Client → server

- `input`
- `kill`
- `restart`

The monitor client receives a snapshot immediately on connect, then applies streamed updates to stay current.

## Evaluation Strategy

Evaluation is intentionally lightweight and deterministic:

- total file count
- test file count
- `README.md` present
- `DESIGN.md` present

The scorer produces a simple recommendation and writes `comparison-report.md`.

## Trade-offs

- The release packaging workflow is optimized for npm distribution first, with standalone binaries built in the release pipeline as a secondary channel.
- The TUI focuses on a robust dashboard/detail model and PTY interaction, while keeping rendering logic intentionally simple and test-independent.
- Evaluation is heuristic rather than semantic; it is designed to be fast, understandable, and easy to extend.
