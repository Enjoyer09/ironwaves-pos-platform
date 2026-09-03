import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, 'dist');
const port = Number(process.env.PORT || 8080);

const BLOCKED_PATTERNS = [
  /^\/\.env(?:\.|$)/i,
  /\/\.env(?:\.|$)/i,
  /^\/\.git(?:\/|$)/i,
  /\/\.git(?:\/|$)/i,
  /\.php(?:$|\/|\?)/i,
  /^\/wp-admin(?:\/|$)/i,
  /^\/wp-content(?:\/|$)/i,
  /^\/cgi-bin(?:\/|$)/i,
];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const SPA_FALLBACK_FILE = path.join(distDir, 'index.html');

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

function setCacheHeaders(filePath, res) {
  const fileName = path.basename(filePath);
  if (filePath.endsWith('index.html')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return;
  }
  if (
    fileName === 'sw.js' ||
    fileName === 'registerSW.js' ||
    fileName === 'manifest.webmanifest' ||
    /^workbox-.*\.js$/i.test(fileName)
  ) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return;
  }
  if (filePath.includes('/assets/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
}

function sendFile(filePath, res) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    setSecurityHeaders(res);
    setCacheHeaders(filePath, res);
    fs.createReadStream(filePath).pipe(res);
  });
}

function getTenantBrandInfo(hostHeader) {
  const host = String(hostHeader || '').split(':')[0].toLowerCase().trim();
  let brandName = 'iRonWaves POS Platform';
  let shortName = 'iRonWaves POS';
  let description = 'iRonWaves Cloud POS & Restaurant Management Platform';
  const themeColor = '#0f172a';
  const bgColor = '#020617';
  const iconSrc = '/logo.jpg';

  if (host.endsWith('.ironwaves.store')) {
    const subdomain = host.replace('.ironwaves.store', '').trim();
    if (subdomain && subdomain !== 'www' && subdomain !== 'api' && subdomain !== 'menu') {
      if (subdomain === 'super') {
        brandName = 'iRonWaves POS Platform';
        shortName = 'iRonWaves POS';
      } else {
        const formatted = subdomain
          .split(/[-_]+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
        brandName = `${formatted} POS`;
        shortName = `${formatted} POS`;
        description = `${formatted} — Point of Sale & Restaurant Management`;
      }
    }
  } else if (host && !host.includes('localhost') && !host.includes('127.0.0.1') && !host.includes('railway.app')) {
    const mainDomain = host.replace(/^www\./, '').split('.')[0];
    const formatted = mainDomain.charAt(0).toUpperCase() + mainDomain.slice(1);
    brandName = `${formatted} POS`;
    shortName = `${formatted} POS`;
    description = `${formatted} — Point of Sale & Restaurant Management`;
  }

  return {
    name: brandName,
    short_name: shortName,
    description: description,
    theme_color: themeColor,
    background_color: bgColor,
    display: 'standalone',
    orientation: 'any',
    start_url: '/',
    scope: '/',
    categories: ['food', 'business', 'point of sale'],
    prefer_related_applications: false,
    icons: [
      {
        src: '/ironwaves-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/ironwaves-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/ironwaves-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
  };
}

const server = http.createServer((req, res) => {
  // Prevent null-byte injection crashes
  if ((req.url || '').includes('\x00') || (req.url || '').includes('%00')) {
    res.statusCode = 400;
    setSecurityHeaders(res);
    res.end('Bad Request');
    return;
  }

  let pathname = '/';
  try {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    pathname = decodeURIComponent(requestUrl.pathname || '/');
  } catch (err) {
    res.statusCode = 400;
    setSecurityHeaders(res);
    res.end('Bad Request');
    return;
  }

  if (pathname.includes('\x00')) {
    res.statusCode = 400;
    setSecurityHeaders(res);
    res.end('Bad Request');
    return;
  }

  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(pathname))) {
    res.statusCode = 403;
    setSecurityHeaders(res);
    res.end('Forbidden');
    return;
  }

  if (pathname === '/health' || pathname === '/healthz' || pathname === '/api/health') {
    res.statusCode = 200;
    setSecurityHeaders(res);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
    return;
  }

  if (pathname === '/manifest.webmanifest' || pathname === '/manifest.json') {
    const manifest = getTenantBrandInfo(req.headers.host);
    res.statusCode = 200;
    setSecurityHeaders(res);
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.end(JSON.stringify(manifest, null, 2));
    return;
  }

  const candidate = path.normalize(path.join(distDir, pathname));
  const insideDist = candidate.startsWith(distDir);
  const hasExtension = path.extname(pathname) !== '';

  if (insideDist && hasExtension) {
    sendFile(candidate, res);
    return;
  }

  if (insideDist && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    sendFile(candidate, res);
    return;
  }

  sendFile(SPA_FALLBACK_FILE, res);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[frontend] secure static server listening on ${port}`);
});
