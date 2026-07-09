import fs from 'node:fs';
import { APPLIED_JOBS_PATH } from './config.js';

// applied_jobs.json is the dedup ledger, committed back to the repo after each run.
// Every job we've applied to, attempted, or flagged for manual review gets a record
// so it is never touched again on later runs.

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
  const keys = new Set(records.map((r) => r.key));
  const identities = new Set(records.map((r) => r.identity || identityKey(r)));
  return {
    records,
    has(url) {
      return keys.has(canonicalKey(url));
    },
    hasIdentity(identity) {
      return identities.has(identity);
    },
    add(job, status, details = '') {
      const key = canonicalKey(job.url);
      if (keys.has(key)) return;
      keys.add(key);
      identities.add(identityKey(job));
      records.push({
        key,
        identity: identityKey(job),
        url: job.url,
        title: job.title,
        company: job.company,
        location: job.location,
        city: job.city,
        source: job.source,
        status, // applied | submitted_unconfirmed | manual_review | skipped_unknown_required
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
        recordedAt: new Date().toISOString(),
      });
    },
    save() {
      fs.writeFileSync(APPLIED_JOBS_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), jobs: records }, null, 2) + '\n');
    },
  };
}
