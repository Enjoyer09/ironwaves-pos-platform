# Runs before extracting files. Never touches the spooler or another program.
$ErrorActionPreference = 'Stop'
try {
  $listeners = @(Get-NetTCPConnection -LocalPort 17777 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
  if ($listeners.Count -eq 0) { exit 0 }
  if ($listeners.Count -ne 1) { throw 'Multiple listeners on agent port' }
  $agentPid = [int]$listeners[0]
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$agentPid"
  if (!$processInfo -or [IO.Path]::GetFileName($processInfo.ExecutablePath) -ine 'ironwaves-print-agent.exe') {
    throw 'Port 17777 belongs to another program'
  }
  $health = Invoke-RestMethod 'http://127.0.0.1:17777/health' -TimeoutSec 3
  if ($health.name -ne 'ironwaves-print-agent') { throw 'Port 17777 did not identify as Print Agent' }

  # Older agents have no drain protocol. Wait for both Windows spooler and the
  # agent's durable job journal to be idle for several consecutive checks.
  $journal = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.ironwaves-print\jobs-v1'
  $quiet = 0
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $currentHealth = Invoke-RestMethod 'http://127.0.0.1:17777/health' -TimeoutSec 3
    $agentBusy = $currentHealth.PSObject.Properties.Name -contains 'active_prints' -and [int]$currentHealth.active_prints -gt 0
    $spoolBusy = @(Get-CimInstance Win32_PrintJob -ErrorAction Stop).Count -gt 0
    $journalBusy = $false
    if (Test-Path $journal) {
      foreach ($file in (Get-ChildItem $journal -Filter '*.json' -File)) {
        $row = Get-Content $file.FullName -Raw | ConvertFrom-Json
        if ($row.status -in @('queued', 'processing') -and
            ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [long]$row.created_at) -lt 120000) {
          $journalBusy = $true
          break
        }
      }
    }
    if (!$agentBusy -and !$spoolBusy -and !$journalBusy) { $quiet++ } else { $quiet = 0 }
    if ($quiet -ge 4) { break }
    Start-Sleep -Seconds 1
  }
  if ($quiet -lt 4) { throw 'Print jobs are still active after 60 seconds' }
  $current = @(Get-NetTCPConnection -LocalPort 17777 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
  if ($current.Count -ne 1 -or [int]$current[0] -ne $agentPid) {
    throw 'Agent process changed while waiting; retry setup'
  }
  if (@(Get-CimInstance Win32_PrintJob -ErrorAction Stop).Count -gt 0) {
    throw 'A new print job started; retry setup after it finishes'
  }
  $currentHealth = Invoke-RestMethod 'http://127.0.0.1:17777/health' -TimeoutSec 3
  if ($currentHealth.PSObject.Properties.Name -contains 'active_prints' -and [int]$currentHealth.active_prints -gt 0) {
    throw 'A new agent print job started; retry setup after it finishes'
  }
  Stop-Process -Id $agentPid -Force -ErrorAction Stop
  for ($attempt = 0; $attempt -lt 20 -and (Get-Process -Id $agentPid -ErrorAction SilentlyContinue); $attempt++) {
    Start-Sleep -Milliseconds 250
  }
  if (Get-Process -Id $agentPid -ErrorAction SilentlyContinue) { throw 'Existing agent did not exit' }
  exit 0
} catch {
  Write-Output $_.Exception.Message
  exit 42
}
