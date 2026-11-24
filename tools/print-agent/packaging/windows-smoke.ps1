$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$installDir = Join-Path $env:RUNNER_TEMP 'iRonWaves Agent Smoke (upgrade)'
$installer = Join-Path $dist 'ironwaves-print-agent-setup.exe'
$expected = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
function PrinterSnapshot {
  return (ConvertTo-Json -InputObject @(Get-CimInstance Win32_Printer | Sort-Object Name | Select-Object Name,Default,PortName,DriverName) -Compress)
}
$printersBefore = PrinterSnapshot
$history = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.ironwaves-print\jobs-v1'
New-Item -ItemType Directory -Force $history | Out-Null
$sentinel = Join-Path $history 'smoke_history_123456789.json'
@{job_id='smoke_history_123456789';status='submitted';fingerprint='synthetic-only';created_at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()} | ConvertTo-Json -Compress | Set-Content -Path $sentinel -Encoding utf8NoBOM
$historyHash = (Get-FileHash $sentinel -Algorithm SHA256).Hash
function InstallAgent {
  $p = Start-Process -FilePath $installer -ArgumentList "/S /D=$installDir" -Wait -PassThru
  return $p.ExitCode
}
$startup = [Environment]::GetFolderPath('Startup')
$legacyShortcut = Join-Path $startup 'iRonWavesPrintAgent.lnk'
$unrelatedShortcut = Join-Path $startup 'UnrelatedAgentSmoke.lnk'
$wsh = New-Object -ComObject WScript.Shell
foreach ($file in @($legacyShortcut,$unrelatedShortcut)) { $link=$wsh.CreateShortcut($file); $link.TargetPath="$env:WINDIR\System32\notepad.exe"; $link.Save() }
$unrelatedHash=(Get-FileHash $unrelatedShortcut).Hash
if ((InstallAgent) -ne 0) { throw 'Silent install failed' }
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$startupValue = (Get-ItemProperty -Path $runKey -Name iRonWavesPrintAgent -ErrorAction Stop).iRonWavesPrintAgent
if ($startupValue -ne ('"' + (Join-Path $env:WINDIR 'System32\wscript.exe') + '" "' + (Join-Path $installDir 'launch-silent.vbs') + '"')) { throw 'Windows login autostart was not registered' }
if (Test-Path $legacyShortcut) { throw 'Legacy duplicate autostart shortcut remained' }
if ((Get-FileHash $unrelatedShortcut).Hash -ne $unrelatedHash) { throw 'Unrelated startup shortcut changed' }
$binary = Join-Path $installDir 'ironwaves-print-agent.exe'
if (!(Test-Path $binary)) { throw 'Installed binary missing' }
if ((Get-FileHash $binary).Hash -ne (Get-FileHash (Join-Path $dist 'ironwaves-print-agent.exe')).Hash) { throw 'Installed executable mismatch' }
$env:IW_PRINT_AGENT_AUTOSTART='0'
$env:IW_PRINT_AGENT_TRAY='0'
$env:IW_PRINT_AGENT_PORT='17777'
$process = Start-Process -FilePath $binary -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $dist 'smoke.stdout.log') -RedirectStandardError (Join-Path $dist 'smoke.stderr.log')
try {
  $health = $null
  for ($n=0; $n -lt 40; $n++) {
    try { $health=Invoke-RestMethod 'http://127.0.0.1:17777/health' -TimeoutSec 2; break } catch { Start-Sleep -Milliseconds 250 }
  }
  if (!$health -or $health.version -ne $expected -or !$health.capabilities.print_jobs) { throw 'Packaged agent health/version/capability failed' }
  $job = Invoke-RestMethod 'http://127.0.0.1:17777/jobs/smoke_history_123456789' -TimeoutSec 5
  if ($job.job.status -ne 'submitted') { throw 'Persisted job history failed' }
  # Real C# compilation, no OpenPrinter or WritePrinter call.
  $helper=Join-Path ([IO.Path]::GetTempPath()) 'ironwaves-rawprint-v060.exe'
  for ($n=0; $n -lt 80 -and !(Test-Path $helper); $n++) { Start-Sleep -Milliseconds 250 }
  if (!(Test-Path $helper)) { throw 'Native helper did not compile on Windows' }
  # A busy job still blocks upgrades, while an idle agent is stopped by setup.
  @{job_id='smoke_history_123456789';status='processing';fingerprint='synthetic-only';created_at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()} | ConvertTo-Json -Compress | Set-Content -Path $sentinel -Encoding utf8NoBOM
  if ((InstallAgent) -ne 42) { throw 'Busy agent upgrade was not refused' }
  $null=Invoke-RestMethod 'http://127.0.0.1:17777/health' -TimeoutSec 3
  @{job_id='smoke_history_123456789';status='submitted';fingerprint='synthetic-only';created_at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()} | ConvertTo-Json -Compress | Set-Content -Path $sentinel -Encoding utf8NoBOM
  $historyHash = (Get-FileHash $sentinel -Algorithm SHA256).Hash
  if ((InstallAgent) -ne 0) { throw 'Idle running agent upgrade failed' }
  if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) { throw 'Old agent was not stopped by installer' }
} finally {
  Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 500
if ((InstallAgent) -ne 0) { throw 'Safe idle upgrade failed' }
if ((Get-ItemProperty -Path $runKey -Name iRonWavesPrintAgent -ErrorAction Stop).iRonWavesPrintAgent -ne $startupValue) { throw 'Autostart changed during upgrade' }
Remove-Item Env:IW_PRINT_AGENT_AUTOSTART -ErrorAction SilentlyContinue
Remove-Item Env:IW_PRINT_AGENT_TRAY -ErrorAction SilentlyContinue
Start-Process -FilePath (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList ('"' + (Join-Path $installDir 'launch-silent.vbs') + '"') -Wait
$loginHealth = $null
for ($n=0; $n -lt 40; $n++) {
  try { $loginHealth=Invoke-RestMethod 'http://127.0.0.1:17777/health' -TimeoutSec 2; break } catch { Start-Sleep -Milliseconds 250 }
}
if (!$loginHealth -or $loginHealth.version -ne $expected) { throw 'Windows login launcher did not start the agent' }
if ((Get-ItemProperty -Path $runKey -Name iRonWavesPrintAgent -ErrorAction Stop).iRonWavesPrintAgent -ne $startupValue) { throw 'Runtime changed the login command' }
$loginPid = @(Get-NetTCPConnection -LocalPort 17777 -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique)
if ($loginPid.Count -ne 1) { throw 'Login launcher started multiple listeners' }
Stop-Process -Id $loginPid[0] -ErrorAction Stop
if ((Get-FileHash $sentinel).Hash -ne $historyHash) { throw 'Upgrade modified existing job history' }
if ((PrinterSnapshot) -ne $printersBefore) { throw 'Printer configuration changed' }
$metadata = Get-Content (Join-Path $dist 'checksums.json') -Raw | ConvertFrom-Json
foreach ($name in @('ironwaves-print-agent.exe','ironwaves-print-agent-setup.exe','ironwaves-print-agent-windows.zip')) {
  $hash=(Get-FileHash (Join-Path $dist $name) -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($metadata.artifacts.$name.sha256 -ne $hash) { throw "Artifact hash mismatch: $name" }
}
@{version=$expected;platform='windows';packaged_binary=$true;native_helper_compile=$true;installer=$true;busy_upgrade_refused=$true;idle_running_upgrade=$true;idle_upgrade=$true;windows_autostart=$true;job_history_preserved=$true;printer_configuration_preserved=$true;legacy_autostart_migrated=$true;unrelated_startup_preserved=$true;physical_prints=0} | ConvertTo-Json | Set-Content (Join-Path $dist 'windows-smoke.json') -Encoding utf8NoBOM
Write-Host 'Packaged Windows agent and safe installer smoke passed; no physical printing.'
