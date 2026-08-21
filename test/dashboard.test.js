import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TERM_VALUES, SPONSORSHIP_VALUES, CITIES, REMOTE_FALLBACK } from '../src/config.js';
import { classifyTerm } from '../src/term.js';
import { sponsorshipOf } from '../src/board.js';

// docs/index.html is a single self-contained file — served straight to the browser by
// scripts/serve-hosted.js — so it cannot import from src/. It instead embeds a copy of
// the vocabularies the pipeline writes, and these tests are what keep that copy honest.
//
// The failure this prevents is quiet and bad: add a term or sponsorship value in
// config.js, forget the dashboard, and every posting carrying it renders under a raw
// slug in a column the reader cannot interpret.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');

function vocabulary() {
  const m = HTML.match(/<script type="application\/json" id="board-vocabulary">([\s\S]*?)<\/script>/);
  assert.ok(m, 'docs/index.html must embed a #board-vocabulary JSON block');
  return JSON.parse(m[1]);
}

test('the dashboard knows every hiring term the classifier can produce', () => {
  assert.deepEqual(Object.keys(vocabulary().terms).sort(), [...TERM_VALUES].sort());
});

test('the dashboard knows every sponsorship value the board can write', () => {
  assert.deepEqual(Object.keys(vocabulary().sponsorship).sort(), [...SPONSORSHIP_VALUES].sort());
});

// TERM_VALUES is a hand-maintained list; these are the values the code really emits.
test('TERM_VALUES covers what classifyTerm actually returns', () => {
  const produced = new Set([
    classifyTerm('Software Engineer Intern, Summer 2027'),
    classifyTerm('Software Engineer Winter Co-Op 2026'),
    classifyTerm('Software Engineer Intern'),
  ]);
  for (const t of produced) assert.ok(TERM_VALUES.includes(t), `classifyTerm returned "${t}", absent from TERM_VALUES`);
});

test('SPONSORSHIP_VALUES covers what sponsorshipOf actually returns', () => {
  const produced = new Set([
    sponsorshipOf({ country: 'CA' }, ''),
    sponsorshipOf({ country: 'US' }, 'We offer visa sponsorship.'),
    sponsorshipOf({ country: 'US' }, 'We cannot sponsor.'),
    sponsorshipOf({ country: 'US' }, 'Write Go.'),
  ]);
  for (const s of produced) {
    assert.ok(SPONSORSHIP_VALUES.includes(s), `sponsorshipOf returned "${s}", absent from SPONSORSHIP_VALUES`);
  }
});

test('every city the scrapers target has a display label', () => {
  const labels = vocabulary().cities;
  for (const city of CITIES) assert.ok(labels[city.key], `no dashboard label for city "${city.key}"`);
  // The remote bucket is a resolved label, not a CITIES member, but it still
  // reaches the board and needs a display name.
  assert.ok(labels[REMOTE_FALLBACK.key], `no dashboard label for the "${REMOTE_FALLBACK.key}" bucket`);
});

// A wrong colspan collapses the "no results" row and silently breaks the empty state.
test('COLSPAN matches the number of table headers', () => {
  const headers = (HTML.match(/<th\b/g) || []).length;
  assert.equal(vocabulary().columns, headers, 'board-vocabulary.columns must equal the <th> count');
});

test('the dashboard reads board.json, not the retired applier ledger', () => {
  assert.ok(HTML.includes('board.json'), 'dashboard must fetch board.json');
  assert.ok(!HTML.includes('applied_jobs.json'), 'applied_jobs.json belongs to the retired applier');
});

// Applied/dismissed state is the user's, and this page is served from a public URL
// with no authentication. It must never leave the browser on a public host — it may
// persist to the *local* dashboard server (a committed applied.json), but only when
// running on localhost, so nothing transmits from the public deploy, not even in a
// rejected request body.
test('tracking state only persists to a local server, never from a public host', () => {
  assert.ok(HTML.includes('localStorage'), 'track state should live in localStorage');
  // Persistence is gated by a localhost-only flag derived from the hostname.
  assert.ok(/const CAN_PERSIST\s*=/.test(HTML), 'a CAN_PERSIST gate must exist');
  assert.ok(/CAN_PERSIST\s*=[^;]*location\.hostname/.test(HTML), 'CAN_PERSIST must be derived from location.hostname');
  assert.ok(/CAN_PERSIST\s*=[^;]*localhost/.test(HTML), 'CAN_PERSIST must allow only localhost');
  // Every network write is behind that gate — no ungated POST anywhere.
  for (const m of HTML.matchAll(/\bfetch\([^)]*method:\s*['"]POST/gi)) {
    const preceding = HTML.slice(Math.max(0, m.index - 40), m.index);
    assert.ok(/CAN_PERSIST/.test(preceding), 'every POST must be guarded by CAN_PERSIST');
  }
});
