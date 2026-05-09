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
  if (filePath.endsWith('index.html')) {
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

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(requestUrl.pathname || '/');

  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(pathname))) {
    res.statusCode = 403;
    setSecurityHeaders(res);
    res.end('Forbidden');
    return;
  }

  if (pathname === '/healthz') {
    res.statusCode = 200;
    setSecurityHeaders(res);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ status: 'ok' }));
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
