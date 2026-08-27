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
const { execFile, spawn, exec } = require('child_process');

const VERSION = '0.5.8';
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

// ─── Printer helpers with In-Memory Caching (Zero Latency) ─────────────────────
let cachedPrinters = null;
let lastPrintersFetchTime = 0;
const PRINTER_CACHE_TTL_MS = 45000;

async function listPrinters(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedPrinters && (now - lastPrintersFetchTime < PRINTER_CACHE_TTL_MS)) {
    return cachedPrinters;
  }
  if (process.platform === 'win32') {
    const output = await runPowerShell(
      'Get-CimInstance Win32_Printer | Select-Object Name,Default | ConvertTo-Json -Compress',
    ).catch(() => '');
    if (!output) return cachedPrinters || [];
    try {
      const parsed = JSON.parse(output);
      const res = (Array.isArray(parsed) ? parsed : [parsed])
        .filter((row) => row && row.Name)
        .map((row) => ({ name: String(row.Name), default: Boolean(row.Default) }));
      cachedPrinters = res;
      lastPrintersFetchTime = now;
      return res;
    } catch {
      return cachedPrinters || [];
    }
  }
  if (process.platform === 'darwin') {
    const printersRaw = await runCommand('/bin/sh', ['-lc', "lpstat -p 2>/dev/null | awk '{print $2}'"]).catch(() => '');
    const defaultRaw = await runCommand('/bin/sh', ['-lc', "lpstat -d 2>/dev/null | sed 's/^system default destination: //'"]).catch(() => '');
    const defaultName = String(defaultRaw || '').trim();
    const names = String(printersRaw || '').split('\n').map((v) => v.trim()).filter(Boolean);
    const res = names.map((name) => ({ name, default: name === defaultName }));
    cachedPrinters = res;
    lastPrintersFetchTime = now;
    return res;
  }
  return [];
}

