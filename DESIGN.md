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
│   │       ├── variant-a/        # git worktree (branch: arena/default/variant-a)
│   │       │   ├── .arena/       # REQUIREMENTS.md & ARENA-INSTRUCTIONS.md (gitignored)
│   │       │   └── ...
│   │       └── variant-b/        # git worktree (branch: arena/default/variant-b)
│   │           ├── .arena/
│   │           └── ...
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
- **Direct PRs**: `git merge arena/default/variant-a` or a GitHub PR from `arena/default/variant-a` → `main`
- **Clean diffing**: `git diff main..arena/default/variant-a` works natively
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

The workflow is split into three phases:

1. `arena init` — one-time project setup (creates `.arena/` directory and `.gitignore` entry)
2. `arena create [name]` — scaffolds or copies config and requirements into `.arena/<name>/`
3. `arena launch [name]` — creates worktrees, writes variant files, and starts agents

This separation allows users to edit config and requirements freely before committing to worktrees.

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

### 9. Structured diagnostics logging

Arena writes structured diagnostics to `.arena/<name>/logs/` for post-mortem analysis of agent runs. All logging is fire-and-forget — logging failures never crash the arena.

#### File Layout

```
.arena/<name>/logs/
├── session.jsonl      # Structured event log (JSONL format)
├── alpha.log          # Raw PTY output for variant "alpha"
└── beta.log           # Raw PTY output for variant "beta"
```

#### JSONL Format

Each line in `session.jsonl` is a self-contained JSON object with at minimum `ts` (ISO 8601 timestamp) and `event` (event type string):

```json
{"ts":"2026-03-20T00:00:00.000Z","event":"arena.start","variants":["alpha","beta"],"maxContinues":50,"agentTimeoutMs":3600000}
{"ts":"2026-03-20T00:00:01.000Z","event":"agent.spawn","variant":"alpha","pid":12345,"command":"copilot","model":"gpt-4"}
{"ts":"2026-03-20T00:00:02.000Z","event":"agent.state","variant":"alpha","from":"pending","to":"running"}
```

#### Event Types

| Event | Description | Key Fields |
|---|---|---|
| `arena.start` | Arena session begins | variants, maxContinues, agentTimeoutMs |
| `agent.spawn` | Agent process launched | variant, pid, command, args, model, worktreePath |
| `agent.state` | Agent status transition | variant, from, to |
| `agent.idle_check` | Idle timeout triggered | variant, checksPerformed |
| `agent.idle_response` | Marker detected in output | variant, markerMatched (done/continue/null) |
| `agent.exit` | Agent process exited | variant, exitCode, durationMs, signal |
| `agent.complete` | Agent completed | variant, reason (done_marker/max_checks/process_exit), exitCode |
| `agent.fail` | Agent failed | variant, error, exitCode |
| `agent.model_recovery` | Model name corrected | variant, originalModel, resolvedModel |
| `arena.summary` | Session summary | agents array, errors, warnings |
| `warning` / `error` | Logger interface events | message, context fields |

#### Architecture

The `ArenaLogger` interface extends the base `Logger` interface with domain-specific methods (`logEvent`, `logPty`, `writeSummary`, `close`). `FileArenaLogger` implements this interface using async file handles for non-blocking I/O.

The logger is injected into `ArenaOrchestrator` via the `OrchestratorDependencies` interface as an optional field, accessed through optional chaining to maintain backward compatibility. `warn()` and `error()` calls are forwarded into the structured session log so diagnostics remain available even when stderr output is noisy or ephemeral.

## Module Layout

