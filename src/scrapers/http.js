import * as cheerio from 'cheerio';

// Shared plumbing for the ATS scrapers. They enumerate a few thousand public,
// unauthenticated company endpoints per run, so they stay polite: bounded
// concurrency, hard timeouts, and no retries — a board that fails is skipped.

// Job descriptions arrive as HTML, sometimes with entities escaped twice. cheerio
// decodes them; stripping the tags afterwards leaves prose for keyword matching.
export function htmlToText(html) {
  if (!html) return '';
  return cheerio
    .load(String(html))
    .text()
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Runs `fn` over `items` with at most `limit` in flight. A thrown task yields null
// rather than rejecting the whole batch, so one dead board can't lose the others.
export async function mapLimit(items, limit, fn) {
  const out = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      try {
        out.push(await fn(items[i]));
      } catch {
        out.push(null); // dead board, 404, rate limit — skip it
      }
    }
  });
  await Promise.all(workers);
  return out;
}

// Discarding a response without reading it is not free. undici's HTTP/1 parser
// pauses when a body applies backpressure and only resumes once that body is
// consumed; an abandoned body leaves it paused forever. When the server later closes
// that keep-alive socket, `Parser.finish()` asserts `!this.paused` and throws — from
// a socket 'end' handler, where no try/catch around fetch can reach it, so the whole
// process dies. A run abandons ~150 bodies on 404s alone (dead boards, missing
// Workday sites), which made this reliably fatal. Cancel the body, then throw.
//
// (Node's own fetch is affected because cheerio imports userland undici, which
// claims globalThis[Symbol.for('undici.globalDispatcher.1')] for every fetch here.)
export async function getJson(url, init = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), ...init });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

export function postJson(url, body) {
  return getJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
}

// Some boards answer HTML (iCIMS search pages) or XML (Personio) rather than JSON.
// Same body-cancel discipline as getJson: an unread body wedges undici's parser.
// A default browser-ish User-Agent is sent because a few of these hosts return a
// challenge page to an empty agent.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export async function getText(url, init = {}) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    ...init,
    headers: { 'User-Agent': BROWSER_UA, ...(init.headers || {}) },
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${res.status}`);
  }
  return res.text();
}

// The tail every board scraper shares: flatten per-board results (mapLimit yields
// one list — or null for a dead board — per board), then drop duplicate URLs a
// company can list twice. Kept here so a new scraper can't get the dedup subtly
// wrong; the existing ats/workday/smartrecruiters scrapers predate it and inline
// their own copy.
export function dedupeByUrl(results) {
  const seen = new Set();
  const jobs = [];
  for (const list of results) {
    for (const job of list || []) {
      if (!job || seen.has(job.url)) continue;
      seen.add(job.url);
      jobs.push(job);
    }
  }
  return jobs;
}

/** { '2027': 3, unstated: 1 } — the per-term histogram each scraper logs. */
export const termTally = (jobs) => jobs.reduce((acc, j) => ({ ...acc, [j.term]: (acc[j.term] || 0) + 1 }), {});
