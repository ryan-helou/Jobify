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

export function loadTracker() {
  let records = [];
  try {
    const data = JSON.parse(fs.readFileSync(APPLIED_JOBS_PATH, 'utf8'));
    records = Array.isArray(data.jobs) ? data.jobs : [];
  } catch {
    records = [];
  }
  const keys = new Set(records.map((r) => r.key));
  return {
    records,
    has(url) {
      return keys.has(canonicalKey(url));
    },
    add(job, status, details = '') {
      const key = canonicalKey(job.url);
      if (keys.has(key)) return;
      keys.add(key);
      records.push({
        key,
        url: job.url,
        title: job.title,
        company: job.company,
        location: job.location,
        source: job.source,
        status, // applied | submitted_unconfirmed | manual_review | skipped_unknown_required
        details,
        recordedAt: new Date().toISOString(),
      });
    },
    save() {
      fs.writeFileSync(APPLIED_JOBS_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), jobs: records }, null, 2) + '\n');
    },
  };
}
