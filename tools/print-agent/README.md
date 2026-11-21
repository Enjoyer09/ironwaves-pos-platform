# iRonWaves Print Agent 0.6.1

Windows x64 local print helper; separate RAW queues and persistent job IDs.
The existing macOS source path remains supported; this release packages Windows only.

## Build and verify

```sh
npm ci --prefix tools/print-agent --ignore-scripts
npm run test:print
npm run typecheck
npm run build
npm --prefix tools/print-agent run build:all
```

Packaging uses pinned `@yao-pkg/pkg` with a Node 22 runtime, and NSIS 3.
On Windows the default NSIS location is `C:\Program Files (x86)\NSIS\makensis.exe`;
set MAKENSIS to override. The Windows workflow builds and runs the executable,
compiles the native helper, tests silent install, refuses an upgrade while the
agent runs, then tests an idle upgrade. Job history and Windows printer settings
are compared; the workflow never prints a physical ticket.

Artifacts are in `tools/print-agent/dist`: standalone executable, installer,
ZIP, `checksums.json`, and the Windows CI `windows-smoke.json` evidence.
The ZIP contains the same installer plus setup.bat, setup-windows.ps1 and README.
`npm --prefix tools/print-agent run build:publish` verifies version, source hash
(Windows CRLF or LF), and artifact SHA256 before copying tested downloads to public.
`node tools/print-agent/packaging/verify-downloads.mjs <base-url>` checks the
served installer/ZIP bytes and hashes, HEAD behavior, and live manifest.

## Install / upgrade

Finish outstanding print jobs, quit the previous agent from its tray menu, and
run the installer. It runs as the current user, requires no separate Node
installation, and starts silently through launch-silent.vbs. It never clears
spooler jobs or edits printer/tenant settings. It refuses to replace a running
agent. Its uninstall action retains job history and printer configuration.

## Protocol

GET /health advertises capabilities.print_jobs. POST /print-raw and /print-html
accept optional job_id; new clients use one ID per logical job. HTTP 202 means
accepted, not paper output confirmed. GET /jobs/{id} exposes queued, processing,
submitted or unknown. Same ID/different payload gives HTTP 409. Interrupted or
uncertain spool attempts never auto-replay. Explicit manual reprints use new IDs.

Only hashes/status metadata is persisted under ~/.ironwaves-print/jobs-v1.
Terminal receipts expire after seven days; the journal has a 10000-record cap
and fails closed on write/corruption/capacity errors. Distinct agents on distinct
computers are not coordinated by this local protocol. See README.txt for details.

Runtime flags IW_PRINT_AGENT_AUTOSTART=0 and IW_PRINT_AGENT_TRAY=0 suppress only
autostart registration/tray startup for isolated package smoke tests. Normal
installs retain both. They do not enable simulated printing or alter printer settings.
