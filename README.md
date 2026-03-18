# Agent Arena

`arena` is a cross-platform CLI for running multiple autonomous coding agents in parallel, each inside its own git worktree, then monitoring, comparing, and evaluating the results from one place.

It is built with TypeScript, Commander, Ink, `node-pty`, and Zod, and is designed to work on macOS, Linux, and Windows.

## Why Agent Arena?

When you want several AI agents to compete on the same project brief, you usually end up juggling terminals, worktrees, prompts, and ad-hoc scripts. Agent Arena wraps that workflow into one tool:

- isolated git worktrees per variant, created as branches on your own repository
- all arena state contained in a single `.arena/` directory
- provider/model aware launch commands
- a live Ink TUI for dashboard and detail views
- headless mode with TCP/NDJSON IPC for monitoring from another terminal
- comparison report generation across variants

## Quick Start

Install from npm:

```bash
npm install -g agent-arena
```

### 1. Initialize the project

Run once per repository to create the `.arena/` directory and add it to `.gitignore`:

```bash
arena init
```

### 2. Create an arena

Scaffold a new arena with default config (edit `.arena/default/arena.json` and `.arena/default/requirements.md` afterwards):

```bash
arena create
```

Or create a named arena from existing files:

```bash
arena create my-experiment --config arena.json --requirements requirements.md
```

### 3. Launch agents

Create worktrees and start agents with the TUI:

```bash
arena launch
```

Launch headless, then monitor from another terminal:

```bash
arena launch --headless
arena monitor
```

### 4. Evaluate and accept

Check structured status:

```bash
arena status
```

Generate a comparison report:

```bash
arena evaluate
```

Accept a winning variant:

```bash
arena accept my-experiment copilot-node
```

### 5. Clean up

Clean worktrees and branches (with safety checks for unmerged work):

```bash
arena clean
arena clean --force        # skip unmerged work checks
arena clean --keep-config  # keep arena.json and requirements.md
```

### Multiple Arenas

Run multiple concurrent arenas by providing a name:

```bash
arena create alpha --config arena.json --requirements requirements.md
arena create beta --config arena2.json --requirements requirements2.md

arena launch alpha
arena launch beta --headless
arena list
arena status alpha
arena evaluate beta
arena accept alpha copilot-node
arena clean beta
```

When only one arena exists, the name is optional. When multiple arenas exist, you must specify which one to use.

## Project Layout

After `arena init` and `arena create`, your project looks like:

```
my-project/
├── .arena/
│   └── default/                # arena name (default when not specified)
│       ├── arena.json
│       ├── requirements.md
│       ├── session.json        # created during launch
│       ├── comparison-report.md # created by evaluate
│       ├── logs/
│       └── worktrees/
│           ├── copilot-node/   # branch: arena/default/copilot-node
│           │   ├── .arena/     # REQUIREMENTS.md & ARENA-INSTRUCTIONS.md (gitignored)
│           │   └── ...         # agent's implementation files
│           └── claude-fastify/ # branch: arena/default/claude-fastify
│               ├── .arena/
│               └── ...
├── src/
├── package.json
└── .gitignore                  # .arena/ added automatically
```

Each variant worktree is a branch on your own repo (`arena/<name>`), so you can:

- `git diff main..arena/default/copilot-node` to compare
- `git merge arena/default/copilot-node` to adopt the winner
- Open a GitHub PR from `arena/default/copilot-node` to `main`

Requirements and instructions are placed in `.arena/` inside each worktree (not at the worktree root) to prevent agents from accidentally committing them.

## CLI Reference

| Command | Description |
| --- | --- |
| `arena init` | One-time project setup: create `.arena/` and add to `.gitignore` |
| `arena create [name]` | Create a new arena with config and requirements templates |
| `arena launch [name] [--headless]` | Create worktrees, write variant files, and start agents |
| `arena list` | List all arenas and their status |
| `arena accept <name> <variant>` | Create a clean branch from a winning variant |
| `arena monitor [name]` | Attach the TUI to a running headless session |
| `arena status [name]` | Print JSON state for the arena |
| `arena evaluate [name]` | Scan worktrees and write comparison report |
| `arena clean [name] [--keep-config] [--force]` | Remove worktrees safely |
| `arena version` | Print the installed version |

`create` options:

- `--config <path>` copies an existing arena.json into `.arena/<name>/`
- `--requirements <path>` copies an existing requirements file into `.arena/<name>/`
- Both must be provided together, or omit both to scaffold default files

`clean` options:

- `--keep-config` keeps arena.json and requirements.md
- `--force` skips safety checks (unmerged commits, unpushed commits, uncommitted changes)

All commands auto-discover the arena from `.arena/`. When only one arena exists, the `[name]` argument is optional. When multiple arenas exist, you must specify which one.

Global flags:

- `-v, --verbose` enables structured debug logs on stderr
- `-h, --help` shows contextual help

## Configuration Reference

```json
{
  "maxContinues": 50,
  "agentTimeoutMs": 3600000,
  "providers": {},
  "variants": [
    {
      "name": "node-copilot",
      "provider": "copilot-cli",
      "model": "claude-sonnet-4.5",
      "techStack": "Node.js with Express, TypeScript",
      "designPhilosophy": "Focus on simplicity and DX",
      "branch": "arena/node-copilot"
    }
  ]
}
```

