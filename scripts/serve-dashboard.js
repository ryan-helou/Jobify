// Tiny zero-dependency static server for viewing the dashboard locally.
// Serves the repo root so /docs/ can reach ../board.json, and — unlike the public
// hosted server — accepts writes to /applied.json so the "applied"/"dismissed" marks
// you make persist to a committed file instead of dying with the browser profile.
//   node scripts/serve-dashboard.js  ->  http://localhost:8080/docs/
//
// The write endpoint is safe only because this binds to localhost: it writes exactly
// one path (applied.json in the repo root) and nothing else. applied.json is a private
// record of what you applied to — it is deliberately kept out of the public hosted
// server's route allowlist and out of the Pages artifact, so it never leaves this repo.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = parseInt(process.env.PORT || '8080', 10);
const APPLIED = path.join(ROOT, 'applied.json');
const MAX_BODY = 5 * 1024 * 1024; // a mark file is tiny; cap the write to refuse abuse
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

// Persist the posted marks to applied.json. Validates it's the expected shape and
// writes atomically (temp file + rename) so a crash mid-write can't truncate it.
function writeApplied(req, res) {
  let body = '';
  let tooBig = false;
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > MAX_BODY) {
      tooBig = true;
      res.writeHead(413).end('Too large');
      req.destroy();
    }
  });
  req.on('end', () => {
    if (tooBig) return;
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400).end('Invalid JSON');
      return;
    }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.marks !== 'object') {
      res.writeHead(400).end('Expected { version, marks }');
      return;
    }
    const tmp = APPLIED + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(parsed, null, 2) + '\n');
      fs.renameSync(tmp, APPLIED);
    } catch (err) {
      res.writeHead(500).end('Write failed: ' + err.message);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
  });
}

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);

    if (req.method === 'POST' && urlPath === '/applied.json') {
      writeApplied(req, res);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end('Method not allowed');
      return;
    }

    let rel = urlPath;
    if (rel.endsWith('/')) rel += 'index.html';
    const filePath = path.join(ROOT, path.normalize(rel));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        // A missing applied.json is normal before the first mark — answer with an
        // empty mark set so the page doesn't log a 404 on every load.
        if (urlPath === '/applied.json') {
          res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"version":1,"marks":{}}');
          return;
        }
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(PORT, () => {
    console.log(`Dashboard: http://localhost:${PORT}/docs/`);
  });
