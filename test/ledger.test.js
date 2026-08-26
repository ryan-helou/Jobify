import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// APPLIED_JOBS_PATH is resolved when config.js is first imported, and `save()` writes
// to it. Point it at a throwaway file *before* importing anything that reads config,
// or these tests would mark real jobs as applied. `node --test` gives each file its
// own process, so this env var cannot leak into the other suites.
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jobify-ledger-'));
process.env.APPLIED_JOBS_PATH = path.join(DIR, 'applied_jobs.json');

const { loadTracker } = await import('../src/tracker.js');
const { LEDGER_HISTORY_LIMIT } = await import('../src/config.js');

const job = (over = {}) => ({
  url: 'https://boards.greenhouse.io/acme/jobs/1',
  title: 'Software Engineer Intern',
  company: 'Acme',
  location: 'Montreal, QC',
  city: 'montreal',
  source: 'ats:greenhouse',
  country: 'CA',
  term: '2027',
  ...over,
});

const only = (tracker) => {
  assert.equal(tracker.records.length, 1);
  return tracker.records[0];
};

test('a new record carries the evidence behind its verdict, not just the verdict', () => {
  const t = loadTracker();
  t.add(
    job({
      applyUrl: 'https://boards.greenhouse.io/acme/jobs/1/apply',
      description: 'We use React and TypeScript. You will ship real code.',
      scores: { chance: 82, quality: 71, confidence: 'high', signals: { fit: 91, difficulty: 22, family: 'frontend' } },
    }),
    'applied',
    'submitted',
    { resume: { variant: 'frontend', reason: 'title says frontend' } }
  );

  const r = only(t);
  assert.equal(r.status, 'applied');
  assert.equal(r.term, '2027');
  assert.equal(r.country, 'CA');
  assert.equal(r.applyUrl, 'https://boards.greenhouse.io/acme/jobs/1/apply');
  assert.equal(r.chance, 82);
  assert.equal(r.scoreConfidence, 'high');
  assert.deepEqual(r.resume, { variant: 'frontend', reason: 'title says frontend' });
  assert.match(r.excerpt, /^We use React/);
  assert.equal(r.attempts, 1);
  assert.equal(r.firstSeenAt, r.recordedAt);
  assert.deepEqual(r.history.map((h) => h.status), ['applied']);
});

// Most postings apply at their own URL. Storing a duplicate would put a redundant
// "Apply form" row in the dashboard's record panel on every single job.
test('applyUrl is stored only when it differs from the posting URL', () => {
  const t = loadTracker();
  t.add(job({ applyUrl: 'https://boards.greenhouse.io/acme/jobs/1' }), 'manual_review', 'x');
  assert.ok(!('applyUrl' in only(t)));
});

test('re-examining a posting appends to its history and keeps the first sighting', async () => {
  const t = loadTracker();
  t.add(job(), 'manual_review', 'hiring term not stated in posting');
  const firstSeen = only(t).firstSeenAt;

  await new Promise((r) => setTimeout(r, 5)); // distinct ISO timestamps
  t.add(job({ scores: { chance: 90, quality: 60, confidence: 'high', signals: {} } }), 'applied', 'submitted');

  const r = only(t);
  assert.equal(r.status, 'applied', 'the fresh verdict wins');
  assert.equal(r.attempts, 2);
  assert.equal(r.firstSeenAt, firstSeen, 'firstSeenAt survives re-examination');
  assert.notEqual(r.recordedAt, firstSeen, 'recordedAt moves to the new decision');
  assert.deepEqual(r.history.map((h) => h.status), ['manual_review', 'applied']);
  assert.equal(r.chance, 90, 're-scoring on the second read replaces the weaker guess');
});

test('history is bounded — a posting seen forever does not grow the ledger forever', () => {
  const t = loadTracker();
  for (let i = 0; i < LEDGER_HISTORY_LIMIT + 5; i++) t.add(job(), 'manual_review', `read ${i}`);

  const r = only(t);
  assert.equal(r.history.length, LEDGER_HISTORY_LIMIT);
  assert.equal(r.attempts, LEDGER_HISTORY_LIMIT + 5, 'attempts still counts every read');
  assert.equal(r.history.at(-1).details, `read ${LEDGER_HISTORY_LIMIT + 4}`, 'the newest verdict is kept');
});

// A job first read from an ATS feed arrives with a description. The run that later
// re-examines it may not have one, and must not erase the only surviving copy of
// what the posting said — the URL 404s once the role is filled.
test('a later read without a description keeps the excerpt already recorded', () => {
  const t = loadTracker();
  t.add(job({ description: 'Ship production Rust.' }), 'manual_review', 'first');
  t.add(job({ description: '' }), 'skipped_closed', 'second');

  assert.equal(only(t).excerpt, 'Ship production Rust.');
});

test('backfills firstSeenAt on a record written before the field existed', () => {
  const legacy = {
    updatedAt: null,
    jobs: [{ key: 'https://boards.greenhouse.io/acme/jobs/1', identity: 'acme|softwareengineerintern|montreal', url: 'https://boards.greenhouse.io/acme/jobs/1', status: 'manual_review', recordedAt: '2026-01-01T00:00:00.000Z', attempts: 1 }],
  };
  fs.writeFileSync(process.env.APPLIED_JOBS_PATH, JSON.stringify(legacy));

  const t = loadTracker();
  t.add(job(), 'applied', 'submitted');
  const r = only(t);
  assert.ok(r.firstSeenAt, 'a record with no history still gets a first sighting');
  assert.deepEqual(r.history.map((h) => h.status), ['applied']);

  fs.rmSync(process.env.APPLIED_JOBS_PATH);
});

test('save writes the ledger it loaded, and loads back identically', () => {
  const t = loadTracker();
  t.add(job(), 'applied', 'submitted');
  t.save();

  const written = JSON.parse(fs.readFileSync(process.env.APPLIED_JOBS_PATH, 'utf8'));
  assert.ok(written.updatedAt);
  assert.equal(written.jobs.length, 1);
  assert.equal(loadTracker().records[0].status, 'applied');

  fs.rmSync(process.env.APPLIED_JOBS_PATH);
});
