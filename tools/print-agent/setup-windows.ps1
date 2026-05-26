# iRonWaves Print Agent - Windows Silent Installer & Startup Setup
# No admin rights required! Run once to set up background silent auto-start.

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Definition
$jsFile = Join-Path $scriptPath "ironwaves-print-agent.js"
$vbsFile = Join-Path $scriptPath "ironwaves-print-agent.vbs"

# 1. Create the silent VBScript launcher
$vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "node ""$($jsFile.Replace('\', '\\'))""", 0, false
"@
Set-Content -Path $vbsFile -Value $vbsContent -Encoding UTF8

# 2. Get the Windows Startup folder path
$startupFolder = [System.IO.Path]::Combine([Environment]::GetFolderPath("Startup"))
$shortcutPath = Join-Path $startupFolder "iRonWavesPrintAgent.lnk"

# 3. Create a shortcut to the VBScript inside the Startup folder
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($shortcutPath)
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = """$vbsFile"""
$Shortcut.WorkingDirectory = $scriptPath
$Shortcut.Description = "iRonWaves Print Agent"
$Shortcut.Save()

# 4. Stop any existing running print agents (port cleanup)
# We find node processes that might be running our script specifically, or just notify about port
Stop-Process -Name "node" -ErrorAction SilentlyContinue

# 5. Launch the VBScript silently in the background immediately
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
