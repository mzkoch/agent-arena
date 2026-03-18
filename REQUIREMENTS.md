# Refactor: New CLI Command Structure and Arena Workflow

## Overview

Refactor the arena CLI commands to separate project initialization from arena creation, add an accept workflow, add a list command, and make clean safe by default. This is a breaking change to the CLI surface.

## Current State

The CLI currently has these commands:
- `arena init [name]` — overloaded: scaffolds directory AND creates worktrees
- `arena launch [name] [--headless]` — launches agents
- `arena monitor [name]` — TUI dashboard
- `arena status [name]` — JSON status
- `arena evaluate [name]` — comparison report
- `arena clean [name]` — removes worktrees (unsafe, no unmerged check)

Currently, `REQUIREMENTS.md` and `ARENA-INSTRUCTIONS.md` are written to the worktree root. This means agents can accidentally commit them as part of their implementation.

## New Command Structure

### 1. `arena init`
**One-time project setup.** Creates `.arena/` directory at the git root and adds `.arena/` to `.gitignore`. No arguments needed. Should be idempotent — safe to run multiple times.

### 2. `arena create [name]`
**Create a new named arena.** Scaffolds `.arena/<name>/` with template files:
- `.arena/<name>/arena.json` — config template with placeholder variants
- `.arena/<name>/requirements.md` — empty requirements template

Options:
- `--config <path>` — copy an existing config file instead of using the template
- `--requirements <path>` — copy an existing requirements file instead of using the template

Validation:
- Arena name must be unique (no existing `.arena/<name>/` directory)
- Arena name validation: lowercase alphanumeric + hyphens, no path traversal, max 64 chars

### 3. `arena launch [name] [--headless]`
**Create worktrees and start agents.** This is where worktrees get created — not at `create` time. This allows the user/agent to edit config and requirements freely before committing to worktrees.

The launch command should:
1. Validate that `.arena/<name>/arena.json` and `.arena/<name>/requirements.md` exist
2. Create worktrees for each variant defined in the config
3. Write `REQUIREMENTS.md` and `ARENA-INSTRUCTIONS.md` into a `.arena/` subdirectory inside each worktree (e.g., `<worktree>/.arena/REQUIREMENTS.md` and `<worktree>/.arena/ARENA-INSTRUCTIONS.md`). This prevents agents from accidentally committing these files as part of their implementation. The `.arena/` directory inside each worktree should also be added to each worktree's `.gitignore`.
4. Update agent instruction files to reference the new paths (agents should be told to read from `.arena/REQUIREMENTS.md` and `.arena/ARENA-INSTRUCTIONS.md`)
5. Start agents

### 4. `arena list`
**List all arenas and their status.** Shows each arena name and current state (created, running, completed, etc.).

### 5. `arena accept [name] [variant]`
**Create a clean branch from a winning variant.** This is a lightweight handoff:
1. Validate the variant exists and has commits ahead of main
2. Create a new branch (e.g., `accept/<name>/<variant>`) from the variant's branch tip
3. Print instructions for next steps (verify, PR, merge)

Does NOT do verification, PR creation, or merging — that's the orchestrator agent's job.

### 6. `arena clean [name]`
**Remove worktrees safely.** Before removing:
1. Check each worktree branch for unpushed/unmerged commits
2. If unpushed work exists, warn and refuse unless `--force` is passed
3. `--force` flag to skip safety checks
4. `--keep-config` flag behavior remains

### 7. Existing commands (unchanged behavior)
- `arena monitor [name]` — unchanged
- `arena status [name]` — unchanged
- `arena evaluate [name]` — unchanged

## Migration from Old Commands

The old `arena init [name] --config <path> --requirements <path>` behavior should be removed. Users should use `arena create [name] --config <path> --requirements <path>` instead.

`arena init` with no arguments becomes the project-level setup command.

## Implementation Notes

- The `initializeArena()` function in `src/cli/runtime.ts` should be refactored into separate functions for each command
- Worktree creation should move to launch time
- Arena name validation (from opus-robust's bug-15 fix) should be included in `arena create`
- `REQUIREMENTS.md` and `ARENA-INSTRUCTIONS.md` must be written to `.arena/` inside each worktree, NOT the worktree root
- Each worktree should have `.arena/` in its `.gitignore` to prevent accidental commits
- Agent instructions must reference `.arena/REQUIREMENTS.md` and `.arena/ARENA-INSTRUCTIONS.md` as the file paths
- All existing tests must continue to pass (update as needed for new command structure)
- Add new tests for: `arena create`, `arena list`, `arena accept`, safe `arena clean`

## Validation

- `npm run build` must succeed
- `npm run lint` must pass with zero warnings
- `npx tsc --noEmit` must pass
- `npm run test` must pass
- `npx vitest run --coverage` — coverage must remain >80% on business-logic code
- Update README.md, DESIGN.md, and AGENTS.md to reflect the new command structure
