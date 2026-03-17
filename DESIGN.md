# Agent Arena Design

## Goals

Agent Arena must:

- create isolated git worktrees for each competing agent variant
- launch provider-specific agent CLIs in PTYs on macOS, Linux, and Windows
- expose both a local Ink TUI and a remote monitor path through headless IPC
- detect completion through provider-specific status markers
- evaluate worktrees and summarize results in a comparison report
- support multiple concurrent arenas within the same repository

## Architecture Decisions

### 1. `.arena/` project folder with same-repo worktrees

All arena state lives in a single `.arena/` directory inside the user's project. Each arena session gets its own named subdirectory:

```
my-project/
├── .arena/
│   ├── default/                  # the "default" arena
│   │   ├── arena.json            # config
│   │   ├── requirements.md       # requirements doc
│   │   ├── session.json          # IPC/session state
│   │   ├── comparison-report.md  # evaluation output
│   │   ├── logs/                 # agent logs
│   │   └── worktrees/
│   │       ├── variant-a/        # git worktree (branch: arena/variant-a)
│   │       └── variant-b/        # git worktree (branch: arena/variant-b)
│   └── experiment/               # a second arena
│       ├── arena.json
│       ├── requirements.md
│       └── worktrees/
│           └── variant-c/
├── src/
├── package.json
└── .gitignore                    # just add: .arena/
```

Worktrees are branches on the user's own repository (`arena/<name>`), not a separate repo. This means:

- **One-line gitignore**: `.arena/` contains all artifacts
- **Direct PRs**: `git merge arena/variant-a` or a GitHub PR from `arena/variant-a` → `main`
- **Clean diffing**: `git diff main..arena/variant-a` works natively
- **No copy step**: no need to copy files out of a separate repo

### 2. Multiple Arena Support

Each arena session is an independent subdirectory under `.arena/`. The CLI resolves which arena to operate on:

- If a name is provided as a positional argument (e.g. `arena launch my-arena`), use that arena.
- If only one arena exists, use it automatically.
- If no arenas exist, use "default" as the arena name.
- If multiple arenas exist and no name is specified, error with the list of available arenas.

### 3. ArenaProject abstraction

`src/project/arena-project.ts` encapsulates the `.arena/<name>/` directory layout as a first-class object. It handles:

- Creating new arena projects (copying config, creating directory structure)
- Scaffolding new arenas with default config and requirements
- Loading existing projects by name with auto-discovery
- Computing workspace paths for each variant
- Managing `.gitignore` entries

### 4. Zero-arg convention-over-configuration

All CLI commands work with zero positional arguments when a single arena exists. The config discovery flow:

1. Find the git root from the current working directory
2. Scan `.arena/` for named subdirectories containing `arena.json`
3. If exactly one exists, use it; if none exist, default to "default"; if multiple exist, require an explicit name

No `--config` or `--requirements` flags are needed. The `init` command optionally accepts `--config` and `--requirements` to copy external files into the arena; without them, it scaffolds a default config.

### 5. Separate CLI from library modules

`src/cli.ts` is a thin Commander entry point. Everything important lives in testable modules under `src/`, including:

- config loading and validation
- provider registry and prompt building
- git/worktree management
- IPC protocol, server, and client
- orchestration logic
- evaluation logic
- TUI adapters and components

This keeps the CLI surface small and preserves clean seams for tests and future embedding.

### 6. Dependency injection at the orchestration edge

`ArenaOrchestrator` accepts injected PTY and process-termination implementations. That keeps the runtime platform-specific but lets tests run with fake PTYs and stub process management.

### 7. PTY-first process management

The orchestrator is designed around PTYs rather than pipes so that interactive agent CLIs behave consistently:

- Unix uses `node-pty` backed by the native PTY implementation
- Windows uses `node-pty` backed by ConPTY

### 8. Event-based state propagation

The orchestrator emits full agent state updates and incremental output chunks. The same event model feeds both the local Ink TUI and the IPC server for headless monitoring.

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
  project/                   ArenaProject abstraction for .arena/ directory layout
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

All path construction uses Node's `path` utilities. Worktree and session paths are resolved from the git root so relative configs behave predictably.

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

The headless launcher writes `.arena/<name>/session.json`:

```json
{
  "port": 12345,
  "pid": 99999,
  "startedAt": "2026-01-01T00:00:00.000Z",
  "gitRoot": "/path/to/project",
  "variants": ["alpha", "beta"]
}
```

### Server to client

- `snapshot`
- `agent-output`
- `agent-state`
- `error`

### Client to server

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

The scorer produces a simple recommendation and writes `.arena/<name>/comparison-report.md`.

## Trade-offs

- The release packaging workflow is optimized for npm distribution first, with standalone binaries built in the release pipeline as a secondary channel.
- The TUI focuses on a robust dashboard/detail model and PTY interaction, while keeping rendering logic intentionally simple and test-independent.
- Evaluation is heuristic rather than semantic; it is designed to be fast, understandable, and easy to extend.
