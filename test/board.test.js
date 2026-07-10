import test from 'node:test';
import assert from 'node:assert/strict';

import { platformOf, sponsorshipOf, rowFor, mergeBoard } from '../src/board.js';

test('platformOf names where a human would click Apply', () => {
  assert.equal(platformOf('https://job-boards.greenhouse.io/cresta/jobs/4123841008'), 'greenhouse');
  assert.equal(platformOf('https://jobs.ashbyhq.com/super.com/6a0dc25b'), 'ashby');
  assert.equal(platformOf('https://jobs.lever.co/zoox/22bece12'), 'lever');
  assert.equal(platformOf('https://bmo.wd3.myworkdayjobs.com/Campus/job/x'), 'workday');
  assert.equal(platformOf('https://wd1.myworkdaysite.com/recruiting/upenn/Wharton/job/x'), 'workday');
  assert.equal(platformOf('https://ejov.fa.ca2.oraclecloud.com/hcmUI/x'), 'oracle');
  assert.equal(platformOf('https://jobs.smartrecruiters.com/AGTechnologies1/x'), 'smartrecruiters');
  assert.equal(platformOf('https://www.workatastartup.com/jobs/94211'), 'workatastartup');
  assert.equal(platformOf('https://www.janestreet.com/join-jane-street/position/1'), 'other');
  assert.equal(platformOf('not a url'), 'unknown');
});

// 'silent' and 'n/a' must not collapse together: the filter exists precisely to find
// the US postings that never said, which is most of them.
test('sponsorshipOf distinguishes silence, refusal, and not-applicable', () => {
  assert.equal(sponsorshipOf({ country: 'CA' }, 'anything'), 'n/a');
  assert.equal(sponsorshipOf({ country: 'US' }, 'We offer visa sponsorship.'), 'offers');
  assert.equal(sponsorshipOf({ country: 'US' }, 'We are unable to sponsor.'), 'denies');
  assert.equal(sponsorshipOf({ country: 'US' }, 'Write Go, eat lunch.'), 'silent');
  assert.equal(sponsorshipOf({ country: 'US', sponsorship: 'Does Not Offer Sponsorship' }, ''), 'denies');
});

const job = (over = {}) => ({
  url: 'https://job-boards.greenhouse.io/acme/jobs/1',
  title: 'Software Engineer Intern',
  company: 'Acme',
  location: 'Toronto, ON',
  city: 'toronto',
  country: 'CA',
  source: 'ats',
  term: 'unstated',
  description: 'Python and React.',
  scores: { compatibility: 70, quality: 60, interviewOdds: 9, confidence: 'medium', signals: { pay: null } },
  ...over,
});

test('a board row keeps the gates as fields instead of dropping the posting', () => {
  const r = rowFor(job(), '2026-07-10T00:00:00Z');
  assert.equal(r.platform, 'greenhouse');
  assert.equal(r.term, 'unstated');
  assert.equal(r.sponsorship, 'n/a');
  assert.equal(r.compatibility, 70);
  assert.equal(r.firstSeenAt, '2026-07-10T00:00:00Z');
});

test('merging re-scores a known posting but preserves when it was first seen', () => {
  const board = [];
  mergeBoard(board, [job()], '2026-07-01T00:00:00Z');
  assert.equal(board.length, 1);
  assert.equal(board[0].compatibility, 70);

  const rescored = job({ scores: { compatibility: 12, quality: 60, interviewOdds: 2, confidence: 'high', signals: {} } });
  mergeBoard(board, [rescored], '2026-07-10T00:00:00Z');

  assert.equal(board.length, 1, 'the same posting must not be duplicated');
  assert.equal(board[0].compatibility, 12, 'scores are recomputed every run');
  assert.equal(board[0].firstSeenAt, '2026-07-01T00:00:00Z', 'age survives a re-scrape');
  assert.equal(board[0].lastSeenAt, '2026-07-10T00:00:00Z');
});

test('the same posting under a different URL is matched on identity', () => {
  const board = [];
  mergeBoard(board, [job()], '2026-07-01T00:00:00Z');
  mergeBoard(board, [job({ url: 'https://jobs.ashbyhq.com/acme/2' })], '2026-07-02T00:00:00Z');
  assert.equal(board.length, 1);
});

test('nothing is ever excluded — wrong term, refusal and dead platforms all land', () => {
  const board = [];
  mergeBoard(board, [
    job({ url: 'https://a.com/1', term: 'other-cycle' }),
    job({ url: 'https://bmo.wd3.myworkdayjobs.com/x', title: 'App Dev', company: 'BMO' }),
    job({ url: 'https://b.com/2', title: 'SWE Intern', company: 'Zed', country: 'US', description: 'We cannot sponsor.' }),
  ], '2026-07-01T00:00:00Z');
  assert.equal(board.length, 3);
  assert.deepEqual(board.map((r) => r.platform).sort(), ['other', 'other', 'workday']);
});
