import test from 'node:test';
import assert from 'node:assert/strict';

import { matchCity } from '../src/scrapers/github.js';

const key = (loc) => matchCity(loc)?.key ?? null;

test('specific Canadian hubs keep their own label', () => {
  assert.equal(key('Montréal, QC'), 'montreal');
  assert.equal(key('Toronto, ON'), 'toronto');
  assert.equal(key('Vancouver, BC'), 'vancouver');
  assert.equal(key('Ottawa, ON'), 'ottawa');
  assert.equal(key('Calgary, AB'), 'calgary');
});

// The whole point of the change: locations that named no hub were dropped. These are
// the real strings — Cohere tags its interns "Canada", nothing more.
test('anywhere-in-Canada is kept, not dropped', () => {
  assert.equal(key('Canada'), 'canada');
  assert.equal(key('Remote - Canada'), 'canada');
  assert.equal(key('Halifax, NS'), 'canada');
  assert.equal(key('Waterloo, Canada'), 'canada');
  assert.equal(key('Quebec City, QC'), 'canada');
  assert.equal(key('Winnipeg, Manitoba'), 'canada');
});

// The board is Canada-only: every US posting is dropped at ingest, including the
// two hubs (New York, San Francisco) that used to be targets. CANADA_ANY is now the
// sole guard, so the ", CA" case matters most — that is California, not Canada.
test('US postings are dropped, including the former NYC/SF hubs', () => {
  assert.equal(key('New York, NY'), null);
  assert.equal(key('San Francisco, CA'), null);
  assert.equal(key('Palo Alto, CA'), null);
  assert.equal(key('Austin, TX'), null);
  assert.equal(key('United States'), null);
  assert.equal(key('Remote - US'), null);
  assert.equal(key('Seattle, WA'), null);
});

// City names that exist in both countries must not drag a US posting in now that no
// US hub is tried first. These are real US cities.
test('cross-border city names need Canadian context', () => {
  assert.equal(key('Waterloo, IA'), null);
  assert.equal(key('Waterloo, NY'), null);
  assert.equal(key('Halifax, VA'), null);
  assert.equal(key('Hamilton, OH'), null);
  assert.equal(key('Waterloo, ON'), 'toronto'); // in the Toronto metro match
  assert.equal(key('Halifax, NS'), 'canada');
});

// "Ontario, California" and "London, Ontario" both exist. The bare-province token
// must be Canadian; a US city must not be dragged in by a coincidental word.
test('ambiguous names resolve on Canada context, not a bare word', () => {
  assert.equal(key('London, ON'), 'canada');       // London, Ontario — Canadian
  assert.equal(key('London, UK'), null);           // not a target at all
  assert.equal(key('Ontario, CA'), null);          // Ontario, California — US, dropped
});

test('a multi-city posting naming a hub prefers the hub over the catch-all', () => {
  assert.equal(key('Toronto, ON ; Halifax, NS'), 'toronto');
  assert.equal(key('Montréal ; Vancouver'), 'montreal'); // Montreal is higher priority
});
