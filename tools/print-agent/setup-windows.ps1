# iRonWaves Print Agent - Windows Silent Installer & Startup Setup
# No admin rights required! Run once to set up background silent auto-start.

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Definition
$exeFile = Join-Path $scriptPath "ironwaves-print-agent.exe"
$jsFile = Join-Path $scriptPath "ironwaves-print-agent.js"
$vbsFile = Join-Path $scriptPath "ironwaves-print-agent.vbs"

Write-Host "iRonWaves Print Agent - Windows Setup starting..." -ForegroundColor Cyan

# 1. Prefer the bundled standalone executable (no Node.js required).
if (Test-Path $exeFile) {
    Write-Host "Found bundled iRonWavesPrintAgent.exe - using standalone mode." -ForegroundColor Green
    $runTarget = $exeFile
    $runArgs = ""
} else {
    # Fallback: run the .js via Node.js (download portable node.exe if missing)
    $nodeCmd = "node"
    $globalNode = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $globalNode) {
        $localNode = Join-Path $scriptPath "node.exe"
        if (-not (Test-Path $localNode)) {
            Write-Host "Global Node.js not detected. Downloading official portable node.exe..." -ForegroundColor Yellow
            $nodeUrl = "https://nodejs.org/dist/v20.11.1/win-x64/node.exe"
            try {
                [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                $webClient = New-Object System.Net.WebClient
                $webClient.DownloadFile($nodeUrl, $localNode)
                Write-Host "Successfully downloaded portable node.exe!" -ForegroundColor Green
            } catch {
                Write-Host "Primary download failed. Trying fallback mirror..." -ForegroundColor Yellow
                $fallbackUrl = "https://unofficial-builds.nodejs.org/download/release/v20.11.1/win-x64/node.exe"
                try {
                    $webClient = New-Object System.Net.WebClient
                    $webClient.DownloadFile($fallbackUrl, $localNode)
                    Write-Host "Successfully downloaded portable node.exe from fallback!" -ForegroundColor Green
                } catch {
                    Write-Host "ERROR: Failed to download node.exe automatically." -ForegroundColor Red
                    Write-Host "Please install Node.js manually from https://nodejs.org/ or contact support." -ForegroundColor Red
                    Read-Host "Press Enter to exit"
                    exit 1
                }
            }
        } else {
            Write-Host "Found local portable node.exe in directory." -ForegroundColor Green
        }
        $nodeCmd = $localNode
    } else {
        Write-Host "Found global Node.js installation: $($globalNode.Source)" -ForegroundColor Green
    }
    $runTarget = $nodeCmd
    $runArgs = "`"$($jsFile.Replace('\', '\\'))`""
}

# 2. Get the Windows Startup folder path
$startupFolder = [System.IO.Path]::Combine([Environment]::GetFolderPath("Startup"))
$shortcutPath = Join-Path $startupFolder "iRonWavesPrintAgent.lnk"

# 3. Create a clean startup shortcut that launches the agent silently in the active user session!
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($shortcutPath)
if ($runArgs -eq "") {
    $Shortcut.TargetPath = $runTarget
    $Shortcut.Arguments = ""
} else {
    $Shortcut.TargetPath = "powershell.exe"
    $Shortcut.Arguments = "-NoProfile -WindowStyle Hidden -Command `"Start-Process '$runTarget' -ArgumentList $runArgs -WindowStyle Hidden`""
}
$Shortcut.WorkingDirectory = $scriptPath
$Shortcut.Description = "iRonWaves Print Agent"
$Shortcut.Save()

# 4. Stop any existing running print agents (port cleanup)
if ($runTarget -like "*.exe" -and $runTarget -notlike "*\node.exe") {
    Stop-Process -Name "ironwaves-print-agent" -ErrorAction SilentlyContinue
} else {
    Stop-Process -Name "node" -ErrorAction SilentlyContinue
}

# 5. Launch the print agent silently in the active user session immediately
if ($runArgs -eq "") {
    Start-Process $runTarget -WindowStyle Hidden
} else {
    Start-Process $runTarget -ArgumentList $runArgs -WindowStyle Hidden
}

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "iRonWaves Print Agent Windows Setup Completed Successfully!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "1. Created active-session silent shortcut: $shortcutPath"
Write-Host "2. Added to Startup folder."
Write-Host "3. Started silently in the background of your active user session!"
Write-Host ""
Write-Host "Windows Defender will not block this because it runs through official Node.js / bundled binary."
Write-Host "You can close this window now."