### Top-level fields

| Field | Required | Default | Notes |
| --- | --- | --- | --- |
| `repoName` | No | — | Optional, kept for backward compatibility |
| `maxContinues` | No | `50` | Passed to providers that expose a max-steps flag |
| `agentTimeoutMs` | No | `3600000` | Hard timeout per agent |
| `providers` | No | `{}` | Custom or overriding provider definitions |
| `variants` | Yes | — | One or more variant configs |

### Variant fields

| Field | Required | Default | Notes |
| --- | --- | --- | --- |
| `name` | Yes | — | Must match `^[a-z0-9-]+$` |
| `provider` | No | `copilot-cli` | Provider key to use |
| `model` | Yes | — | Provider-specific model name |
| `techStack` | Yes | — | Written into per-worktree instructions |
| `designPhilosophy` | Yes | — | Written into per-worktree instructions |
| `branch` | No | `arena/<name>` | Branch name for the worktree |

### Arena name validation

Arena names must be:
- Lowercase alphanumeric with hyphens only
- Start with a letter or digit
- Maximum 64 characters
- No path traversal characters (`.`, `/`, `\`)

## Provider System

Built-in providers:

- `copilot-cli`
- `claude-code`

Custom providers can override built-ins or define new ones:

```json
{
  "providers": {
    "my-agent": {
      "command": "my-agent-cli",
      "baseArgs": ["--autonomous"],
      "modelFlag": "--model",
      "promptDelivery": "flag",
      "promptFlag": "--prompt",
      "maxContinuesFlag": "--max-steps",
      "exitCommand": "/exit",
      "completionProtocol": {
        "idleTimeoutMs": 30000,
        "maxChecks": 3,
        "responseTimeoutMs": 60000,
        "doneMarker": "ARENA_DONE",
        "continueMarker": "ARENA_CONTINUING"
      },
      "trustedFolders": {
        "strategy": "flat-array",
        "configFile": "~/.my-agent/config.json",
        "jsonKey": "trusted_folders"
      }
    }
  }
}
```

The `trustedFolders` field is optional. When set, the arena pre-registers each worktree directory in the provider's config file before launching the agent, preventing interactive trust dialogs. Two strategies are supported:

- `flat-array`: folder path is appended to a JSON array (e.g. copilot-cli)
- `nested-object`: folder path becomes a key in a nested object with a boolean flag (e.g. claude-code). Requires an additional `nestedKey` field.

Prompt delivery modes:

- `positional`: append the prompt as the final CLI argument
- `flag`: pass the prompt through `promptFlag`
- `stdin`: launch first, then write the prompt to the PTY stdin

## TUI Keybindings

| Key | Context | Action |
| --- | --- | --- |
| `Tab` | Any | Select next agent |
| `1-9` | Any | Jump to agent N |
| `d` | Non-interactive | Toggle dashboard/detail |
| `Up/Down` | Dashboard | Change selected row |
| `Enter` | Dashboard | Open detail view |
| `i` | Detail | Enter interactive PTY mode |
| `Esc` | Interactive | Leave interactive mode |
| `k` | Detail | Kill the selected agent |
| `r` | Detail | Restart the selected agent |
| `q` | Non-interactive | Quit, with confirmation if agents are still active |

## Architecture Overview

```text
                  +-------------------+
                  |  commander CLI    |
                  +---------+---------+
                            |
                 +----------v-----------+
                 |   ArenaOrchestrator  |
                 +----+-------------+---+
                      |             |
            +---------v----+   +----v----------------+
            | node-pty PTY |   | Git worktree layer  |
            +--------------+   +---------------------+
                      |
              +-------v--------+
              | event stream   |
              +---+---------+--+
                  |         |
        +---------v--+   +--v----------------+
        | Ink TUI    |   | NDJSON IPC server |
        +------------+   +-------------------+
```

For the deeper design rationale, see [`DESIGN.md`](./DESIGN.md).

## Installation

### npm

```bash
npm install -g agent-arena
```

### Homebrew

The repository includes `Formula/arena.rb`. If you publish a tap:

```bash
brew tap <your-org>/tools
brew install arena
```

### Install scripts

Unix:

```bash
curl -fsSL https://raw.githubusercontent.com/<repo>/main/scripts/install.sh | bash
```

Windows PowerShell:

```powershell
iwr https://raw.githubusercontent.com/<repo>/main/scripts/install.ps1 -useb | iex
```

Both scripts detect OS and architecture, then download the matching release artifact.

### Build from source

```bash
npm install
npm run build
node dist/cli.js --help
```

## Development

```bash
npm install
npm run lint
npm run build
npm run test:coverage
```

The test suite enforces a minimum 80% coverage threshold for the business-logic surface.

## Docker

Build the image:

```bash
docker build -t agent-arena .
```

Run the CLI inside the container:

```bash
docker run --rm -it -v "$PWD:/workspace" -w /workspace agent-arena --help
```

## Contributing

1. Fork the repository.
2. Create a feature branch.
3. Run `npm run validate`.
4. Open a pull request with a focused change set.

## License

MIT
