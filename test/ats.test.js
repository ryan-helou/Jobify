import test from 'node:test';
import assert from 'node:assert/strict';

import { harvestBoardTokens } from '../src/scrapers/ats.js';

const tokensOf = (postings, ats) => [...harvestBoardTokens(postings)[ats].keys()].sort();

test('harvests board tokens from the first path segment', () => {
  const postings = [
    'https://job-boards.greenhouse.io/haizelabs/jobs/4685944008',
    'https://boards.greenhouse.io/neuralink/jobs/6648992003?gh_jid=6648992003',
    'https://jobs.lever.co/traackr/9d884d26-018c-45b2-8cfb-f17d29d4e688',
    'https://jobs.ashbyhq.com/ramp/67fadb77-43d8-4449-954b-d4cf2c6d3b8b',
  ];
  assert.deepEqual(tokensOf(postings, 'greenhouse'), ['haizelabs', 'neuralink']);
  assert.deepEqual(tokensOf(postings, 'lever'), ['traackr']);
  assert.deepEqual(tokensOf(postings, 'ashby'), ['ramp']);
});

test('recovers the board token from Greenhouse embed URLs (?for=)', () => {
  // These are real shapes in the feeds; the token is in the query, not the path.
  const postings = [
    'https://job-boards.greenhouse.io/embed/job_app?for=point72&jr_id=abc',
    'https://boards.greenhouse.io/embed/job_board?for=gemini',
  ];
  assert.deepEqual(tokensOf(postings, 'greenhouse'), ['gemini', 'point72']);
});

test('ignores grnh.se shortlinks, whose path is a link hash not a board', () => {
  assert.deepEqual(tokensOf(['https://grnh.se/a1b2c3xyz'], 'greenhouse'), []);
});

test('percent-encoded board names are decoded', () => {
  assert.deepEqual(tokensOf(['https://jobs.ashbyhq.com/latent%20defense/54841e7d'], 'ashby'), ['latent defense']);
});

test('vendor demo boards are excluded but real companies are not', () => {
  const postings = [
    'https://jobs.lever.co/leverdemo/1',
    'https://jobs.lever.co/test/2',
    'https://jobs.ashbyhq.com/sandbox/3',
    // Real companies whose names merely contain a demo-ish word must survive.
    'https://jobs.lever.co/demodesk/4',
    'https://jobs.ashbyhq.com/demandbase/5',
  ];
  assert.deepEqual(tokensOf(postings, 'lever'), ['demodesk']);
  assert.deepEqual(tokensOf(postings, 'ashby'), ['demandbase']);
});

test('non-ATS and malformed URLs are skipped', () => {
  const tokens = harvestBoardTokens([
    'https://expedia.wd108.myworkdayjobs.com/job/123',
    'not-a-url',
    '',
    null,
    undefined,
  ]);
  assert.equal(tokens.greenhouse.size + tokens.ashby.size + tokens.lever.size, 0);
});

test('maps each token to the employer display name from the feed', () => {
  // Ashby and Lever board APIs never return a company name, so without this the
  // job would be filed under its raw token ("ellipsislabs").
  const tokens = harvestBoardTokens([
    { url: 'https://jobs.ashbyhq.com/ellipsislabs/02136b22', company: 'Ellipsis Labs' },
    { url: 'https://jobs.lever.co/traackr/9d884d26', company: 'Traackr' },
    { url: 'https://job-boards.greenhouse.io/embed/job_app?for=point72', company: 'Cubist Systematic Strategies' },
  ]);
  assert.equal(tokens.ashby.get('ellipsislabs'), 'Ellipsis Labs');
  assert.equal(tokens.lever.get('traackr'), 'Traackr');
  assert.equal(tokens.greenhouse.get('point72'), 'Cubist Systematic Strategies');
});

test('a later nameless URL does not erase a name already learned', () => {
  const tokens = harvestBoardTokens([
    { url: 'https://jobs.ashbyhq.com/ramp/1', company: 'Ramp' },
    { url: 'https://jobs.ashbyhq.com/ramp/2', company: '' },
    'https://jobs.ashbyhq.com/ramp/3',
  ]);
  assert.equal(tokens.ashby.get('ramp'), 'Ramp');
  assert.equal(tokens.ashby.size, 1, 'one board, not three');
});

test('bare URL strings still yield tokens (with no name)', () => {
  const tokens = harvestBoardTokens(['https://jobs.ashbyhq.com/ctgt/f657c2f5']);
  assert.equal(tokens.ashby.has('ctgt'), true);
  assert.equal(tokens.ashby.get('ctgt'), '');
});
