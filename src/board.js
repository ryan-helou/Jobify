import fs from 'node:fs';
import { BOARD_PATH, LEDGER_EXCERPT_CHARS } from './config.js';
import { canonicalKey, identityKey, excerptOf } from './tracker.js';
import { feedSponsorshipVerdict, sponsorshipStance } from './visa.js';

// board.json is a catalogue of every posting we have ever seen, not a log of what we
// applied to. That difference is the whole point of this file.
//
// The old applied_jobs.json was a *ledger*: a record existed to stop a job being
// processed twice, so anything the pipeline declined to apply to — wrong term, no
// sponsorship, a platform we couldn't drive — was either recorded as a dead end or
// never written at all. The dashboard could therefore only ever show the postings the
// robot had opinions about, which was 94 of 239. A human applying by hand wants the
// other 145 too, and wants to make the wrong-term and sponsorship calls themselves.
//
// So: nothing is ever excluded, nothing is terminal, and every attribute the pipeline
// used to gate on is stored as a field to filter by instead.

const PLATFORMS = [
  [/(^|\.)greenhouse\.io$/i, 'greenhouse'],
  [/(^|\.)ashbyhq\.com$/i, 'ashby'],
  [/(^|\.)lever\.co$/i, 'lever'],
  [/(^|\.)myworkdayjobs\.com$|(^|\.)myworkdaysite\.com$/i, 'workday'],
  [/(^|\.)oraclecloud\.com$/i, 'oracle'],
  [/(^|\.)smartrecruiters\.com$/i, 'smartrecruiters'],
  [/(^|\.)workable\.com$/i, 'workable'],
  [/(^|\.)recruitee\.com$/i, 'recruitee'],
  [/(^|\.)bamboohr\.com$/i, 'bamboohr'],
  [/(^|\.)icims\.com$/i, 'icims'],
  [/(^|\.)eightfold\.ai$/i, 'eightfold'],
  [/(^|\.)personio\.(?:de|com)$/i, 'personio'],
  [/(^|\.)themuse\.com$/i, 'themuse'],
  [/(^|\.)jobbank\.gc\.ca$/i, 'jobbank'],
  [/(^|\.)adzuna\.[a-z.]+$/i, 'adzuna'],
  [/(^|\.)workatastartup\.com$/i, 'workatastartup'],
  [/(^|\.)ycombinator\.com$/i, 'ycombinator'],
  [/(^|\.)indeed\.com$/i, 'indeed'],
  [/(^|\.)applytojob\.com$/i, 'applytojob'],
];

/** Where a human would actually click Apply. 'other' is the company's own portal. */
export function platformOf(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return 'unknown';
  }
  for (const [re, name] of PLATFORMS) if (re.test(host)) return name;
  return 'other';
}

/**
 * 'offers' | 'denies' | 'silent' | 'n/a'.
 *
 * Canadian postings get 'n/a' rather than 'silent': the question does not arise, and
 * lumping them together would make the filter useless for the postings that matter.
 */
export function sponsorshipOf(job, description) {
  if (job.country !== 'US') return 'n/a';
  const verdict = feedSponsorshipVerdict(job);
  if (verdict !== 'unknown') return verdict;
  return sponsorshipStance(description || job.description || '');
}

/** A board row. Pure: same posting in, same row out. */
export function rowFor(job, now) {
  const description = job.description || '';
  const s = job.scores || {};
  return {
    url: job.url,
    applyUrl: job.applyUrl || job.url,
    title: job.title,
    company: job.company,
    location: job.location || '',
    city: job.city || '',
    country: job.country || '',
    source: job.source || '',
    platform: platformOf(job.applyUrl || job.url),
    term: job.term || 'unstated',
    sponsorship: sponsorshipOf(job, description),
    pay: s.signals?.pay || null,
    compatibility: s.compatibility ?? null,
    quality: s.quality ?? null,
    interviewOdds: s.interviewOdds ?? null,
    scoreConfidence: s.confidence || null,
    scoreSignals: s.signals || null,
    excerpt: excerptOf(description, LEDGER_EXCERPT_CHARS),
    firstSeenAt: now,
    lastSeenAt: now,
  };
}

/**
 * Merge this run's postings into the stored board.
 *
 * Scores are recomputed every run and overwrite the stored ones — the scoring model
 * changes, and a board showing last week's opinion of a posting is worse than useless.
 * `firstSeenAt` is preserved, because "this has been open for three weeks" is a real
 * signal and the only one on this board that a re-scrape cannot reconstruct.
 */
export function mergeBoard(existing, jobs, now = new Date().toISOString()) {
  const byUrl = new Map(existing.map((r) => [canonicalKey(r.url), r]));
  const byIdentity = new Map(existing.map((r) => [identityKey(r), r]));

  for (const job of jobs) {
    const row = rowFor(job, now);
    const prior = byUrl.get(canonicalKey(row.url)) || byIdentity.get(identityKey(row));
    if (prior) {
      Object.assign(prior, row, { firstSeenAt: prior.firstSeenAt || row.firstSeenAt });
      continue;
    }
    byUrl.set(canonicalKey(row.url), row);
    byIdentity.set(identityKey(row), row);
    existing.push(row);
  }
  return existing;
}

export function loadBoard() {
  try {
    const data = JSON.parse(fs.readFileSync(BOARD_PATH, 'utf8'));
    return Array.isArray(data.jobs) ? data.jobs : [];
  } catch {
    return [];
  }
}

export function saveBoard(jobs, now = new Date().toISOString()) {
  const sorted = [...jobs].sort((a, b) => (b.compatibility ?? -1) - (a.compatibility ?? -1));
  fs.writeFileSync(BOARD_PATH, JSON.stringify({ updatedAt: now, jobs: sorted }, null, 2) + '\n');
  return sorted.length;
}
