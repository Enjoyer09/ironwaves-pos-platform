#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const VERSION = '0.1.0';
const HOST = process.env.IW_PRINT_AGENT_HOST || '127.0.0.1';
const PORT = Number(process.env.IW_PRINT_AGENT_PORT || 17777);
const ALLOWED_ORIGIN_RE = /^(https:\/\/([a-z0-9-]+\.)?ironwaves\.store|http:\/\/localhost:\d+|http:\/\/127\.0\.0\.1:\d+)$/i;

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

async function listPrinters() {
  if (process.platform !== 'win32') {
    return [];
  }
  const output = await runPowerShell(
    'Get-CimInstance Win32_Printer | Select-Object Name,Default | ConvertTo-Json -Compress',
  );
  if (!output) return [];
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed])
    .filter((row) => row && row.Name)
    .map((row) => ({ name: String(row.Name), default: Boolean(row.Default) }));
}

function findBrowserExecutable() {
  if (process.platform !== 'win32') return '';
  const candidates = [
    process.env.IW_PRINT_BROWSER,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

async function getDefaultPrinterName() {
  const printers = await listPrinters();
  return printers.find((printer) => printer.default)?.name || '';
}

async function setDefaultPrinter(name) {
  const safeName = String(name || '').replace(/'/g, "''");
  if (!safeName) return;
  await runPowerShell(`(New-Object -ComObject WScript.Network).SetDefaultPrinter('${safeName}')`);
}

async function printHtml(payload) {
  if (process.platform !== 'win32') {
    throw new Error('Print Agent MVP currently supports Windows only');
  }
  const html = String(payload.html || '').trim();
  if (!html) {
    throw new Error('html is required');
  }
  const browser = findBrowserExecutable();
  if (!browser) {
    throw new Error('Chrome or Microsoft Edge was not found');
  }

  const printerName = String(payload.printer_name || payload.printerName || '').trim();
  const previousDefault = printerName ? await getDefaultPrinterName().catch(() => '') : '';
  if (printerName) {
    await setDefaultPrinter(printerName);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ironwaves-receipt-'));
  const file = path.join(dir, 'receipt.html');
  fs.writeFileSync(file, html, 'utf8');

  const args = [
    '--kiosk-printing',
    '--disable-background-networking',
    '--disable-sync',
    '--no-first-run',
    `file:///${file.replace(/\\/g, '/')}`,
  ];
  const child = spawn(browser, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  setTimeout(() => {
    if (previousDefault && printerName && previousDefault !== printerName) {
      setDefaultPrinter(previousDefault).catch(() => undefined);
    }
  }, 8000);

  setTimeout(() => {
    fs.rm(dir, { recursive: true, force: true }, () => undefined);
  }, 60000);

  return { queued: true, browser: path.basename(browser), printer_name: printerName || 'default' };
}

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
      const payload = JSON.parse(String(await readBody(req) || '{}'));
      sendJson(res, 200, { ok: true, result: await printHtml(payload) });
      return;
    }
    sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`iRonWaves Print Agent ${VERSION} listening on http://${HOST}:${PORT}`);
});
