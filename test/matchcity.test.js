import test from 'node:test';
import assert from 'node:assert/strict';

import { matchCity } from '../src/scrapers/github.js';

const key = (loc) => matchCity(loc)?.key ?? null;

// The board is Montreal-only. matchCity is the hard gate: null means dropped.
test('the Montreal metro resolves to montreal, in every spelling employers use', () => {
  assert.equal(key('Montréal, Quebec, Canada'), 'montreal');
  assert.equal(key('Montreal, QC, Canada'), 'montreal');
  assert.equal(key('Montreal,Quebec,Canada'), 'montreal'); // no spaces — real ATS output
  assert.equal(key('Montreal (St. Laurent)'), 'montreal');
  assert.equal(key('Montreal - 1190 av. des Canadiens-de-Montreal'), 'montreal');
});

// The regression this file exists for: "Dorval, Quebec" is on Montreal island but the
// old regex only knew montreal/laval/longueuil, so it landed in the catch-all bucket
// and a Montreal-only filter would have dropped a real Montreal job.
test('metro suburbs count as Montreal', () => {
  assert.equal(key('Dorval, Quebec'), 'montreal');
  assert.equal(key('Laval, QC, Canada'), 'montreal');
  assert.equal(key('Brossard, QC'), 'montreal');
  assert.equal(key('Pointe-Claire, Quebec'), 'montreal');
  assert.equal(key('Longueuil'), 'montreal');
  assert.equal(key('Lachine'), 'montreal');
});

// Suburb names that also exist elsewhere must not drag a foreign posting in. Nothing
// is tried before this, so a false positive puts a Washington role on a Montreal board.
test('ambiguous suburb names need Quebec context', () => {
  assert.equal(key('Kirkland, WA'), null);
  assert.equal(key('Kirkland, QC'), 'montreal');
  assert.equal(key('Verdun, France'), null);
  assert.equal(key('Verdun, Quebec'), 'montreal');
});

// Remote-in-Canada is workable from Montreal, so it is kept — but only when the
// posting is not somewhere in particular. Cohere tags its interns just "Canada".
test('remote-in-Canada is kept when no other place is named', () => {
  assert.equal(key('Canada'), 'remote');
  assert.equal(key('Remote - Canada'), 'remote');
  assert.equal(key('Remote-Canada'), 'remote');
  assert.equal(key('Canada (All hubs)'), 'remote');
  assert.equal(key('Quebec, CAN - Remote'), 'remote');
});

// "Remote" plus a province is that province's role, not a Montreal one.
test('a named place outside Montreal is dropped even when remote', () => {
  assert.equal(key('Remote - Canada - ON'), null);
  assert.equal(key('Canada - Burnaby'), null);
  assert.equal(key('Cambridge, Ontario'), null);
  assert.equal(key('Quebec, Quebec, Canada'), null); // Quebec City, not Montreal
  assert.equal(key('St Jerome, QC'), null);
});

test('the rest of Canada is dropped', () => {
  assert.equal(key('Toronto, ON, Canada'), null);
  assert.equal(key('Vancouver, British Columbia, Canada'), null);
  assert.equal(key('Ottawa'), null);
  assert.equal(key('Calgary, AB'), null);
  assert.equal(key('Halifax, NS'), null);
  assert.equal(key('CA - Esterhazy, SK'), null);
});

test('US and other foreign postings are dropped', () => {
  assert.equal(key('New York, NY'), null);
  assert.equal(key('San Francisco, CA'), null);
  assert.equal(key('Austin, TX'), null);
  assert.equal(key('Remote - US'), null);
  assert.equal(key('London, UK'), null);
});

// A bare ", NL" is Newfoundland *and* the Netherlands country code. The old
// province-abbreviation list matched it either way and put Utrecht, Amsterdam and
// Rotterdam on a Canada-only board. Requiring an explicit Canada token is the fix.
test('Dutch postings are not read as Newfoundland', () => {
  assert.equal(key('Utrecht, nl'), null);
  assert.equal(key('Amsterdam, UNAVAILABLE, NL'), null);
  assert.equal(key('Rotterdam, UNAVAILABLE, NL ; Eindhoven, UNAVAILABLE, NL'), null);
});

// A role with a Montreal office is takeable regardless of what else it lists.
test('a multi-city posting naming Montreal is filed under Montreal', () => {
  assert.equal(key('Markham, Canada ; Markham, Canada ; Montreal, Canada'), 'montreal');
  assert.equal(key('Toronto ; Montréal'), 'montreal');
  assert.equal(key(['San Francisco, CA', 'Montreal, QC']), 'montreal');
});

test('an empty or missing location is dropped', () => {
  assert.equal(key(''), null);
  assert.equal(key([]), null);
  assert.equal(key(null), null);
});
