# Issue #10: Arena config and requirements should live inside .arena/

## Problem

Arena config (`arena.json`) and requirements (`requirements.md`) files are currently passed as external file paths via `--config` and `--requirements` CLI flags, then copied into `.arena/` at init time. This creates repo root pollution and a confusing dual-source-of-truth.

## Goal

Make `.arena/` the single, self-contained home for all arena artifacts. The CLI should auto-discover config and requirements from `.arena/` without requiring path flags. Arena infrastructure (orchestrator, agents, CLI) must not create or modify any files outside of `.arena/`.

## Requirements

### CLI Workflow

- `arena init` creates `.arena/` and scaffolds `arena.json` + `requirements.md` inside it (or copies them in if source paths are provided).
- `arena launch`, `arena monitor`, `arena status`, and `arena evaluate` auto-discover `.arena/arena.json` and `.arena/requirements.md` — no `--config` / `--requirements` flags needed.
- Remove the `--config` and `--requirements` flags entirely. Backward compatibility with the old flag-based interface is not required.
- `arena clean` behavior is unchanged (already operates on `.arena/`).

### Multiple Arena Support

- Support multiple concurrent arenas within the same repository, each with its own config and requirements files.
- Each arena session should be independently addressable (e.g. by name or subdirectory under `.arena/`).
- `arena init`, `arena launch`, `arena monitor`, `arena status`, `arena evaluate`, and `arena clean` should accept an optional arena name/identifier to target a specific arena.
- When no identifier is provided, commands should operate on a default arena or prompt if multiple exist.

### File Containment Guardrail

- All arena artifacts (session files, logs, reports, worktree metadata) must live inside `.arena/`.
- The orchestrator, agent infrastructure, and CLI must not write, create, or modify any files outside `.arena/` (except the one-time `.gitignore` entry for `.arena/`).

### Conventions

- `.arena/` should be added to `.gitignore` so arena artifacts are never committed to the host repo.
- All arena state files and assets live in `.arena/`.

### Testing

- All existing tests must continue to pass.
- New or updated tests must cover the changed CLI interface and auto-discovery behavior.
- Business-logic test coverage must remain above 80%.

### Documentation

- Update README.md, DESIGN.md, and AGENTS.md to reflect the new CLI workflow (no flags, auto-discovery from `.arena/`).
