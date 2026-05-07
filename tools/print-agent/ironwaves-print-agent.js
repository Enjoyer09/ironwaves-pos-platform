#!/usr/bin/env node
'use strict';

/**
 * iRonWaves Print Agent
 *
 * - Runs silently in the background (no console window when built as .exe)
 * - Shows a tray icon so the user can quit
 * - Starts automatically at Windows login (via Registry set by the Inno Setup installer)
 * - Listens on 127.0.0.1:17777
 * - POST /print-html  → prints HTML via Chrome --kiosk-printing (no dialog)
 * - GET  /health      → returns { ok: true, version }
 * - GET  /version     → returns { version }
 * - GET  /printers    → returns list of installed printers
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const VERSION = '0.2.0';
const HOST = process.env.IW_PRINT_AGENT_HOST || '127.0.0.1';
const PORT = Number(process.env.IW_PRINT_AGENT_PORT || 17777);

// Allow requests from ironwaves.store subdomains and localhost during dev
const ALLOWED_ORIGIN_RE =
  /^(https:\/\/([a-z0-9-]+\.)?ironwaves\.store|http:\/\/localhost:\d+|http:\/\/127\.0\.0\.1:\d+)$/i;

// ─── Utilities ────────────────────────────────────────────────────────────────
function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function setCors(req, res) {
  const origin = String(req.headers.origin || '');
  if (ALLOWED_ORIGIN_RE.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 15000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || error.message || error)));
          return;
        }
        resolve(String(stdout || '').trim());
      },
    );
  });
}

function runCommand(command, args = [], timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { windowsHide: true, timeout },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || error.message || error)));
          return;
        }
        resolve(String(stdout || '').trim());
      },
    );
  });
}

// ─── Printer helpers ──────────────────────────────────────────────────────────
async function listPrinters() {
  if (process.platform === 'win32') {
    const output = await runPowerShell(
      'Get-CimInstance Win32_Printer | Select-Object Name,Default | ConvertTo-Json -Compress',
    );
    if (!output) return [];
    const parsed = JSON.parse(output);
    return (Array.isArray(parsed) ? parsed : [parsed])
      .filter((row) => row && row.Name)
      .map((row) => ({ name: String(row.Name), default: Boolean(row.Default) }));
  }
  if (process.platform === 'darwin') {
    const printersRaw = await runCommand('/bin/sh', ['-lc', "lpstat -p 2>/dev/null | awk '{print $2}'"]).catch(() => '');
    const defaultRaw = await runCommand('/bin/sh', ['-lc', "lpstat -d 2>/dev/null | sed 's/^system default destination: //'"]).catch(() => '');
    const defaultName = String(defaultRaw || '').trim();
    const names = String(printersRaw || '').split('\n').map((v) => v.trim()).filter(Boolean);
    return names.map((name) => ({ name, default: name === defaultName }));
  }
  return [];
}

function findBrowserExecutable() {
  const envPath = String(process.env.IW_PRINT_BROWSER || '').trim();
  const candidates =
    process.platform === 'win32'
      ? [
          envPath,
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        ]
      : process.platform === 'darwin'
        ? [
            envPath,
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
          ]
        : [];
  return candidates.find((c) => c && fs.existsSync(c)) || '';
}

async function getDefaultPrinterName() {
  const printers = await listPrinters();
  return printers.find((p) => p.default)?.name || '';
}

async function setDefaultPrinter(name) {
  const safeName = String(name || '').replace(/'/g, "''");
  if (!safeName) return;
  await runPowerShell(`(New-Object -ComObject WScript.Network).SetDefaultPrinter('${safeName}')`);
}

// ─── Core print logic ─────────────────────────────────────────────────────────
async function printHtml(payload) {
  if (!['win32', 'darwin'].includes(process.platform)) {
    throw new Error('Print Agent currently supports Windows and macOS');
  }

  const html = String(payload.html || '').trim();
  if (!html) throw new Error('html is required');

  const browser = findBrowserExecutable();
  if (!browser) throw new Error('Chrome or Microsoft Edge was not found');

  const printerName = String(payload.printer_name || payload.printerName || '').trim();

  // Temporarily set default printer if a specific one was requested
  const previousDefault =
    printerName && process.platform === 'win32' ? await getDefaultPrinterName().catch(() => '') : '';
  if (printerName && process.platform === 'win32') {
    await setDefaultPrinter(printerName).catch(() => {});
  }

  // Write HTML to a temp file
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ironwaves-receipt-'));
  const file = path.join(dir, 'receipt.html');
  fs.writeFileSync(file, html, 'utf8');

  const chromePid = await spawnBrowserForPrint(browser, file);

  // Restore previous default printer after Chrome has time to spool the job
  const RESTORE_DELAY_MS = 9000;
  setTimeout(() => {
    if (process.platform === 'win32' && previousDefault && printerName && previousDefault !== printerName) {
      setDefaultPrinter(previousDefault).catch(() => {});
    }
  }, RESTORE_DELAY_MS);

  // Kill the Chrome instance we spawned after it has had time to send the print job.
  // Without this, every print leaves a headless Chrome process running.
  const KILL_DELAY_MS = 12000;
  setTimeout(() => {
    if (chromePid) {
      try {
        if (process.platform === 'win32') {
          execFile('taskkill', ['/PID', String(chromePid), '/F', '/T'], { windowsHide: true }, () => {});
        } else {
          process.kill(chromePid, 'SIGTERM');
        }
      } catch (_) {}
    }
    // Clean up temp file
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }, KILL_DELAY_MS);

  return {
    queued: true,
    browser: path.basename(browser),
    printer_name: printerName || 'default',
  };
}

function spawnBrowserForPrint(browser, htmlFile) {
  return new Promise((resolve) => {
    const args = [
      '--kiosk-printing',
      '--disable-background-networking',
      '--disable-extensions',
      '--disable-sync',
      '--no-first-run',
      '--disable-default-apps',
      '--no-default-browser-check',
      `file:///${htmlFile.replace(/\\/g, '/')}`,
    ];

    const child = spawn(browser, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    child.unref();
    resolve(child.pid || null);
  });
}

// ─── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, name: 'ironwaves-print-agent', version: VERSION, platform: process.platform });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/version') {
      sendJson(res, 200, { ok: true, version: VERSION, name: 'ironwaves-print-agent' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/printers') {
      sendJson(res, 200, { ok: true, printers: await listPrinters() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/print-html') {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const result = await printHtml(payload);
      sendJson(res, 200, { ok: true, result });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) });
  }
});

server.listen(PORT, HOST, () => {
  // Console output is hidden when running as a windowless .exe
  console.log(`iRonWaves Print Agent ${VERSION} listening on http://${HOST}:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Another instance is already running – silently exit
    process.exit(0);
  }
  console.error('[server error]', err);
});
