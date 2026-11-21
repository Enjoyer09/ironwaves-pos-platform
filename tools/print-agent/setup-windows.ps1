# Run the same safe installer as the direct download; never clear spool queues.
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot 'ironwaves-print-agent-setup.exe'
if (!(Test-Path $installer)) { throw 'Installer missing. Download and extract the complete Windows ZIP again.' }
$process = Start-Process -FilePath $installer -Wait -PassThru
exit $process.ExitCode
