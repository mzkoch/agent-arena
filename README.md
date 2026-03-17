# Agent Arena 🏟️

Spawn multiple AI agents in parallel — each in its own git worktree, each using a different model and tech stack — to build competing implementations of the same project requirements.

**Agent-agnostic**: Works with any CLI agent. Ships with built-in support for [GitHub Copilot CLI](https://github.com/github/copilot-cli) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

## Quick Start

```bash
# Install
cd agent-arena
./scripts/install.sh   # macOS/Linux
# or
.\scripts\install.ps1  # Windows

# Create config
cat > arena.json << 'EOF'
{
  "repoName": "my-api-arena",
  "variants": [
    {
      "name": "node-copilot",
      "provider": "copilot-cli",
      "model": "claude-sonnet-4.5",
      "techStack": "Node.js with Express, TypeScript",
      "designPhilosophy": "Simplicity and DX"
    },
    {
      "name": "python-claude",
      "provider": "claude-code",
      "model": "sonnet",
      "techStack": "Python with FastAPI",
      "designPhilosophy": "Performance and type safety"
    }
  ]
}
EOF

# Write your requirements
cat > requirements.md << 'EOF'
# Build a REST API for task management
- CRUD for tasks, projects, and tags
- PostgreSQL database with migrations
- Docker support
- Tests with 80% coverage
EOF

# Run the arena
arena launch arena.json requirements.md
```

## Prerequisites

- Node.js 18+
- Git 2.20+
- At least one supported agent CLI installed and authenticated

## How It Works

1. **arena init** creates a git repo with a worktree per variant (each on its own branch)
2. **arena launch** spawns each agent in its worktree via PTY with a short prompt pointing to `REQUIREMENTS.md` and `ARENA-INSTRUCTIONS.md` (generated per variant)
3. Agents work autonomously. The arena monitors them via idle detection + completion protocol
4. **arena evaluate** scans worktrees and generates a comparison report

### Architecture

```
arena launch ──→ Orchestrator
                    ├─ Agent 1 (PTY) → copilot --autopilot --yolo -i "Read REQUIREMENTS.md..."
                    ├─ Agent 2 (PTY) → claude --dangerously-skip-permissions "Read REQUIREMENTS.md..."
                    └─ Agent N (PTY) → <any-agent> "Read REQUIREMENTS.md..."
                    │
                    └─ IPC Server (--headless mode)
                         ↕ TCP/NDJSON
arena monitor ──→ TUI Client
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `arena init <config> <requirements>` | Create git repo + worktrees |
| `arena launch <config> <requirements> [--headless]` | Launch agents (with TUI or headless) |
| `arena monitor <config> <requirements>` | Connect to headless arena's TUI |
| `arena status <config> <requirements>` | Print JSON status |
| `arena evaluate <config> <requirements>` | Generate comparison report |
| `arena clean <repo-path>` | Remove all worktrees |

## Configuration

### arena.json

```json
{
  "repoName": "my-arena",
  "maxContinues": 50,
  "agentTimeoutMs": 3600000,
  "worktreeDir": "/optional/custom/path",
  "providers": {},
  "variants": []
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `repoName` | Yes | — | Git repository name |
| `maxContinues` | No | `50` | Max autopilot steps per agent |
| `agentTimeoutMs` | No | — | Absolute timeout per agent (ms) |
| `worktreeDir` | No | `../<repoName>-worktrees/` | Custom worktree directory |
| `providers` | No | `{}` | Custom/override provider definitions |
| `variants` | Yes | — | Array of variant configs (min 1) |

### Variant Config

```json
{
  "name": "node-express",
  "provider": "copilot-cli",
  "model": "claude-sonnet-4.5",
  "techStack": "Node.js with Express, TypeScript",
  "designPhilosophy": "Focus on simplicity",
  "branch": "variant/node-express"
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | Yes | — | Lowercase alphanumeric with hyphens |
| `provider` | No | `copilot-cli` | Agent provider to use |
| `model` | Yes | — | Model name (provider-specific) |
| `techStack` | Yes | — | Technology description |
| `designPhilosophy` | Yes | — | Design approach guidance |
| `branch` | No | `variant/<name>` | Git branch name |

## Agent Providers

### Built-in Providers

**copilot-cli** — GitHub Copilot CLI
- Command: `copilot --autopilot --yolo -i "prompt" --model <model>`
- Requires: [Copilot CLI](https://github.com/github/copilot-cli) installed + authenticated

**claude-code** — Anthropic Claude Code
- Command: `claude --dangerously-skip-permissions "prompt" --model <model>`
- Requires: [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed + authenticated

### Custom Providers

Add any agent CLI by defining a provider in `arena.json`:

```json
{
  "providers": {
    "my-agent": {
      "command": "my-agent-cli",
      "baseArgs": ["--autonomous", "--no-confirm"],
      "modelFlag": "--model",
      "promptDelivery": "positional",
      "exitCommand": "/exit",
      "completionProtocol": {
        "idleTimeoutMs": 30000,
        "maxChecks": 3,
        "responseTimeoutMs": 60000,
        "doneMarker": "ARENA_DONE",
        "continueMarker": "ARENA_CONTINUING"
      }
    }
  },
  "variants": [
    {
      "name": "my-variant",
      "provider": "my-agent",
      "model": "best-model",
      "techStack": "...",
      "designPhilosophy": "..."
    }
  ]
}
```

### Provider Config Reference

| Field | Required | Description |
|-------|----------|-------------|
| `command` | Yes | CLI executable name |
| `baseArgs` | No | Always-included arguments |
| `modelFlag` | Yes | Flag for model selection (e.g., `--model`) |
| `promptDelivery` | Yes | How prompt is delivered: `flag`, `positional`, or `stdin` |
| `promptFlag` | No* | Flag for prompt (required if `promptDelivery: "flag"`) |
| `maxContinuesFlag` | No | Flag for max continuation steps |
| `exitCommand` | Yes | Command to exit the agent session |
| `completionProtocol` | No | Idle detection and completion settings |
| `trustedFolders` | No | Config file + key for folder trust setup |

## Monitor TUI

| Key | Action |
|-----|--------|
| `Tab` | Switch to next agent |
| `1-9` | Jump to agent N |
| `d` | Toggle dashboard ↔ detail view |
| `↑` `↓` | Navigate dashboard |
| `Enter` | Open selected agent |
| `i` | Enter interactive mode |
| `Esc` | Exit interactive mode |
| `k` | Kill selected agent |
| `r` | Restart selected agent |
| `q` | Quit |

## Orchestrator Agents

Use the bundled orchestrator profiles for a conversational workflow:

```bash
# Via Copilot CLI
copilot --agent arena-orchestrator

# Via Claude Code
/orchestrate
```

The orchestrator guides you through setup, launch, monitoring, and evaluation.

## Development

```bash
npm install
npm run build
npm test
npm run dev    # watch mode
```

## License

MIT
