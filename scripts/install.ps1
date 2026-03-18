$ErrorActionPreference = "Stop"

$Repo = if ($env:ARENA_REPO) { $env:ARENA_REPO } else { "mzkoch/agent-arena" }
$Version = if ($env:ARENA_VERSION) { $env:ARENA_VERSION } else { "latest" }
$InstallDir = if ($env:ARENA_INSTALL_DIR) { $env:ARENA_INSTALL_DIR } else { "$HOME\AppData\Local\Programs\arena" }

$arch = switch ($env:PROCESSOR_ARCHITECTURE.ToLowerInvariant()) {
  "amd64" { "amd64" }
  default { throw "Unsupported architecture: $env:PROCESSOR_ARCHITECTURE" }
}

$asset = "arena-windows-$arch.zip"
$baseUrl = "https://github.com/$Repo/releases"
$url = if ($Version -eq "latest") {
  "$baseUrl/latest/download/$asset"
} else {
  "$baseUrl/download/$Version/$asset"
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("arena-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$archive = Join-Path $tmp $asset
Invoke-WebRequest -Uri $url -OutFile $archive
Expand-Archive -Path $archive -DestinationPath $tmp -Force
Copy-Item (Join-Path $tmp "arena.exe") (Join-Path $InstallDir "arena.exe") -Force

Write-Host "Installed arena to $InstallDir\arena.exe"
