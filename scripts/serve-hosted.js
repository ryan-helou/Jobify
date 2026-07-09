// The dashboard, hosted. Unlike serve-dashboard.js — which serves the repo root and
// is safe only because it binds to localhost — this process sits on a public URL, so
// it serves an allowlist of two routes and never touches the filesystem for anything
// else. A path that is not in ROUTES cannot be reached, so no résumé, no .env, no
// src/, no .git, regardless of what ends up in the deployed image.
//
// The ledger is pulled from the private repo on demand rather than baked into the
// image: applied_jobs.json is written by the Actions job and committed back, so a
// deployed copy is frozen at build time and would never show a new application.
//
// Required env (the process refuses to start without them — see requireEnv):
//   DASHBOARD_PASSWORD  gate for the whole site
//   GITHUB_TOKEN        fine-grained PAT, Contents: Read on this repo only
//   GITHUB_REPO         owner/name
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = parseInt(process.env.PORT || '8080', 10);
const REALM = 'Jobify';

// Fail closed. An unset password on a public URL is not "no auth", it is a leak of
// every company this repo has applied to — the exposure pages.yml refuses.
function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`FATAL: ${name} is not set. Refusing to start.`);
    process.exit(1);
  }
  return v;
}

const PASSWORD = requireEnv('DASHBOARD_PASSWORD');
const TOKEN = requireEnv('GITHUB_TOKEN');
const REPO = requireEnv('GITHUB_REPO');
const USER = process.env.DASHBOARD_USER || 'jobify';

const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'));

// Compare digests, not the secrets themselves: timingSafeEqual throws on a length
// mismatch, which would otherwise turn "wrong length" into a fast rejection and leak
// the password's length.
const digest = (s) => crypto.createHash('sha256').update(s).digest();
function secretsMatch(a, b) {
  return crypto.timingSafeEqual(digest(a), digest(b));
}

function authorized(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep === -1) return false;
  return secretsMatch(decoded.slice(0, sep), USER) & secretsMatch(decoded.slice(sep + 1), PASSWORD);
}

// A GitHub blip should not blank the dashboard, and a page reload should not cost a
// round trip to the API. Serve from cache for TTL, and fall back to a stale copy for
// as long as we have one rather than showing an error.
const TTL_MS = 30_000;
let cache = { body: null, at: 0 };

async function fetchLedger() {
  if (cache.body && Date.now() - cache.at < TTL_MS) return cache.body;

  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/applied_jobs.json`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github.raw+json',
      'User-Agent': 'jobify-dashboard',
    },
  });
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`);

  const body = await res.text();
  JSON.parse(body); // Never cache a truncated or non-JSON response as if it were the ledger.
  cache = { body, at: Date.now() };
  return body;
}

const ROUTES = {
  // Served at "/", so the page's own `./applied_jobs.json` fetch lands on the route below.
  '/': (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(INDEX_HTML);
  },
  '/applied_jobs.json': async (_req, res) => {
    let body;
    try {
      body = await fetchLedger();
    } catch (err) {
      if (!cache.body) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Could not read the ledger from GitHub: ${err.message}`);
        return;
      }
      console.warn(`Serving stale ledger (${Math.round((Date.now() - cache.at) / 1000)}s old): ${err.message}`);
      body = cache.body;
    }
    // private + no-store: this is a log of a live job search. It must not sit in a
    // shared cache or a proxy between Railway and the browser.
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' });
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

    if (!authorized(req)) {
      res.writeHead(401, {
        'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
        'Content-Type': 'text/plain; charset=utf-8',
      });
      res.end('Authentication required.');
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
    console.log(`Jobify dashboard on :${PORT} — ledger from ${REPO}, basic auth as "${USER}"`);
  });
