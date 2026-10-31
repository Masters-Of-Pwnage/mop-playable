import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.pck': 'application/octet-stream',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Minimal static file handler for the Godot web export.
 * Returns true when the request was handled.
 */
export function serveStatic(req, res, config) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return true;
  }
  if (urlPath.includes('\0')) {
    res.writeHead(400).end();
    return true;
  }
  const root = path.resolve(config.staticDir);
  let file = path.resolve(root, `.${urlPath}`);
  // Path traversal guard.
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return true;
  }
  if (urlPath.endsWith('/')) file = path.join(file, 'index.html');
  let stat;
  try {
    stat = fs.statSync(file);
    if (stat.isDirectory()) {
      file = path.join(file, 'index.html');
      stat = fs.statSync(file);
    }
  } catch {
    if (urlPath === '/config.json') {
      // No static config: tell the client to use this same server for the lobby.
      sendJson(res, { server_url: config.publicWsUrl || '' });
      return true;
    }
    return false;
  }
  // The guard above is lexical only: a symlink inside the root must not lead out of it either.
  try {
    const rootReal = fs.realpathSync(root);
    const real = fs.realpathSync(file);
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
      res.writeHead(403).end();
      return true;
    }
  } catch {
    return false;
  }
  const ext = path.extname(file).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'X-Content-Type-Options': 'nosniff',
    // Big game files rarely change between deploys; HTML and the service worker must be fresh.
    'Cache-Control': ['.html', '.json', '.webmanifest'].includes(ext) || file.endsWith('.service.worker.js')
      ? 'no-cache'
      : 'public, max-age=3600',
  };
  if (config.crossOriginIsolation) {
    headers['Cross-Origin-Opener-Policy'] = 'same-origin';
    headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  // pipeline() closes the file when the client goes away and swallows read errors (EACCES, EMFILE);
  // .pipe() leaked one descriptor per aborted download.
  pipeline(fs.createReadStream(file), res, () => {});
  return true;
}

export function sendJson(res, body, status = 200, extra = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end(data);
}
