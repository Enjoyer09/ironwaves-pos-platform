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

  let html = String(payload.html || '').trim();
  if (!html) throw new Error('html is required');

  // Estimate height in mm based on lines/rows inside the HTML to avoid rolling out blank paper in headless PDF
  const lineCount = (html.match(/class="line"/g) || []).length + 
                    (html.match(/<tr>/g) || []).length +
                    (html.match(/<div class="row"/g) || []).length +
                    (html.match(/<br/g) || []).length;
  // Standard receipt base is around 110mm (generous space for headers, QR code, barcode, and footers), plus 6.5mm per text line
  const estimatedHeight = Math.max(120, Math.min(500, Math.round(110 + (lineCount * 6.5))));

  // Replace auto height in CSS @page size to prevent Chrome from falling back to US Letter/A4 size
  html = html.replace(/size:\s*([0-9.]+mm)\s*auto/gi, `size: $1 ${estimatedHeight}mm`);
  html = html.replace(/size:\s*auto\s*([0-9.]+mm)/gi, `size: ${estimatedHeight}mm $1`);
  // Also replace any static page size (e.g. size: 80mm 147mm) inside style tags to safely expand the height
  html = html.replace(/size:\s*[0-9.]+mm\s*[0-9.]+mm/gi, `size: 80mm ${estimatedHeight}mm`);

  // Inject window.print() inside a script tag if it doesn't already trigger printing (using immediate execution)
  if (!html.includes('window.print(')) {
    const printScript = `\n<script>
(function() {
  function triggerPrint() {
    if (!sessionStorage.getItem("iw_printed")) {
      sessionStorage.setItem("iw_printed", "1");
      window.print();
    }
  }
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(triggerPrint, 350);
  } else {
    window.addEventListener("DOMContentLoaded", function() {
      setTimeout(triggerPrint, 350);
    });
  }
})();
</script>`;
    if (html.includes('</body>')) {
      html = html.replace('</body>', printScript + '\n</body>');
    } else if (html.includes('</html>')) {
      html = html.replace('</html>', printScript + '\n</html>');
    } else {
      html += printScript;
    }
  }

  const printerName = String(payload.printer_name || payload.printerName || '').trim();

  // Write HTML to a temp file. On macOS, we avoid the system /tmp folder to bypass sandbox bans in qlmanage (which causes 20s hangs).
  const baseTempDir = process.platform === 'darwin'
    ? path.join(os.homedir(), '.ironwaves-print')
    : os.tmpdir();
  if (process.platform === 'darwin' && !fs.existsSync(baseTempDir)) {
    fs.mkdirSync(baseTempDir, { recursive: true });
  }
  const dir = fs.mkdtempSync(path.join(baseTempDir, 'ironwaves-receipt-'));
  const file = path.join(dir, 'receipt.html');
  fs.writeFileSync(file, html, 'utf8');

  // Create clean temp profile dir for Chrome to avoid session locking and force silent print
  const userDir = path.join(dir, 'chrome-profile');
  fs.mkdirSync(userDir, { recursive: true });

  // Temporarily set default printer if a specific one was requested (Windows only)
  let previousDefault = '';
  if (printerName && process.platform === 'win32') {
    previousDefault = await getDefaultPrinterName().catch(() => '');
    await setDefaultPrinter(printerName).catch(() => {});
  }

  // macOS print logic
  if (process.platform === 'darwin') {
    const browser = findBrowserExecutable();
    const pdfFile = path.join(dir, 'receipt.pdf');
    
    if (browser) {
      // macOS: Use Chrome headless to convert HTML to PDF silently (with speed-up flags)
      const chromeArgs = [
        '--headless',
        `--user-data-dir=${userDir}`,
        '--disable-gpu',
        '--disable-extensions',
        '--disable-sync',
        '--no-first-run',
        '--disable-default-apps',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--no-sandbox',
        '--print-to-pdf-no-header',
        `--print-to-pdf=${pdfFile}`,
        `file://${file}`,
      ];

      try {
        await new Promise((resolve, reject) => {
          execFile(browser, chromeArgs, { timeout: 10000 }, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        // 1. Render the PDF vector page to a super high-resolution PNG (3000px height) using macOS's built-in QuickLook engine.
        // Since we are running in the user's home folder, this is instant (<0.1s) and has no sandbox timeout blocks!
        await runCommand('qlmanage', [
          '-t',
          '-s', '3000',
          '-o', dir,
          pdfFile
        ], 10000);

        const pngFile = path.join(dir, 'receipt.pdf.png');

        // 2. Downscale the high-res PNG to exactly 576 pixels wide (the standard printable width for 80mm thermal printers).
        // Downscaling a high-res rendering (super-sampling) preserves perfect outlines, sharp text, and crisp barcodes!
        await runCommand('sips', [
          '--resampleWidth', '576',
          pngFile
        ], 10000);

        // 3. Print the crisp resampled PNG file via lp directly to the target printer.
        // Cheap thermal printers on macOS do not support direct PDF spooling and print endlessly unless sent a raster PNG!
        const lpArgs = [];
        if (printerName) lpArgs.push('-d', printerName);
        lpArgs.push(pngFile);
        await runCommand('/usr/bin/lp', lpArgs, 15000);
      } catch (err) {
        // Fallback: try lp with raw text if headless print fails
        const textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const textFile = path.join(dir, 'receipt.txt');
        fs.writeFileSync(textFile, textContent, 'utf8');
        const lpArgs = [];
        if (printerName) lpArgs.push('-d', printerName);
        lpArgs.push(textFile);
        await runCommand('/usr/bin/lp', lpArgs, 15000);
      }
    } else {
      // Fallback: try lp with raw text (strip HTML tags)
      const textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const textFile = path.join(dir, 'receipt.txt');
      fs.writeFileSync(textFile, textContent, 'utf8');
      const lpArgs = [];
      if (printerName) lpArgs.push('-d', printerName);
      lpArgs.push(textFile);
      await runCommand('/usr/bin/lp', lpArgs, 15000);
    }

    // Clean up temp dir
    fs.rm(dir, { recursive: true, force: true }, () => {});
    return { queued: true, method: browser ? 'chrome-headless-pdf' : 'lp-text', printer_name: printerName || 'default' };
  }

  // Windows: use Chrome kiosk printing
  const browser = findBrowserExecutable();
  if (!browser) throw new Error('Chrome or Microsoft Edge was not found');

  const chromePid = await spawnBrowserForPrint(browser, file, userDir);

  // Restore previous default printer after Chrome has time to spool the job
  const RESTORE_DELAY_MS = 9000;
  setTimeout(() => {
    if (previousDefault && previousDefault !== printerName) {
      setDefaultPrinter(previousDefault).catch(() => {});
    }
  }, RESTORE_DELAY_MS);

  // Kill the Chrome instance we spawned after it has had time to send the print job.
  const KILL_DELAY_MS = 12000;
  setTimeout(() => {
    if (chromePid) {
      try {
        execFile('taskkill', ['/PID', String(chromePid), '/F', '/T'], { windowsHide: true }, () => {});
      } catch (_) {}
    }
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }, KILL_DELAY_MS);

  return {
    queued: true,
    method: 'chrome-kiosk',
    browser: path.basename(browser),
    printer_name: printerName || 'default',
  };
}

function spawnBrowserForPrint(browser, htmlFile, userDir) {
  return new Promise((resolve) => {
    const args = [
      '--kiosk-printing',
      `--user-data-dir=${userDir}`,
      '--disable-background-networking',
      '--disable-extensions',
      '--disable-sync',
      '--no-first-run',
      '--disable-default-apps',
      '--no-default-browser-check',
      '--window-position=3000,3000',
      '--window-size=800,800',
      htmlFile,
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
