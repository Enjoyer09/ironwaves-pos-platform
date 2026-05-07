# iRonWaves Print Agent

Local Windows print helper for iRonWaves POS. It runs on `127.0.0.1:17777` and lets the web POS send receipt HTML to the cashier computer without using QZ Tray.

## MVP behaviour

- Accepts `POST /print-html` with `{ "html": "...", "printer_name": "optional printer name" }`.
- Uses installed Chrome or Microsoft Edge with `--kiosk-printing`.
- Prints to the Windows default printer, or temporarily switches the default printer when `printer_name` is provided.
- Binds only to `127.0.0.1`.

## Run manually on Windows

```powershell
cd C:\path\to\ironwaves-pos-platform\tools\print-agent
node .\ironwaves-print-agent.js
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:17777/health
Invoke-RestMethod http://127.0.0.1:17777/printers
```

## Production note

This agent can now be packaged as a Windows `.exe` and installer.

## Build Windows `.exe` and installer

Run these on a Windows machine:

```powershell
cd C:\path\to\ironwaves-pos-platform\tools\print-agent
npm install
npm run build:exe
```

Output:

```text
tools\print-agent\dist\ironwaves-print-agent.exe
```

For installer (`.exe setup`):

1. Install [Inno Setup 6](https://jrsoftware.org/isinfo.php)
2. Ensure `ISCC.exe` is available in `PATH`
3. Run:

```powershell
npm run build:installer
```

Or build both in one command:

```powershell
npm run build:all
```

Final installer output:

```text
tools\print-agent\dist\ironwaves-print-agent-setup.exe
```

## Deploy for POS Settings download button

Copy installer to:

```text
public/downloads/ironwaves-print-agent-setup.exe
```

Then in admin settings the "Printer Agentini yüklə" button downloads it from:

```text
/downloads/ironwaves-print-agent-setup.exe
```

Also update:

```text
public/downloads/print-agent-latest.json
```

Set:
- `latest_version` to new version
- `minimum_version` to minimum supported version
- `published_at` to release timestamp

## macOS `.pkg` installer (very simple flow)

On your Mac:

```bash
cd /Users/macbookair/Documents/GitHub/ironwaves-pos-platform/tools/print-agent
npm install
npm run build:mac:all
```

Output:

```text
tools/print-agent/dist/ironwaves-print-agent-macos-installer.pkg
```

Install test:

1. Double click `.pkg`
2. Finish installer
3. Check agent:

```bash
curl -s http://127.0.0.1:17777/health
```

Auto-start at login:
- Installer adds LaunchAgent: `/Library/LaunchAgents/com.ironwaves.print-agent.plist`
- Agent starts automatically after user login.