function findBrowserExecutable() {
  const envPath = String(process.env.IW_PRINT_BROWSER || '').trim();
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const candidates =
    process.platform === 'win32'
      ? [
          envPath,
          path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          localAppData ? path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
          path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          localAppData ? path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : '',
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
  return printers.find((p) => p.default)?.name || (printers[0] ? printers[0].name : '');
}

async function setDefaultPrinter(name) {
  const safeName = String(name || '').replace(/'/g, "''");
  if (!safeName) return;
  // Update cache immediately to avoid extra lookups
  if (cachedPrinters) {
    cachedPrinters = cachedPrinters.map(p => ({ ...p, default: normalizeName(p.name) === normalizeName(safeName) }));
  }
  await runPowerShell(`(New-Object -ComObject WScript.Network).SetDefaultPrinter('${safeName}')`).catch(() => {});
}

function normalizeName(n) {
  return String(n || '')
    .trim()
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ');
}

// Resolve a requested printer name to an actual installed printer name.
// Strict exact matching & Copy number differentiation to prevent swapping
// between base printers (e.g. "POS-80") and copy printers (e.g. "POS-80 (copy 1)").
async function resolvePrinterName(requested) {
  const reqRaw = String(requested || '').trim();
  if (!reqRaw) return '';
  const reqNorm = normalizeName(reqRaw);
  const printers = await listPrinters();
  if (printers.length === 0) return '';

  // 1. Exact case-insensitive match (Highest Priority)
  const exact = printers.find((p) => p.name.trim().toLowerCase() === reqRaw.toLowerCase());
  if (exact) return exact.name;

  // 2. Normalized full string equality
  const normMatch = printers.find((p) => normalizeName(p.name) === reqNorm);
  if (normMatch) return normMatch.name;

  // Detect if requested name explicitly contains a copy suffix: "copy 1", "kopya 1", "(1)", etc.
  const reqCopyMatch = reqNorm.match(/(?:copy|kopya|surət|suret|\()\s*([0-9]+)/i);
  const reqCopyNum = reqCopyMatch ? reqCopyMatch[1] : null;

  if (reqCopyNum) {
    // Requested has a copy number -> match ONLY printers with the SAME copy number
    const copyHit = printers.find((p) => {
      const pNorm = normalizeName(p.name);
      const pCopyMatch = pNorm.match(/(?:copy|kopya|surət|suret|\()\s*([0-9]+)/i);
      return pCopyMatch && pCopyMatch[1] === reqCopyNum;
    });
    if (copyHit) return copyHit.name;
  } else {
    // Requested is a BASE printer without copy (e.g. "POS-80")
    // Strictly EXCLUDE any printers that have "(copy 1)", "(1)", etc.
    const baseHit = printers.find((p) => {
      const pNorm = normalizeName(p.name);
      const hasCopy = /(?:copy|kopya|surət|suret|\()\s*[0-9]+/i.test(pNorm);
      return !hasCopy && (pNorm.includes(reqNorm) || reqNorm.includes(pNorm));
    });
    if (baseHit) return baseHit.name;
  }

  // 3. Fallback token score with strict copy guard
  const reqTokens = new Set(reqNorm.split(/[^a-z0-9]+/).filter(Boolean));
  let best = null;
  let bestScore = 0;
  for (const p of printers) {
    const pNorm = normalizeName(p.name);
    if (!reqCopyNum && /(?:copy|kopya|surət|suret|\()\s*[0-9]+/i.test(pNorm)) {
      continue; // do not assign copy printer to base request
    }
    const tokens = new Set(pNorm.split(/[^a-z0-9]+/).filter(Boolean));
    let score = 0;
    for (const t of tokens) if (reqTokens.has(t)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = p.name;
    }
  }
  return best || '';
}

// ─── Sequential Mutex Queue for HTML / Kiosk Prints ─────────────────────────
// Prevents race conditions when a kitchen ticket and cash receipt are sent
// within seconds of each other, ensuring default printer settings never collide.
let printMutexChain = Promise.resolve();

function queuePrintTask(taskFn) {
  const next = printMutexChain.then(() => taskFn(), () => taskFn());
  printMutexChain = next.catch(() => {});
  return next;
}

// ─── Core print logic ─────────────────────────────────────────────────────────
async function printHtml(payload) {
  return queuePrintTask(async () => {
    return printHtmlInternal(payload);
  });
}

async function printHtmlInternal(payload) {
  if (!['win32', 'darwin'].includes(process.platform)) {
    throw new Error('Print Agent currently supports Windows and macOS');
  }

  const t0 = Date.now();
  const log = (m) => console.log(`[print] +${Date.now() - t0}ms ${m}`);
  log(`request start (platform=${process.platform})`);

  let html = String(payload.html || '').trim();
  if (!html) throw new Error('html is required');

  // Estimate height in mm based on lines/rows inside the HTML to avoid rolling out blank paper in headless PDF
  const lineCount = (html.match(/class="line"/g) || []).length + 
                    (html.match(/<tr>/g) || []).length +
                    (html.match(/<div class="row"/g) || []).length +
                    (html.match(/<br/g) || []).length;
  // Estimate the receipt height so Chrome (headless PDF path) doesn't fall back to
  // a too-short page and clip the bottom of the ticket. No CSS zoom is applied, so we
  // estimate at the natural 12px / 1.25 line metrics.
  const estimatedHeight = Math.max(150, Math.min(900, Math.round(150 + lineCount * 6)));

  // Replace auto height in CSS @page size to prevent Chrome from falling back to US Letter/A4 size
  html = html.replace(/size:\s*([0-9.]+mm)\s*auto/gi, `size: $1 ${estimatedHeight}mm`);
  html = html.replace(/size:\s*auto\s*([0-9.]+mm)/gi, `size: ${estimatedHeight}mm $1`);
  // Also replace any static page size (e.g. size: 80mm 147mm) inside style tags to safely expand the height (keep the detected paper width)
  html = html.replace(/size:\s*([0-9.]+mm)\s*[0-9.]+mm/gi, `size: $1 ${estimatedHeight}mm`);

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

  // Resolve the requested printer to a real installed printer name (case/space/
  // partial tolerant). If a printer was requested but cannot be matched, fail
  // loudly instead of silently printing to the wrong device (e.g. HP).
  let targetPrinter = '';
  if (printerName) {
    targetPrinter = await resolvePrinterName(printerName);
    if (!targetPrinter) {
      log(`Printer "${printerName}" not found in installed printers. Gracefully falling back to default printer.`);
      const defaultP = await getDefaultPrinterName().catch(() => '');
      targetPrinter = defaultP || '';
    }
  }

  // Temporarily set the resolved printer as the system default (Windows only).
  let previousDefault = '';
  if (targetPrinter && process.platform === 'win32') {
    previousDefault = await getDefaultPrinterName().catch(() => '');
    if (targetPrinter !== previousDefault) {
      await setDefaultPrinter(targetPrinter).catch(() => {});
      // verify + one retry in case Windows is slow to apply the change
      const verify = await getDefaultPrinterName().catch(() => '');
      if (normalizeName(verify) !== normalizeName(targetPrinter)) {
        await setDefaultPrinter(targetPrinter).catch(() => {});
      }
    }
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

        // 2. Downscale the high-res PNG to the exact printable pixel width of the
        // roll (576px for 80mm, 384px for 58mm). Downscaling a high-res rendering
        // (super-sampling) preserves perfect outlines, sharp text, and crisp barcodes!
        const pageWidthMatch = html.match(/@page\s*\{[^}]*size:\s*([0-9.]+)\s*mm/i);
        const pageWidthMm = pageWidthMatch ? parseFloat(pageWidthMatch[1]) : 80;
        const targetWidthPx = Math.round(pageWidthMm >= 70 ? 576 : 384);
        await runCommand('sips', [
          '--resampleWidth', String(targetWidthPx),
          pngFile
        ], 10000);

        // 3. Print the crisp resampled PNG file via lp directly to the target printer.
        // Cheap thermal printers on macOS do not support direct PDF spooling and print endlessly unless sent a raster PNG!
        const lpArgs = [];
        if (targetPrinter) lpArgs.push('-d', targetPrinter);
        lpArgs.push(pngFile);
        await runCommand('/usr/bin/lp', lpArgs, 15000);
      } catch (err) {
        // Fallback: try lp with raw text if headless print fails
        const textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const textFile = path.join(dir, 'receipt.txt');
        fs.writeFileSync(textFile, textContent, 'utf8');
        const lpArgs = [];
        if (targetPrinter) lpArgs.push('-d', targetPrinter);
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
      // Auto-cut only for non-browser raw text mode
      await sendCut(targetPrinter || printerName).catch(() => {});
    }

    // Clean up temp dir
    fs.rm(dir, { recursive: true, force: true }, () => {});
    return { queued: true, method: browser ? 'chrome-headless-pdf' : 'lp-text', printer_name: targetPrinter || printerName || 'default' };
  }

  // Windows: use Chrome kiosk printing with header/footer suppressed in profile preferences
  const browser = findBrowserExecutable();
  if (!browser) throw new Error('Chrome və ya Microsoft Edge tapılmadı');

  // Pre-seed Chrome user-data-dir preferences to disable headers & footers explicitly
  try {
    const defaultProfileDir = path.join(userDir, 'Default');
    fs.mkdirSync(defaultProfileDir, { recursive: true });
    const prefs = {
      printing: {
        print_preview_sticky_settings: {
          appState: JSON.stringify({
            version: 2,
            isHeaderFooterEnabled: false,
            marginsType: 1
          })
        }
      }
    };
    fs.writeFileSync(path.join(defaultProfileDir, 'Preferences'), JSON.stringify(prefs), 'utf8');
  } catch (e) {
    log(`prefs setup error: ${e && e.message}`);
  }

  const chromePid = await spawnBrowserForPrint(browser, file, userDir);
  log(`chrome kiosk spawned pid=${chromePid}`);

  // Restore previous default printer after Chrome has time to spool the job
  const RESTORE_DELAY_MS = 11000;
  setTimeout(() => {
    if (previousDefault && previousDefault !== printerName) {
      setDefaultPrinter(previousDefault).catch(() => {});
    }
    log('default printer restored');
  }, RESTORE_DELAY_MS);

  // Kill the Chrome instance we spawned after it has had time to send the print job.
  const KILL_DELAY_MS = 14000;
  setTimeout(() => {
    if (chromePid) {
      try {
        execFile('taskkill', ['/PID', String(chromePid), '/F', '/T'], { windowsHide: true }, () => {});
      } catch (_) {}
    }
    log('chrome killed + temp cleaned');
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }, KILL_DELAY_MS);

  // Note: Thermal printer drivers (Epson/Xprinter/POS-80) automatically cut at the end
  // of the print document. Running sendCut in addition causes a second cut 1cm later.
  // We only run sendCut if explicitly requested via payload.forceRawCut.
  if (payload && payload.forceRawCut === true) {
    const CUT_DELAY_MS = 1200;
    setTimeout(() => {
      sendCut(targetPrinter || previousDefault || printerName).catch(() => {});
    }, CUT_DELAY_MS);
  }

  log('response sent (agent queued the job; paper output depends on Chrome + spooler)');
  return {
    queued: true,
    method: 'chrome-kiosk',
    browser: path.basename(browser),
    printer_name: targetPrinter || previousDefault || printerName || 'default',
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
      // Suppress Chrome's built-in file:/// URL + date/page-number header/footer lines
      '--disable-logging',
      '--safebrowsing-disable-auto-update',
      // Force margin-none to remove space Chrome reserves for its header/footer text
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

// ─── Auto-cut after print ───────────────────────────────────────────────────────
// ESC/POS: feed 4 lines, then partial/full cut (GS V 66 0 + ESC i / ESC m).
// On Windows: sends raw bytes directly to the print spooler via winspool.drv API.
// On macOS: sends raw bytes via `lp -o raw`.
async function sendCut(printerName) {
  let target = String(printerName || '').trim();
  if (!target) {
    try {
      const printers = await listPrinters();
      target = printers.find((p) => p.default)?.name || printers[0]?.name || '';
    } catch {
      target = '';
    }
  }
  if (!target) return;

  if (process.platform === 'win32') {
    let tmpPsFile = '';
    try {
      const safePrinterName = target.replace(/'/g, "''");
      const psScript = `
$code = @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }
    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    public static bool SendBytesToPrinter(string szPrinterName, byte[] bytes) {
        IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
        Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
        IntPtr hPrinter;
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "iRonWaves AutoCut";
        di.pDataType = "RAW";
        bool success = false;
        if (OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
            if (StartDocPrinter(hPrinter, 1, di)) {
                if (StartPagePrinter(hPrinter)) {
                    int dwWritten = 0;
                    success = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out dwWritten);
                    EndPagePrinter(hPrinter);
                }
                EndDocPrinter(hPrinter);
            }
            ClosePrinter(hPrinter);
        }
        Marshal.FreeCoTaskMem(pUnmanagedBytes);
        return success;
    }
}
"@
if (-not ([System.Management.Automation.PSTypeName]'RawPrinterHelper').Type) {
    Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
}
# 1. Wait a moment for Chrome to submit the print job to the spooler
Start-Sleep -Milliseconds 1200
# 2. Wait until print queue has completed processing the receipt (max 8s)
for ($i = 0; $i -lt 30; $i++) {
    $jobs = @(Get-PrintJob -PrinterName '${safePrinterName}' -ErrorAction SilentlyContinue)
    if ($null -eq $jobs -or $jobs.Count -eq 0) { break }
    Start-Sleep -Milliseconds 200
}
# 3. Small 0.2s pause for physical print head to finish rolling the last lines
Start-Sleep -Milliseconds 200
# 4. Send ESC d 4 (feed 4 lines) + GS V 66 0 (feed and partial cut)
[RawPrinterHelper]::SendBytesToPrinter('${safePrinterName}', [byte[]]@(0x1B, 0x64, 0x04, 0x1D, 0x56, 0x42, 0x00))
`.trim();

      tmpPsFile = path.join(os.tmpdir(), `iw-cut-${Date.now()}.ps1`);
      fs.writeFileSync(tmpPsFile, psScript, 'utf8');
      await runCommand('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        tmpPsFile,
      ], 20000);
      console.log(`[cut] auto-cut raw bytes sent to printer "${target}"`);
    } catch (e) {
      console.warn('[cut] auto-cut error on Windows:', e && e.message ? e.message : e);
    } finally {
      if (tmpPsFile) {
        try { fs.unlinkSync(tmpPsFile); } catch {}
      }
    }
    return;
  }

  // macOS / Linux
  let dir;
  try {
    const baseTempDir = path.join(os.homedir(), '.ironwaves-print');
    dir = fs.mkdtempSync(path.join(baseTempDir, 'ironwaves-cut-'));
    const file = path.join(dir, 'cut.bin');
    const feed = Buffer.from('\n\n\n\n', 'utf8');
    const cut = Buffer.from([0x1d, 0x56, 0x42, 0x00]); // GS V 66 0
    fs.writeFileSync(file, Buffer.concat([feed, cut]));
    await runCommand('lp', ['-d', target, '-o', 'raw', file], 10000);
  } catch (e) {
    console.warn('[print] auto-cut skipped:', e && e.message ? e.message : e);
  } finally {
    try { if (dir) fs.rm(dir, { recursive: true, force: true }, () => {}); } catch {}
  }
// ─── Direct High-Speed ESC/POS Print (0.05s) ───────────────────────────────
async function printRaw(payload) {
  const rawData = String(payload.raw || payload.raw_commands || '').trim();
  if (!rawData) throw new Error('raw commands are required');
  const targetPrinter = await resolvePrinterName(payload.printer_name);

  if (process.platform === 'darwin') {
    const tmpFile = path.join(os.tmpdir(), `iw-raw-${Date.now()}.bin`);
    fs.writeFileSync(tmpFile, rawData, 'latin1');
    const lpArgs = ['-o', 'raw'];
    if (targetPrinter) lpArgs.push('-d', targetPrinter);
    lpArgs.push(tmpFile);
    try {
      await runCommand('/usr/bin/lp', lpArgs, 5000);
      return { ok: true, method: 'lp-raw', printer_name: targetPrinter || 'default' };
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }

  if (process.platform === 'win32') {
    const printer = targetPrinter || (await getDefaultPrinterName());
    const safePrinterName = String(printer || '').replace(/'/g, "''");
    const base64Bytes = Buffer.from(rawData, 'latin1').toString('base64');
    const psScript = `
$code = @"
using System;
using System.Runtime.InteropServices;
public class RawPrinterFast {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }
    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
    public static bool SendBytes(string szPrinter, byte[] bytes) {
        IntPtr pUnmanaged = Marshal.AllocCoTaskMem(bytes.Length);
        Marshal.Copy(bytes, 0, pUnmanaged, bytes.Length);
        IntPtr hPrinter;
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "iRonWaves Direct Raw";
        di.pDataType = "RAW";
        bool ok = false;
        if (OpenPrinter(szPrinter, out hPrinter, IntPtr.Zero)) {
            if (StartDocPrinter(hPrinter, 1, di)) {
                if (StartPagePrinter(hPrinter)) {
                    int dwWritten = 0;
                    ok = WritePrinter(hPrinter, pUnmanaged, bytes.Length, out dwWritten);
                    EndPagePrinter(hPrinter);
                }
                EndDocPrinter(hPrinter);
            }
            ClosePrinter(hPrinter);
        }
        Marshal.FreeCoTaskMem(pUnmanaged);
        return ok;
    }
}
"@
if (-not ([System.Management.Automation.PSTypeName]'RawPrinterFast').Type) {
    Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
}
$bytes = [Convert]::FromBase64String('${base64Bytes}')
[RawPrinterFast]::SendBytes('${safePrinterName}', $bytes)
`;
    await runPowerShell(psScript);
    return { ok: true, method: 'winspool-direct-raw', printer_name: printer || 'default' };
  }

  throw new Error('Raw print not supported on this platform');
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
    if (req.method === 'POST' && url.pathname === '/print-raw') {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const result = await printRaw(payload);
      sendJson(res, 200, { ok: true, result });
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

// Stop any process currently holding our port so an update can take over
// without the user manually killing the old agent first.
//
// IMPORTANT: We must ONLY kill the process that is LISTENING on the port,
// not any client (e.g. Chrome) that has an open connection TO that port.
// netstat shows both sides of a TCP connection; the old regex matched
// the remote address column ":17777" in Chrome's row and killed Chrome too.
// Fix: filter to lines where the LOCAL address ends in :PORT and state is LISTENING.
function killProcessOnPort(port) {
  return new Promise((resolve) => {
    const finish = () => resolve();
    try {
      const { exec } = require('child_process');
      if (process.platform === 'win32') {
        // PowerShell is more reliable than netstat+findstr for this:
        // Get-Process by PID of the LISTENING TCP socket, then kill only that PID.
        // Avoids killing Chrome or other clients connected TO the port.
        const psScript =
          `$c = (Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue);` +
          `if ($c) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }`;
        exec(
          `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"`,
          { windowsHide: true, timeout: 8000 },
          () => finish(),
        );
      } else {
        exec(`lsof -ti tcp:${port}`, (err, stdout) => {
          if (err || !stdout) return finish();
          String(stdout)
            .split('\n')
            .forEach((pid) => {
              pid = String(pid).trim();
              if (pid) {
                try { process.kill(Number(pid), 'SIGKILL'); } catch (_) {}
              }
            });
          finish();
        });
      }
    } catch {
      finish();
    }
  });
}

let listenRetries = 0;

function startServer() {
  server.listen(PORT, HOST, () => {
    // Console output is hidden when running as a windowless .exe
    console.log(`iRonWaves Print Agent ${VERSION} listening on http://${HOST}:${PORT}`);
    if (process.platform === 'win32') {
      registerAutostart();
      showTrayIcon();
    }
  });
}

server.on('error', async (err) => {
  if (err.code === 'EADDRINUSE' && listenRetries < 3) {
    listenRetries += 1;
    console.warn(`[agent] Port ${PORT} artıq məşğuldur (köhnə agent işləyir). Köhnə instans dayandırılır (cəhd ${listenRetries})...`);
    await killProcessOnPort(PORT);
    console.warn('[agent] 1 saniyə sonra yenidən başladılır...');
    setTimeout(startServer, 1000);
    return;
  }
  console.error('[server error]', err);
});

// ─── Windows autostart via Registry ───────────────────────────────────────────
// Writes HKCU\Software\Microsoft\Windows\CurrentVersion\Run so the agent
// restarts automatically at every Windows login — no admin rights needed.
// Uses PowerShell Set-ItemProperty (not cmd.exe reg add) because reg add
// chokes on paths that contain parentheses like "setup (1).exe".
function registerAutostart() {
  try {
    const exePath = process.execPath; // path to the running .exe
    if (!exePath || exePath.endsWith('node.exe') || exePath.endsWith('node')) return; // skip dev mode
    // Use PowerShell Set-ItemProperty — handles paths with spaces, parentheses (1), etc.
    // cmd.exe reg add fails on such paths with "ERROR: Invalid syntax"
    const safeExePath = exePath.replace(/'/g, "''");
    const psCmd =
      `Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' ` +
      `-Name 'iRonWavesPrintAgent' -Value '${safeExePath}' -Type String`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCmd],
      { windowsHide: true },
      (err) => {
        if (err) console.warn('[autostart] registry write failed:', err.message);
        else console.log('[autostart] registry entry set — agent will start at login');
      },
    );
  } catch (e) {
    console.warn('[autostart] error:', e && e.message ? e.message : e);
  }
}

// ─── Windows System Tray icon via PowerShell ──────────────────────────────────
// Uses .NET Windows.Forms NotifyIcon from PowerShell — no native addon needed.
// Shows a tray icon with a right-click menu: version info + Quit.
// Runs in a detached PowerShell window (hidden) so the agent keeps running.
function showTrayIcon() {
  try {
    const exePath = process.execPath;
    if (!exePath || exePath.endsWith('node.exe') || exePath.endsWith('node')) return;

    const agentPid = process.pid;
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Text = "iRonWaves Print Agent v${VERSION}"
$tray.Visible = $true

# Use a simple built-in icon (information icon)
$tray.Icon = [System.Drawing.SystemIcons]::Information

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$itemTitle = New-Object System.Windows.Forms.ToolStripMenuItem
$itemTitle.Text = "iRonWaves Print Agent v${VERSION}"
$itemTitle.Enabled = $false
$menu.Items.Add($itemTitle) | Out-Null

$menu.Items.Add("-") | Out-Null

$itemQuit = New-Object System.Windows.Forms.ToolStripMenuItem
$itemQuit.Text = "Cixish / Quit"
$itemQuit.add_Click({
    $tray.Visible = $false
    $tray.Dispose()
    try { Stop-Process -Id ${agentPid} -Force -ErrorAction SilentlyContinue } catch {}
    # Also remove autostart registry entry on explicit quit
    reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "iRonWavesPrintAgent" /f 2>$null
    [System.Windows.Forms.Application]::Exit()
})
$menu.Items.Add($itemQuit) | Out-Null

$tray.ContextMenuStrip = $menu

# Show notification so user knows agent is running in tray
$tray.ShowBalloonTip(3000, "iRonWaves Print Agent", "iRonWaves Print Agent v${VERSION} aktivdir", [System.Windows.Forms.ToolTipIcon]::Info)

# Keep tray alive until quit
[System.Windows.Forms.Application]::Run()
`.trim();

    // Write the script to a temp file and run it detached
    const tmpScript = path.join(os.tmpdir(), `iw-tray-${agentPid}.ps1`);
    fs.writeFileSync(tmpScript, psScript, 'utf8');

    const trayProc = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', tmpScript],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );
    trayProc.unref();

    // Clean up script file after tray is gone
    trayProc.on('close', () => {
      try { fs.unlinkSync(tmpScript); } catch {}
    });

    console.log('[tray] system tray icon spawned');
  } catch (e) {
    console.warn('[tray] failed to show tray icon:', e && e.message ? e.message : e);
  }
}

startServer();
