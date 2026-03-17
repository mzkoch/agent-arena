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

Create an `arena.json`:

```json
{
  "variants": [
    {
      "name": "copilot-node",
      "provider": "copilot-cli",
      "model": "claude-sonnet-4.5",
      "techStack": "Node.js, TypeScript, Express",
      "designPhilosophy": "Favor clarity and fast iteration"
    },
    {
      "name": "claude-fastify",
      "provider": "claude-code",
      "model": "sonnet",
      "techStack": "Node.js, TypeScript, Fastify",
      "designPhilosophy": "Optimize for strong boundaries and testability"
    }
  ]
}
```

Create your requirements file:

```bash
cat > REQUIREMENTS.md <<'EOF'
# Build a TODO API

- CRUD for tasks
- Tests
- Docker support
EOF
```

Initialize worktrees (from inside your git repository):

```bash
arena init --config arena.json --requirements REQUIREMENTS.md
```

Launch with the TUI:

```bash
arena launch
```

Launch headless, then monitor from another terminal:

```bash
arena launch --headless
arena monitor
```

Check structured status:

```bash
arena status
```

Generate a comparison report:

```bash
arena evaluate
```

Clean worktrees and branches:

```bash
arena clean
```

## Project Layout

After `arena init`, your project looks like:

```
my-project/
├── .arena/
│   ├── arena.json
│   ├── requirements.md
│   ├── session.json          # created during launch
│   ├── comparison-report.md  # created by evaluate
│   ├── logs/
│   └── worktrees/
│       ├── copilot-node/     # branch: arena/copilot-node
│       └── claude-fastify/   # branch: arena/claude-fastify
├── src/
├── package.json
└── .gitignore                # .arena/ added automatically
```

Each variant worktree is a branch on your own repo (`arena/<name>`), so you can:

- `git diff main..arena/copilot-node` to compare
- `git merge arena/copilot-node` to adopt the winner
- Open a GitHub PR from `arena/copilot-node` to `main`

## CLI Reference

| Command | Description |
| --- | --- |
| `arena init --config <path> --requirements <path>` | Create `.arena/` with config, worktrees, and gitignore entry |
| `arena launch [--headless]` | Launch all agents with the TUI or in headless mode |
| `arena monitor` | Attach the TUI to a running headless session |
| `arena status` | Print JSON state for the arena |
| `arena evaluate` | Scan worktrees and write `.arena/comparison-report.md` |
| `arena clean [--keep-config]` | Remove worktrees, branches, and `.arena/` state |
| `arena version` | Print the installed version |

All commands except `init` work with zero arguments when `.arena/arena.json` exists. You can override with `--config` and `--requirements` flags.

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
      }
    }
  }
}
```

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
