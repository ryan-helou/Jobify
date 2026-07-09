// Shared plumbing for the ATS scrapers. Both enumerate ~1500 public, unauthenticated
// company endpoints per run, so they stay polite: bounded concurrency, hard timeouts,
// and no retries — a board that fails is simply skipped this run.

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

export async function getJson(url, init = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), ...init });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function postJson(url, body) {
  return getJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
}
