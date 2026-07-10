// The dashboard, hosted. Unlike serve-dashboard.js — which serves the repo root and
// is safe only because it binds to localhost — this process sits on a public URL, so
// it serves an allowlist of two routes and never touches the filesystem for anything
// else. A path that is not in ROUTES cannot be reached, so no résumé, no .env, no
// src/, no .git, regardless of what ends up in the deployed image.
//
// THIS SITE IS UNAUTHENTICATED, by explicit choice. Anyone who reaches the hostname
// reads the whole board, and /board.json is a public JSON feed of it. The board is a
// catalogue of open postings, not a record of what its owner applied to — that state
// lives in the visitor's own browser. The hostname is not a secret either: Railway's
// TLS certificate publishes it to Certificate Transparency logs the moment a domain is
// attached, so the URL is discoverable by anyone who looks. The noindex header
// and robots.txt below keep compliant search engines out; they stop nothing else.
// Restore the gate by putting basic auth back in front of the ROUTES lookup.
//
// The board is pulled from the private repo on demand rather than baked into the
// image: board.json is rewritten by the Actions job every two hours and committed
// back, so a deployed copy would freeze at build time and never show a new posting.
//
// Required env (the process refuses to start without them — see requireEnv):
//   GITHUB_TOKEN  fine-grained PAT, Contents: Read on this repo only
//   GITHUB_REPO   owner/name
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = parseInt(process.env.PORT || '8080', 10);

// A missing token would leave the page loading forever against a 401 from GitHub, so
// die at boot with a readable reason rather than serve a permanently broken site.
function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`FATAL: ${name} is not set. Refusing to start.`);
    process.exit(1);
  }
  return v;
}

const TOKEN = requireEnv('GITHUB_TOKEN');
const REPO = requireEnv('GITHUB_REPO');

const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'));

// A GitHub blip should not blank the dashboard, and a page reload should not cost a
// round trip to the API. Serve from cache for TTL, and fall back to a stale copy for
// as long as we have one rather than showing an error.
const TTL_MS = 30_000;
let cache = { body: null, at: 0 };

async function fetchBoard() {
  if (cache.body && Date.now() - cache.at < TTL_MS) return cache.body;

  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/board.json`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github.raw+json',
      'User-Agent': 'jobify-dashboard',
    },
  });
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`);

  const body = await res.text();
  JSON.parse(body); // Never cache a truncated or non-JSON response as if it were the board.
  cache = { body, at: Date.now() };
  return body;
}

// Keeps compliant crawlers from indexing an unauthenticated page. Applied to every
// response, since /board.json is as sensitive as the page that renders it.
const NOINDEX = 'noindex, nofollow, noarchive';

const ROUTES = {
  // Served at "/", so the page's own `./board.json` fetch lands on the route below.
  '/': (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': NOINDEX });
    res.end(INDEX_HTML);
  },
  '/robots.txt': (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('User-agent: *\nDisallow: /\n');
  },
  '/board.json': async (_req, res) => {
    let body;
    try {
      body = await fetchBoard();
    } catch (err) {
      if (!cache.body) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Could not read the board from GitHub: ${err.message}`);
        return;
      }
      console.warn(`Serving stale board (${Math.round((Date.now() - cache.at) / 1000)}s old): ${err.message}`);
      body = cache.body;
    }
    // private + no-store: this is one person's live job search. It must not sit in a
    // shared cache or a proxy between Railway and the browser.
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': NOINDEX,
    });
    res.end(body);
  },
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname === '/index.html' ? '/' : url.pathname;

    // Unauthenticated, and deliberately says nothing: Railway's healthcheck runs
    // before the platform will route traffic to a new deploy.
    if (route === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
      return;
    }

    const handler = ROUTES[route];
    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }

    try {
      await handler(req, res);
    } catch (err) {
      console.error(`Unhandled error on ${route}:`, err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal error');
    }
  })
  // 0.0.0.0, not the default: Railway routes to the container from outside it.
  .listen(PORT, '0.0.0.0', () => {
    console.log(`Jobify dashboard on :${PORT} — board from ${REPO}, PUBLIC (no authentication)`);
  });
