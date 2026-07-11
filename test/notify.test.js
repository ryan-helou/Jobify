import test from 'node:test';
import assert from 'node:assert/strict';

import { formatNewPostings } from '../src/notify.js';

const job = (over = {}) => ({
  title: 'SWE Intern', company: 'Acme', city: 'toronto', term: 'unstated',
  compatibility: 80, applyUrl: 'https://x.com/1', ...over,
});

test('stays silent when nothing clears the fit bar — the anti-spam rule', () => {
  const weak = [job({ compatibility: 40 }), job({ compatibility: 55 })];
  assert.equal(formatNewPostings(weak, { total: 100, minFit: 65 }), null);
});

test('stays silent for wrong-cycle postings even at high fit', () => {
  assert.equal(formatNewPostings([job({ compatibility: 90, term: 'other-cycle' })], { total: 100 }), null);
});

test('announces only the postings above the bar, best fit first', () => {
  const msg = formatNewPostings(
    [job({ compatibility: 55 }), job({ compatibility: 88, title: 'A' }), job({ compatibility: 70, title: 'B' })],
    { total: 200, minFit: 65 }
  );
  assert.equal(msg.count, 2, 'the fit-55 posting is excluded from the count');
  // A (88) leads B (70).
  assert.ok(msg.telegram.indexOf('>A<') < msg.telegram.indexOf('>B<'));
  assert.match(msg.telegram, /2 new roles worth a look/);
});

test('caps the list and reports the remainder', () => {
  const many = Array.from({ length: 10 }, (_, i) => job({ compatibility: 90 - i, title: `Role${i}` }));
  const msg = formatNewPostings(many, { total: 300, minFit: 65, limit: 6 });
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
  const msg = formatNewPostings([job({ title: 'C++ <Systems> Intern', compatibility: 80 })], { total: 1 });
  assert.match(msg.telegram, /C\+\+ &lt;Systems&gt; Intern/);
});
