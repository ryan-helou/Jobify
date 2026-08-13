import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// BOARD_PATH is resolved when config.js is first imported, so point it at a throwaway
// file *before* importing anything that reads config — otherwise loadBoard would read
// (and these tests would reason about) the real board. `node --test` gives each file
// its own process, so this env var cannot leak into the other suites.
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jobify-board-'));
process.env.BOARD_PATH = path.join(DIR, 'board.json');

const { loadBoard } = await import('../src/board.js');

const write = (jobs) => fs.writeFileSync(process.env.BOARD_PATH, JSON.stringify({ updatedAt: 'x', jobs }));

// The regression this guards: the board is a catalogue that mergeBoard only ever adds
// to, so US postings scraped before the Canada-only change survived every refresh and
// kept getting re-announced. Dropping them on read makes the rule retroactive.
test('loadBoard drops postings outside Canada', () => {
  write([
    { url: 'https://a.com/1', title: 'SWE Intern', city: 'toronto', country: 'CA' },
    { url: 'https://a.com/2', title: 'SWE Intern', city: 'nyc', country: 'US' },
    { url: 'https://a.com/3', title: 'SWE Intern', city: 'sf', country: 'US' },
    { url: 'https://a.com/4', title: 'SWE Intern', city: 'canada', country: 'CA' },
  ]);
  const board = loadBoard();
  assert.equal(board.length, 2);
  assert.deepEqual(board.map((r) => r.city), ['toronto', 'canada']);
});

// A row with no country is not provably Canadian, and on a Canada-only board an
// unverifiable row is exactly what should not be announced.
test('loadBoard drops rows with a missing or empty country', () => {
  write([
    { url: 'https://a.com/1', city: 'toronto', country: 'CA' },
    { url: 'https://a.com/2', city: 'toronto', country: '' },
    { url: 'https://a.com/3', city: 'toronto' },
  ]);
  assert.equal(loadBoard().length, 1);
});

test('loadBoard survives a missing or malformed board file', () => {
  fs.rmSync(process.env.BOARD_PATH, { force: true });
  assert.deepEqual(loadBoard(), []);
  fs.writeFileSync(process.env.BOARD_PATH, 'not json');
  assert.deepEqual(loadBoard(), []);
  fs.writeFileSync(process.env.BOARD_PATH, JSON.stringify({ updatedAt: 'x' }));
  assert.deepEqual(loadBoard(), []);
});
