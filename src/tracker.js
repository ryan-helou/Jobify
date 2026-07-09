import fs from 'node:fs';
import { APPLIED_JOBS_PATH, TERMINAL_STATUSES, STATUS_RETRY_DAYS, DEFAULT_RETRY_DAYS } from './config.js';

// applied_jobs.json is the dedup ledger, committed back to the repo after each run.
//
// A record blocks a job from being processed again, but only for as long as its
// verdict can be trusted. An application is permanent; everything else expires.
// See TERMINAL_STATUSES / STATUS_RETRY_DAYS in config.js for why.

const DAY_MS = 86_400_000;

// True while `record` still speaks for the posting. Unparseable or missing
// timestamps are treated as expired: better to re-examine a job than to lose it to
// a corrupt row.
export function isBlocking(record, now = Date.now()) {
  if (!record) return false;
  if (TERMINAL_STATUSES.has(record.status)) return true;

  const recordedAt = Date.parse(record.recordedAt);
  if (Number.isNaN(recordedAt)) return false;

  const days = STATUS_RETRY_DAYS[record.status] ?? DEFAULT_RETRY_DAYS;
  return now - recordedAt < days * DAY_MS;
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
    add(job, status, details = '') {
      const key = canonicalKey(job.url);
      const identity = identityKey(job);
      const existing = byKey.get(key);

      // A job we saw before and re-examined after its verdict expired. Overwrite
      // the verdict rather than skipping the write, or the record would keep its
      // original timestamp and expire again immediately on the next run.
      if (existing) {
        existing.status = status;
        existing.details = details;
        existing.recordedAt = new Date().toISOString();
        existing.attempts = (existing.attempts || 1) + 1;
        return;
      }

      const record = {
        key,
        identity,
        url: job.url,
        title: job.title,
        company: job.company,
        location: job.location,
        city: job.city,
        source: job.source,
        status, // applied | submitted_unconfirmed | manual_review | skipped_*
        details,
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
        attempts: 1,
        recordedAt: new Date().toISOString(),
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