```text
src/
  cli.ts                     Commander entrypoint
  cli/runtime.ts             command helpers: projectInit, createArena, setupWorkspacesForLaunch, listArenas, acceptVariant, checkUnmergedWork
  config/                    Zod schemas and config/path resolution
  domain/                    shared types
  evaluation/                worktree scoring and markdown report generation
  git/                       command runner and git worktree utilities
  ipc/                       NDJSON protocol, TCP server/client, session file helpers
  orchestrator/              PTY lifecycle, idle detection, kill/restart logic
  project/                   ArenaProject abstraction for .arena/ directory layout
  prompt/                    per-worktree instructions and prompts
  providers/                 built-in providers, model discovery/cache, overrides, trusted folder helpers
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

### Signal Envelope Format

Completion signals use a structured envelope format to prevent false positives from agent reasoning output:

```
<<<ARENA_SIGNAL:{"status":"done"}>>>
<<<ARENA_SIGNAL:{"status":"continue"}>>>
```

The `<<<ARENA_SIGNAL:` prefix is virtually impossible to appear in normal agent output. The JSON payload is validated with Zod.

### Two-Layer Detection Strategy

Signal detection in `src/orchestrator/signal-detector.ts` uses two layers:

1. **Envelope detection** (preferred): Parses the `<<<ARENA_SIGNAL:...>>>` envelope format from plain text. If found, the envelope result takes priority.
2. **Legacy marker scanning** (fallback): Falls back to `string.includes()` scanning for `doneMarker` and `continueMarker` strings, preserving backward compatibility with agents that don't emit envelopes.

Envelope detection always takes priority when both formats are present in the same chunk.

### Orchestrator → Agent Feedback

When verification fails, the orchestrator sends structured feedback via PTY stdin:

```
<<<ARENA_COMMAND:{"action":"continue","reason":"No commits ahead of main. Commit your work."}>>>
```

Followed by a human-readable summary of what failed.

### Per-Provider Completion Protocol

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
4. If output contains a done signal (envelope or legacy marker), verification begins (see below)
5. If output contains a continue signal, the agent returns to `running`
6. If the agent never responds and `maxChecks` is reached, it is treated as completed

## Completion Verification

### Configuration

Verification is configured at the `ArenaConfig` level (not per-provider) as a policy decision about the arena:

```typescript
interface CompletionVerificationConfig {
  enabled: boolean;           // default: true
  requireCommit: boolean;     // default: true — agent must have commits ahead of base
  requireCleanWorktree: boolean; // default: true — no uncommitted changes
  command?: {                 // optional validation command
    command: string;
    args: string[];
    timeoutMs: number;        // default: 300_000
  };
}
```

### Verification Flow

When `completionVerification.enabled` is `true` and a done signal is detected:

1. Agent enters `'verifying'` status (non-terminal, shown in TUI)
2. Orchestrator runs `verifyWorkspaceCompletion()` against the agent's worktree
3. **If passed**: agent is marked `completed` with reason `'verified'`, exit command is sent
4. **If failed**: structured feedback is sent to the agent via PTY stdin, agent returns to `'running'`, timers are re-armed
5. **If agent exits during verification with non-zero code**: agent is failed
6. **If agent exits with code 0 before verification accepts**: agent is failed (`'unverified_exit'`)

When `completionVerification.enabled` is `false`, done signals trigger immediate completion (identical to the pre-verification behavior).

### Agent Status Lifecycle

```
pending → running ⇄ idle → completed | failed | killed
              ↓                ↑
          verifying ───────────┘ (failed verification → running)
              │
              └──→ completed (passed verification)
