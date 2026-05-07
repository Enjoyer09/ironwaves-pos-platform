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

This is the first lightweight agent. The next stronger version should be packaged as a Windows `.exe` and installed at startup. Later we can add true ESC/POS raw output for supported thermal printers.
