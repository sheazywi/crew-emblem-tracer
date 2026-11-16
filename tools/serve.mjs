#!/usr/bin/env node
// Zero-dependency static server for the built app, used by start.cmd and start.sh.
//
//   node tools/serve.mjs                  serve dist/ on http://localhost:8080
//   node tools/serve.mjs --port 3000      another port (or PORT=3000)
//   node tools/serve.mjs --lan            also reachable from other devices on your network
//   node tools/serve.mjs --open           open the browser (--no-open overrides it)
//
// The app is fully static and makes no network calls, so this server only reads files from one
// folder. It never lists directories and refuses any path outside that folder.
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
};

if (flag('help') || flag('h')) {
  console.log(
    'Usage: node serve.mjs [--port 8080] [--lan] [--host <address>] [--dir <folder>] [--open | --no-open]',
  );
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(option('dir') ?? join(here, '..', 'dist'));
const port = Number(option('port') ?? process.env.PORT ?? 8080);
const host = option('host') ?? process.env.HOST ?? (flag('lan') ? '0.0.0.0' : '127.0.0.1');

if (!existsSync(join(root, 'index.html'))) {
  console.error(`No index.html in ${root}.`);
  console.error('Build the app first (pnpm build), or pass --dir <folder with index.html>.');
  process.exit(1);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Not a valid port: ${option('port') ?? process.env.PORT}`);
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function resolvePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  let file = resolve(root, '.' + (decoded.endsWith('/') ? decoded + 'index.html' : decoded));
  if (file !== root && !file.startsWith(root + sep)) return null;
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    return statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', ...HEADERS }).end();
    return;
  }
  const file = resolvePath(req.url ?? '/');
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...HEADERS }).end('Not found');
    return;
  }
  // Hashed files under assets/ never change; the page and the service worker must stay fresh.
  const immutable = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': statSync(file).size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...HEADERS,
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${port} is in use. Try --port ${port + 1}.`);
  else console.error(err.message);
  process.exit(1);
});

server.listen(port, host, () => {
  const local = `http://localhost:${port}/`;
  console.log(`Crest Forge is running at ${local}`);
  if (host === '0.0.0.0' || host === '::') {
    for (const list of Object.values(networkInterfaces())) {
      for (const a of list ?? []) {
        if (a.family === 'IPv4' && !a.internal)
          console.log(`  on your network: http://${a.address}:${port}/`);
      }
    }
    console.log('  (offline mode and some clipboard features need localhost or HTTPS)');
  }
  console.log('Press Ctrl+C to stop.');
  if (flag('open') && !flag('no-open')) openBrowser(local);
});

function openBrowser(url) {
  const [cmd, cmdArgs] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  try {
    spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true })
      .on('error', () => undefined)
      .unref();
  } catch {
    // No browser launcher: the URL above is enough.
  }
}
