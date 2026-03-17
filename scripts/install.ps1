$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir

Write-Host "🏟️  Installing Agent Arena..." -ForegroundColor Cyan

# 1. Install Copilot CLI agent profile
$CopilotAgentsDir = Join-Path $env:USERPROFILE ".copilot\agents"
if (-not (Test-Path $CopilotAgentsDir)) {
    New-Item -ItemType Directory -Path $CopilotAgentsDir -Force | Out-Null
}
Copy-Item (Join-Path $ProjectDir "agents\arena-orchestrator.agent.md") -Destination $CopilotAgentsDir -Force
Write-Host "✓ Copilot CLI agent profile installed to $CopilotAgentsDir" -ForegroundColor Green

# 2. Install Claude Code custom command
$ClaudeCommandsDir = Join-Path $env:USERPROFILE ".claude\commands"
if (-not (Test-Path $ClaudeCommandsDir)) {
    New-Item -ItemType Directory -Path $ClaudeCommandsDir -Force | Out-Null
}
Copy-Item (Join-Path $ProjectDir "agents\arena-orchestrator\orchestrate.md") -Destination $ClaudeCommandsDir -Force
Write-Host "✓ Claude Code custom command installed to $ClaudeCommandsDir" -ForegroundColor Green

# 3. Build
Write-Host "Building..."
Set-Location $ProjectDir
npm install
npm run build
Write-Host "✓ Build complete" -ForegroundColor Green

# 4. Link globally
npm link
Write-Host "✓ 'arena' command linked globally" -ForegroundColor Green

Write-Host ""
Write-Host "🎉 Agent Arena installed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Usage:"
Write-Host "  Via Copilot CLI:  copilot --agent arena-orchestrator"
Write-Host "  Via Claude Code:  /orchestrate"
Write-Host "  Via CLI directly: arena --help"