```

`AgentStatus`: `'pending' | 'running' | 'idle' | 'verifying' | 'completed' | 'failed' | 'killed'`

### Verification Checks

`verifyWorkspaceCompletion()` in `src/orchestrator/verification.ts` runs these checks in order:

1. **Commit count**: Resolves the base ref and counts commits ahead of it. Zero commits = failure.
2. **Clean worktree**: Runs `git status --porcelain` to detect uncommitted changes.
3. **Validation command**: Optionally runs a user-specified command (e.g., `npm test`) with timeout support.

All issues are collected and reported together, so the agent can address them all at once.

### CommandRunner Timeout Support

`CommandOptions.timeoutMs` enables process timeout for validation commands. When a command exceeds its timeout, the process is killed with SIGTERM and `CommandResult.timedOut` is set to `true`.

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

### Client to server

- `connect` — handshake with `clientType: 'controller' | 'monitor'`; server responds with `snapshot`
- `disconnect` — clean shutdown; server destroys socket
- `input` — send keystrokes to an agent's PTY
- `kill` — terminate an agent process
- `restart` — restart an agent process
- `request-snapshot` — request a full `TerminalSnapshot` for a specific agent (used for delta version-gap recovery)

### Server to client

- `snapshot` — full `ArenaSnapshot` sent after `connect` handshake
- `agent-terminal` — incremental `TerminalDelta` (version, changed lines, cursor) for a specific agent
- `agent-terminal-snapshot` — full `TerminalSnapshot` for a specific agent (response to `request-snapshot`)
- `agent-state` — agent metadata update (status, elapsed, pid, exit code — no terminal output)
- `error` — error message (e.g., monitor client attempted a mutating action)

### Connection lifecycle

1. Client opens TCP connection and sends `connect` with its `clientType`
2. Server registers the client type, adds it to `readySockets`, and responds with a `snapshot`
3. Server streams `agent-terminal` deltas and `agent-state` updates to all ready sockets
4. Monitor clients are read-only: the server rejects `input`, `kill`, and `restart` from monitor-type clients
5. Client sends `disconnect` before closing; server cleans up the socket gracefully
6. On unexpected disconnect, `ReconnectingIpcClient` retries with exponential backoff (1s base, 1.5× multiplier, max 10 retries)

### VirtualTerminal

Each agent's PTY output is processed through a `VirtualTerminal` wrapping `@xterm/headless` with `@xterm/addon-serialize`. The terminal:

- Accepts PTY data via a promise-queue write model using xterm's public `write(data, callback)` API
- Tracks dirty rows (marks all viewport rows on each write) and generates `TerminalDelta` diffs
- Serializes rows with ANSI escape codes preserved via `SerializeAddon.serialize({ range })` per row
- Maintains a plain-text accumulator (`stripAnsi`) for synchronous completion-marker detection
- Caches snapshots with a dirty flag to avoid redundant serialization

### Controller capabilities

The TUI derives behavior from a capabilities object rather than branching on mode strings:

```typescript
interface ArenaControllerCapabilities {
  mode: 'local' | 'monitor';
  canSendInput: boolean;
  canKill: boolean;
  canRestart: boolean;
  canResizePty: boolean;
}
```

Local controllers have full capabilities. Monitor controllers are read-only (`canSendInput: false`, etc.). The TUI conditionally renders keybindings based on these capabilities, and monitor mode skips the quit confirmation dialog.

## Evaluation Strategy

Evaluation is intentionally lightweight, deterministic, and now anchored to actual git output instead of inherited repository contents.

For each variant, the evaluator compares the worktree against a baseline branch (`main` when available, with compatibility fallbacks for common legacy setups) and records:

- whether the worktree has any net diff from the baseline
- commit count ahead of the baseline
- changed file count
- added and deleted line totals
- newly added test files versus the baseline
- README and DESIGN presence/change status for context

Zero-diff variants are explicitly marked as `No changes` and receive a score of `0`, even if they inherit a large repository or have intermediate commits that net out to no diff. Changed variants are ranked using the diff-aware metrics above, and the evaluator writes the resulting comparison report to `.arena/<name>/comparison-report.md`.

## Dynamic Model Validation

### Problem

When an invalid model name is used (e.g. `gemini-3-pro` instead of `gemini-3-pro-preview`), the agent silently fails at launch time. Hardcoding model lists is unsustainable because models change frequently.

### Architecture

Model validation is split into three layers:

1. **Provider Model Discovery** (`src/providers/model-discovery.ts`): Runs the provider CLI to discover available models. Each provider declares a `modelDiscovery` config with a command, args, and parse strategy. The `choices-flag` strategy parses `--model <model> (choices: ...)` output. A `supportedModels` static list on `ProviderConfig` serves as a fallback.

2. **Model Cache** (`src/providers/model-cache.ts`): Caches discovered models to `.arena/.model-cache.json` with a 1-hour TTL. Avoids shelling out on every config load.

3. **Validation Integration**: When `loadArenaConfig()` is called with a `gitRoot` option, it validates each variant's model against discovered models. Invalid models produce clear errors with Levenshtein-distance-based suggestions.

### Error Recovery

**Config time (pre-launch):** Invalid models detected during `loadArenaConfig()` produce errors like:
```
Invalid model "gemini-3-pro" for provider "copilot-cli". Did you mean "gemini-3-pro-preview"?
```

**Runtime (post-launch):** The `ArenaOrchestrator` detects early agent failures (within 15 seconds of launch with non-zero exit code). It looks up the closest valid model via the provider registry's discovery and retries once with the corrected model. The effective model is reflected in the agent snapshot so status/monitor show the actual model in use.

### Provider-Specific Behavior

- **copilot-cli**: Uses `copilot --help` with `choices-flag` parse strategy for model discovery.
- **claude-code**: No model discovery configured — validation is skipped since Claude Code accepts arbitrary model names/aliases.
- **Custom providers**: Can declare `modelDiscovery` in their config for runtime discovery, or `supportedModels` for a static allowlist.

### Type Extensions

`ProviderConfig` gained two optional fields:
- `modelDiscovery?: { command, args, parseStrategy }` — how to discover models at runtime
- `supportedModels?: string[]` — static fallback list

## Remote Branch Cleanup

### Architecture

Remote branch cleanup follows a three-layer architecture:

1. **CLI** (`src/cli.ts`) — Integrates the `--keep-remote` and `--force` flags, calls the orchestrator, prints plan/result summaries, sets `process.exitCode = 1` on errors.
2. **Orchestrator** (`src/git/remote-cleanup.ts`) — Implements a plan/execute split. The plan phase classifies branches into delete/skip lists without performing mutations. The execute phase performs deletions and collects per-branch results.
3. **Repository primitives** (`src/git/repository.ts`) — Provides `isRemoteReachable()`, `listRemoteRefs()`, `deleteRemoteBranch()`, `hasOpenPullRequest()`, and `isGhAvailable()` as methods on `GitRepositoryManager`.

### Key Design Decisions

- **Single `ls-remote --refs` call**: All needed refs (arena branches, accept refs, PR refs) are fetched in one network round-trip for efficiency.
- **Dual PR detection**: An upfront `gh auth status` check determines if GitHub CLI is available. If so, `gh pr list --head <branch>` is used per branch (with per-branch fallback to OID matching on failure). If not, OID matching against `refs/pull/*/head` is used for all branches.
- **Plan/execute split**: The user sees what will happen before any deletions start. The plan classifies branches; the execute phase acts on the plan. This gives transparency and testability.
- **Thorough accepted-variant detection**: Checks local branch, local tag, remote branch, and remote tag for `accept/<arena>/<variant>` refs.
- **Per-branch error resilience**: Failures on individual branch deletions are collected, not thrown. Remaining branches are still processed.
- **Remote cleanup before local cleanup**: Remote branch deletion runs before local worktree/branch cleanup so local tracking refs remain available for debugging.

### CLI Flags

- `--keep-remote` — Opt out of remote branch deletion (preserves pre-feature behavior).
- `--force` — Skips unmerged-work safety checks AND deletes remote branches with open PRs.

## Trade-offs

- The release packaging workflow is optimized for npm distribution first, with standalone binaries built in the release pipeline as a secondary channel.
- The TUI focuses on a robust dashboard/detail model and PTY interaction, while keeping rendering logic intentionally simple and test-independent.
- Evaluation is heuristic rather than semantic; it is designed to be fast, understandable, and easy to extend.
