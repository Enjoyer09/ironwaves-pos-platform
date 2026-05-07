$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$agentRoot = Resolve-Path (Join-Path $scriptDir "..")
$distDir = Join-Path $agentRoot "dist"
$exePath = Join-Path $distDir "ironwaves-print-agent.exe"
$issPath = Join-Path $scriptDir "installer.iss"

if (-not (Test-Path $exePath)) {
  throw "Missing EXE: $exePath. Run 'npm run build:exe' first."
}

# Try PATH first, then search common Inno Setup install locations
$iscc = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue

if (-not $iscc) {
  $candidates = @(
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe",
    "C:\Program Files (x86)\Inno Setup 5\ISCC.exe",
    "C:\Program Files\Inno Setup 5\ISCC.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      $iscc = $candidate
      Write-Host "Found Inno Setup at: $candidate"
      break
    }
  }
}

if (-not $iscc) {
  throw "Inno Setup compiler (ISCC.exe) not found. Install Inno Setup 6 from https://jrsoftware.org/isdl.php"
}

Write-Host "Building installer with Inno Setup..."
$isccExe = if ($iscc -is [string]) { $iscc } else { $iscc.Source }
& $isccExe $issPath

$setupPath = Join-Path $distDir "ironwaves-print-agent-setup.exe"
if (Test-Path $setupPath) {
  Write-Host "Installer created: $setupPath"
} else {
  throw "Build finished but installer not found at $setupPath"
}
