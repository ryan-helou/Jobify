import fs from 'node:fs';
import {
  APPLIED_JOBS_PATH,
  TERMINAL_STATUSES,
  STATUS_RETRY_DAYS,
  DEFAULT_RETRY_DAYS,
  LEDGER_EXCERPT_CHARS,
  LEDGER_HISTORY_LIMIT,
} from './config.js';

// applied_jobs.json is the dedup ledger, committed back to the repo after each run.
//
// A record blocks a job from being processed again, but only for as long as its
// verdict can be trusted. An application is permanent; everything else expires.
// See TERMINAL_STATUSES / STATUS_RETRY_DAYS in config.js for why.
//
// It is also the only thing the dashboard reads, so a record carries the evidence
// behind its verdict — scores, signals, the posting excerpt, the résumé we sent,
// and the history of every verdict this posting has had — not just the verdict.

const DAY_MS = 86_400_000;

// When `record`'s verdict stops speaking for the posting, as a timestamp. Null
// when it never will (a submission) or when the record can't say (an unparseable
// timestamp) — the caller decides what each of those means.
export function expiresAt(record) {
  if (!record || TERMINAL_STATUSES.has(record.status)) return null;
  const recordedAt = Date.parse(record.recordedAt);
  if (Number.isNaN(recordedAt)) return null;
  const days = STATUS_RETRY_DAYS[record.status] ?? DEFAULT_RETRY_DAYS;
  return recordedAt + days * DAY_MS;
}

// True while `record` still speaks for the posting. Unparseable or missing
// timestamps are treated as expired: better to re-examine a job than to lose it to
// a corrupt row.
export function isBlocking(record, now = Date.now()) {
  if (!record) return false;
  if (TERMINAL_STATUSES.has(record.status)) return true;
  const expiry = expiresAt(record);
  return expiry != null && now < expiry;
}

export function canonicalKey(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('utm_source');
    u.searchParams.delete('utm_medium');
    u.searchParams.delete('utm_campaign');
    u.hash = '';
    return u.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

// The same posting appears on several boards under different URLs (a Greenhouse
// link on one, the company careers page on another). Company + title + city
// identifies the underlying job so we never apply to it twice.
export function identityKey(job) {
  // Strip accents and all punctuation/whitespace so boards that write the same
  // employer differently ("M-Three" / "mthree", "Ether.fi" / "etherfi",
  // "Naïve" / "Naive") still collapse to one identity.
  const norm = (s) =>
    (s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  return `${norm(job.company)}|${norm(job.title)}|${norm(job.city)}`;
}

// A readable opening of the posting, cut at a word boundary. Scraped page text
// arrives with the whitespace of its markup still in it, so collapse that first
// or the excerpt is mostly newlines.
export function excerptOf(text, max = LEDGER_EXCERPT_CHARS) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  // Only honour the word boundary if it isn't throwing away most of the excerpt —
  // a 600-character string with no spaces is a minified blob, not prose.
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

export function loadTracker() {
  let records = [];
  try {
    const data = JSON.parse(fs.readFileSync(APPLIED_JOBS_PATH, 'utf8'));
    records = Array.isArray(data.jobs) ? data.jobs : [];
  } catch {
    records = [];
  }
  // Indexed by both keys, because a posting is recognised either by its URL or by
  // the company/title/city identity it shares with the same role on another board.
  const byKey = new Map(records.map((r) => [r.key, r]));
  const byIdentity = new Map(records.map((r) => [r.identity || identityKey(r), r]));

  return {
    records,
    has(url, now = Date.now()) {
      return isBlocking(byKey.get(canonicalKey(url)), now);
    },
    hasIdentity(identity, now = Date.now()) {
      return isBlocking(byIdentity.get(identity), now);
    },
    add(job, status, details = '', { description = '', resume = null } = {}) {
      const key = canonicalKey(job.url);
      const identity = identityKey(job);
      const now = new Date().toISOString();
      const existing = byKey.get(key);

      // Facts about the posting, as read on this run. Re-read every time, because
      // a posting that came back around may have been edited since — that is the
      // entire reason non-terminal verdicts expire.
      const observed = {
        title: job.title,
        company: job.company,
        location: job.location,
        city: job.city,
        source: job.source,
        // Only when it adds something: most postings apply at their own URL.
        ...(job.applyUrl && job.applyUrl !== job.url && { applyUrl: job.applyUrl }),
        ...(job.term && { term: job.term }),
        ...(job.country && { country: job.country }),
        ...(job.sponsorship && { sponsorship: job.sponsorship }),
        // Flattened from job.scores (see src/score.js) so the dashboard can sort
        // on them directly. Absent on records written before scoring existed —
        // the dashboard renders those as "—" rather than as a zero.
        ...(job.scores && {
          compatibility: job.scores.compatibility,
          quality: job.scores.quality,
          interviewOdds: job.scores.interviewOdds,
          scoreConfidence: job.scores.confidence,
          scoreSignals: job.scores.signals,
        }),
        ...(resume && { resume }),
      };

      const excerpt = excerptOf(description || job.description);
      // Never blank an excerpt we already have: a job first read from an ATS feed
      // carries a description, and the run that later re-examines it may not.
      if (excerpt) observed.excerpt = excerpt;

      const verdict = { at: now, status, details };

      // A job we saw before and re-examined after its verdict expired. Overwrite
      // the verdict rather than skipping the write, or the record would keep its
      // original timestamp and expire again immediately on the next run.
      if (existing) {
        Object.assign(existing, observed);
        existing.status = status;
        existing.details = details;
        existing.recordedAt = now;
        existing.attempts = (existing.attempts || 1) + 1;
        // `firstSeenAt` is what `recordedAt` used to be before re-examination
        // started overwriting it. Backfill it for records written without one.
        existing.firstSeenAt ||= existing.history?.[0]?.at || now;
        existing.history = [...(existing.history || []), verdict].slice(-LEDGER_HISTORY_LIMIT);
        return;
      }

      const record = {
        key,
        identity,
        url: job.url,
        ...observed,
        status, // applied | submitted_unconfirmed | manual_review | skipped_*
        details,
        attempts: 1,
        firstSeenAt: now,
        recordedAt: now,
        history: [verdict],
      };
      byKey.set(key, record);
      byIdentity.set(identity, record);
      records.push(record);
    },
    save() {
      fs.writeFileSync(APPLIED_JOBS_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), jobs: records }, null, 2) + '\n');
    },
  };
}
