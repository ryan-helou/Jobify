import test from 'node:test';
import assert from 'node:assert/strict';

import { isBlocking, canonicalKey, identityKey, excerptOf, expiresAt } from '../src/tracker.js';
import { STATUS_RETRY_DAYS } from '../src/config.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-07-09T12:00:00Z');
const agedDays = (status, days) => ({
  status,
  recordedAt: new Date(NOW - days * DAY).toISOString(),
});

test('an application is permanent — never re-applied to', () => {
  for (const status of ['applied', 'submitted_unconfirmed']) {
    assert.equal(isBlocking(agedDays(status, 0), NOW), true);
    assert.equal(isBlocking(agedDays(status, 3650), NOW), true, `${status} must never expire`);
  }
});

test('a non-terminal verdict blocks only until it expires', () => {
  for (const [status, days] of Object.entries(STATUS_RETRY_DAYS)) {
    assert.equal(isBlocking(agedDays(status, days - 1), NOW), true, `${status} should still block at ${days - 1}d`);
    assert.equal(isBlocking(agedDays(status, days + 1), NOW), false, `${status} should expire after ${days}d`);
  }
});

test('the 122 unstated postings come back after two weeks, not never', () => {
  const flagged = agedDays('manual_review', 13);
  assert.equal(isBlocking(flagged, NOW), true, 'still blocked on day 13');
  assert.equal(isBlocking(agedDays('manual_review', 15), NOW), false, 'reconsidered on day 15');
});

test('a posting we skipped for no sponsorship is reconsidered after 30 days', () => {
  assert.equal(isBlocking(agedDays('skipped_no_sponsorship', 29), NOW), true);
  assert.equal(isBlocking(agedDays('skipped_no_sponsorship', 31), NOW), false);
});

test('unknown status falls back to the default TTL rather than blocking forever', () => {
  assert.equal(isBlocking(agedDays('some_future_status', 1), NOW), true);
  assert.equal(isBlocking(agedDays('some_future_status', 400), NOW), false);
});

test('a corrupt or missing timestamp re-examines the job rather than losing it', () => {
  assert.equal(isBlocking({ status: 'manual_review', recordedAt: 'not-a-date' }, NOW), false);
  assert.equal(isBlocking({ status: 'manual_review' }, NOW), false);
  // ...but a terminal status stands even without a usable timestamp.
  assert.equal(isBlocking({ status: 'applied', recordedAt: 'nonsense' }, NOW), true);
});

test('no record means nothing blocks', () => {
  assert.equal(isBlocking(undefined, NOW), false);
  assert.equal(isBlocking(null, NOW), false);
});

test('canonicalKey ignores tracking params, trailing slash and case', () => {
  assert.equal(
    canonicalKey('https://Example.com/jobs/1/?utm_source=x&utm_campaign=y#apply'),
    canonicalKey('https://example.com/jobs/1')
  );
});

test('identityKey collapses punctuation and accents so one role is one job', () => {
  assert.equal(
    identityKey({ company: 'Naïve', title: 'SWE Intern', city: 'sf' }),
    identityKey({ company: 'Naive', title: 'S.W.E. Intern!', city: 'sf' })
  );
});

// The dashboard recomputes expiry client-side to draw the "verdict holds" bar, so
// this is the number both sides have to agree on.
test('expiresAt is the decision time plus the status TTL', () => {
  const recordedAt = new Date(NOW).toISOString();
  assert.equal(expiresAt({ status: 'manual_review', recordedAt }), NOW + 14 * DAY);
  assert.equal(expiresAt({ status: 'skipped_wrong_term', recordedAt }), NOW + 90 * DAY);
});

test('a permanent verdict has no expiry at all, rather than one far in the future', () => {
  assert.equal(expiresAt({ status: 'applied', recordedAt: new Date(NOW).toISOString() }), null);
  assert.equal(expiresAt({ status: 'manual_review', recordedAt: 'not-a-date' }), null);
  assert.equal(expiresAt(null), null);
});

test('excerptOf collapses scraped whitespace and cuts on a word boundary', () => {
  assert.equal(excerptOf('  Build\n\n  real   things.\t'), 'Build real things.');
  assert.equal(excerptOf('', 10), '');
  assert.equal(excerptOf(null), '');

  const cut = excerptOf('alpha bravo charlie delta echo', 12);
  assert.equal(cut, 'alpha bravo…', 'cuts at the space, not mid-word');
});

test('excerptOf truncates a spaceless blob rather than returning almost nothing', () => {
  // A minified page dump has no word boundary to honour. Cutting at the last space
  // would throw away the whole excerpt, so the hard cut wins.
  const blob = 'x'.repeat(50) + ' ' + 'y'.repeat(50);
  assert.equal(excerptOf(blob, 40), 'x'.repeat(40) + '…');
});
