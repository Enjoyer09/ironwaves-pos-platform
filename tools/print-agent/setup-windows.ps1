# iRonWaves Print Agent - Windows Silent Installer & Startup Setup
# No admin rights required! Run once to set up background silent auto-start.

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Definition
$jsFile = Join-Path $scriptPath "ironwaves-print-agent.js"
$vbsFile = Join-Path $scriptPath "ironwaves-print-agent.vbs"

Write-Host "iRonWaves Print Agent - Windows Setup starting..." -ForegroundColor Cyan

# 1. Check if Node.js is installed globally. If not, download official portable node.exe
$nodeCmd = "node"
$globalNode = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $globalNode) {
    $localNode = Join-Path $scriptPath "node.exe"
    if (-not (Test-Path $localNode)) {
        Write-Host "Global Node.js not detected. Downloading official portable node.exe..." -ForegroundColor Yellow
        # Node.js 20.11.1 LTS portable x64 executable (clean and signed by Node.js Foundation)
        $nodeUrl = "https://nodejs.org/dist/v20.11.1/win-x64/node.exe"
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            # Use WebClient for simpler downloading with a progress status
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

# Define command to run in VBScript
if ($nodeCmd -eq "node") {
    $runCmd = "node `"$($jsFile.Replace('\', '\\'))`""
} else {
    $runCmd = "`"$($nodeCmd.Replace('\', '\\'))`" `"$($jsFile.Replace('\', '\\'))`""
}

# 2. Create the silent VBScript launcher
$vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "$($runCmd.Replace('"', '""'))", 0, false
"@
Set-Content -Path $vbsFile -Value $vbsContent -Encoding Ascii

# 3. Get the Windows Startup folder path
$startupFolder = [System.IO.Path]::Combine([Environment]::GetFolderPath("Startup"))
$shortcutPath = Join-Path $startupFolder "iRonWavesPrintAgent.lnk"

# 4. Create a shortcut to the VBScript inside the Startup folder
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($shortcutPath)
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = """$vbsFile"""
$Shortcut.WorkingDirectory = $scriptPath
$Shortcut.Description = "iRonWaves Print Agent"
$Shortcut.Save()

# 5. Stop any existing running print agents (port cleanup)
Stop-Process -Name "node" -ErrorAction SilentlyContinue

# 6. Launch the VBScript silently in the background immediately
Start-Process "wscript.exe" -ArgumentList "`"$vbsFile`""

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "iRonWaves Print Agent Windows Setup Completed Successfully!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "1. Created silent launcher: $vbsFile"
Write-Host "2. Added to Startup: $shortcutPath"
Write-Host "3. Started silently in the background!"
Write-Host ""
Write-Host "Windows Defender will not block this because it runs through official Node.js."
Write-Host "You can close this window now."
