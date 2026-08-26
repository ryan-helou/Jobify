import test from 'node:test';
import assert from 'node:assert/strict';

import { formatNewPostings } from '../src/notify.js';

const job = (over = {}) => ({
  title: 'SWE Intern', company: 'Acme', city: 'toronto', term: 'unstated',
  chance: 80, applyUrl: 'https://x.com/1', ...over,
});

test('stays silent when nothing clears the chance bar — the anti-spam rule', () => {
  const weak = [job({ chance: 40 }), job({ chance: 55 })];
  assert.equal(formatNewPostings(weak, { total: 100, minChance: 65 }), null);
});

test('stays silent for wrong-cycle postings even at high chance', () => {
  assert.equal(formatNewPostings([job({ chance: 90, term: 'other-cycle' })], { total: 100 }), null);
});

test('announces only the postings above the bar, best chance first', () => {
  const msg = formatNewPostings(
    [job({ chance: 55 }), job({ chance: 88, title: 'A' }), job({ chance: 70, title: 'B' })],
    { total: 200, minChance: 65 }
  );
  assert.equal(msg.count, 2, 'the chance-55 posting is excluded from the count');
  // A (88) leads B (70).
  assert.ok(msg.telegram.indexOf('>A<') < msg.telegram.indexOf('>B<'));
  assert.match(msg.telegram, /2 new roles worth a look/);
});

test('caps the list and reports the remainder', () => {
  const many = Array.from({ length: 10 }, (_, i) => job({ chance: 90 - i, title: `Role${i}` }));
  const msg = formatNewPostings(many, { total: 300, minChance: 65, limit: 6 });
  assert.equal(msg.count, 10);
  assert.match(msg.telegram, /\+4 more/);
  assert.equal((msg.telegram.match(/<a href/g) || []).length, 6, 'only 6 links listed');
});

test('adds an Open board link only when a dashboard URL is set', () => {
  const withUrl = formatNewPostings([job()], { total: 1, dashboardUrl: 'https://board.example' });
  assert.match(withUrl.telegram, /Open board →/);
  const without = formatNewPostings([job()], { total: 1, dashboardUrl: '' });
  assert.doesNotMatch(without.telegram, /Open board/);
});

test('escapes HTML in titles so a stray < cannot break the message', () => {
  const msg = formatNewPostings([job({ title: 'C++ <Systems> Intern', chance: 80 })], { total: 1 });
  assert.match(msg.telegram, /C\+\+ &lt;Systems&gt; Intern/);
});

test('each role carries location, quality, term and visa on a second line', () => {
  const us = formatNewPostings([{ title: 'SWE Intern', company: 'Acme', city: 'nyc', location: 'New York, NY', country: 'US', term: '2027', sponsorship: 'silent', chance: 82, quality: 71, applyUrl: 'https://x/1' }], { total: 1 });
  assert.match(us.telegram, /New York, NY · quality 71 · Summer 2027 · sponsorship not stated/);

  const usSponsors = formatNewPostings([{ title: 'X', company: 'B', city: 'nyc', location: 'Brooklyn, NY', country: 'US', term: 'unstated', sponsorship: 'offers', chance: 80, quality: 60, applyUrl: 'https://x/2' }], { total: 1 });
  assert.match(usSponsors.telegram, /term not stated · sponsors visa/);

  // A Canadian posting says nothing about visas rather than repeating "no visa
  // needed" on every line — it is only worth the characters where it can bite.
  const ca = formatNewPostings([{ title: 'Co-op', company: 'C', city: 'remote', location: 'Remote - Canada', country: 'CA', term: 'unstated', sponsorship: 'n/a', chance: 78, quality: 64, applyUrl: 'https://x/3' }], { total: 1 });
  assert.match(ca.telegram, /Remote - Canada · quality 64 · term not stated/);
  assert.doesNotMatch(ca.telegram, /visa/);
});
