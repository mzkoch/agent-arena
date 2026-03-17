#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🏟️  Installing Agent Arena..."

# 1. Install Copilot CLI agent profile
COPILOT_AGENTS_DIR="$HOME/.copilot/agents"
mkdir -p "$COPILOT_AGENTS_DIR"
cp "$PROJECT_DIR/agents/arena-orchestrator.agent.md" "$COPILOT_AGENTS_DIR/"
echo "✓ Copilot CLI agent profile installed to $COPILOT_AGENTS_DIR"

# 2. Install Claude Code custom command
CLAUDE_COMMANDS_DIR="$HOME/.claude/commands"
mkdir -p "$CLAUDE_COMMANDS_DIR"
cp "$PROJECT_DIR/agents/arena-orchestrator/orchestrate.md" "$CLAUDE_COMMANDS_DIR/"
echo "✓ Claude Code custom command installed to $CLAUDE_COMMANDS_DIR"

# 3. Build
echo "Building..."
cd "$PROJECT_DIR"
npm install
npm run build
echo "✓ Build complete"

# 4. Link globally
npm link
echo "✓ 'arena' command linked globally"

echo ""
echo "🎉 Agent Arena installed successfully!"
echo ""
echo "Usage:"
echo "  Via Copilot CLI:  copilot --agent arena-orchestrator"
echo "  Via Claude Code:  /orchestrate"
echo "  Via CLI directly: arena --help"
