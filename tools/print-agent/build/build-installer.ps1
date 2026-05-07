$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$agentRoot = Resolve-Path (Join-Path $scriptDir "..")
$distDir = Join-Path $agentRoot "dist"
$exePath = Join-Path $distDir "ironwaves-print-agent.exe"
$issPath = Join-Path $scriptDir "installer.iss"

if (-not (Test-Path $exePath)) {
  throw "Missing EXE: $exePath. Run 'npm run build:exe' first."
}

$iscc = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue
if (-not $iscc) {
  throw "Inno Setup compiler (ISCC.exe) not found. Install Inno Setup 6 and ensure ISCC.exe is on PATH."
}

Write-Host "Building installer with Inno Setup..."
& $iscc.Source $issPath

$setupPath = Join-Path $distDir "ironwaves-print-agent-setup.exe"
if (Test-Path $setupPath) {
  Write-Host "Installer created: $setupPath"
} else {
  throw "Build finished but installer not found at $setupPath"
}
