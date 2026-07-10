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

// A US posting must never be mistaken for Canadian, or the board fills with roles
// that need a visa. This is the guard the CANADA_ANY regex has to hold.
test('US postings are unaffected — hubs kept, the rest still dropped', () => {
  assert.equal(key('New York, NY'), 'nyc');
  assert.equal(key('San Francisco, CA'), 'sf');
  assert.equal(key('Austin, TX'), null);
  assert.equal(key('United States'), null);
  assert.equal(key('Remote - US'), null);
  assert.equal(key('Seattle, WA'), null);
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
