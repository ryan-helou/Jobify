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
// to, so rows scraped before a narrowing of the target cities survived every refresh
// and kept getting re-announced. Dropping them on read makes the change retroactive.
// It has mattered twice — once dropping the US, once narrowing Canada to Montreal.
//
// Because it keys off ALLOWED_CITY_KEYS rather than naming a country, it also did the
// right thing without being touched when New York was ADDED on 2026-08-26: `nyc` is a
// CITIES key, so those rows now pass. That is the point of deriving the set.
test('loadBoard keeps only the allowed city keys', () => {
  write([
    { url: 'https://a.com/1', title: 'SWE Intern', city: 'montreal', country: 'CA' },
    { url: 'https://a.com/2', title: 'SWE Intern', city: 'toronto', country: 'CA' },
    { url: 'https://a.com/3', title: 'SWE Intern', city: 'canada', country: 'CA' },
    { url: 'https://a.com/4', title: 'SWE Intern', city: 'nyc', country: 'US' },
    { url: 'https://a.com/5', title: 'SWE Intern', city: 'remote', country: 'CA' },
    { url: 'https://a.com/6', title: 'SWE Intern', city: 'sf', country: 'US' },
  ]);
  const board = loadBoard();
  assert.deepEqual(board.map((r) => r.city), ['montreal', 'nyc', 'remote']);
});

// The retired 'canada' catch-all is specifically worth pinning: it used to mean
// "anywhere in Canada" and now means nothing, so a stored row carrying it is stale.
test('loadBoard drops rows with a missing, empty or retired city', () => {
  write([
    { url: 'https://a.com/1', city: 'montreal', country: 'CA' },
    { url: 'https://a.com/2', city: 'canada', country: 'CA' },
    { url: 'https://a.com/3', city: '', country: 'CA' },
    { url: 'https://a.com/4', country: 'CA' },
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
