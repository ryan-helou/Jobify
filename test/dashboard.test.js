import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { STATUS_META, TERMINAL_STATUSES, STATUS_RETRY_DAYS, DEFAULT_RETRY_DAYS, CITIES } from '../src/config.js';

// docs/index.html is a single self-contained file — it is served straight to the
// browser by scripts/serve-hosted.js and copied verbatim into the Pages artifact —
// so it cannot import from src/. It instead carries a copy of the status vocabulary
// as JSON, and these tests are what keep that copy honest.
//
// The failure this prevents is quiet and bad: add a status to config.js, forget the
// dashboard, and every job with that status renders under a raw snake_case label
// with a 30-day expiry the runner never actually uses.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');

function dashboardVocabulary() {
  const m = HTML.match(/<script type="application\/json" id="ledger-vocabulary">([\s\S]*?)<\/script>/);
  assert.ok(m, 'docs/index.html must embed a #ledger-vocabulary JSON block');
  return JSON.parse(m[1]);
}

test('the dashboard knows every status the runner can write', () => {
  const vocab = dashboardVocabulary();
  assert.deepEqual(Object.keys(vocab.statuses).sort(), Object.keys(STATUS_META).sort());
});

test('status labels and kinds agree with config.js', () => {
  const vocab = dashboardVocabulary();
  for (const [status, { label, kind }] of Object.entries(STATUS_META)) {
    assert.equal(vocab.statuses[status].label, label, `${status} label`);
    assert.equal(vocab.statuses[status].kind, kind, `${status} kind`);
  }
});

test('every status explains itself to the reader', () => {
  const vocab = dashboardVocabulary();
  for (const [status, { blurb }] of Object.entries(vocab.statuses)) {
    assert.ok(blurb && blurb.length > 20, `${status} needs a blurb explaining what happened`);
  }
});

// The accent colour is reserved for "a human has to do something". If a second
// status ever claims it, the signal stops meaning anything.
test('only manual_review is painted as needing a human', () => {
  const vocab = dashboardVocabulary();
  const attention = Object.entries(vocab.statuses).filter(([, m]) => m.kind === 'attention');
  assert.deepEqual(attention.map(([s]) => s), ['manual_review']);
});

test('the dashboard computes verdict expiry from the same numbers as the tracker', () => {
  const vocab = dashboardVocabulary();
  assert.deepEqual(vocab.retryDays, STATUS_RETRY_DAYS);
  assert.equal(vocab.defaultRetryDays, DEFAULT_RETRY_DAYS);
  assert.deepEqual([...vocab.terminalStatuses].sort(), [...TERMINAL_STATUSES].sort());
});

test('a terminal status never carries a retry window', () => {
  const vocab = dashboardVocabulary();
  for (const status of vocab.terminalStatuses) {
    assert.ok(!(status in vocab.retryDays), `${status} is permanent and must not expire`);
  }
});

test('the dashboard names every city the scrapers target', () => {
  const vocab = dashboardVocabulary();
  assert.deepEqual(Object.keys(vocab.cities).sort(), CITIES.map((c) => c.key).sort());
});
