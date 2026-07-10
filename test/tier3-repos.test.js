import test from 'node:test';
import assert from 'node:assert/strict';

import { parseBoard, parseListings } from '../src/scrapers/github.js';
import { GITHUB_SOURCES } from '../src/config.js';

// Tier 3 added five 2027-cycle GitHub repos. Two needed parser work: resumax writes
// its company as a markdown `**[Name](url)**` cell, and zshah101 ships a dict-shaped
// JSON that a source `map` normalizes. These lock in both.

test('parseBoard reads a clean company from a markdown-link cell', () => {
  const md = [
    '| Company | Role | Location | Apply |',
    '| --- | --- | --- | --- |',
    '| **[Gumloop](https://resumax.ai/companies/gumloop?utm=x)** | Software Engineer Intern | San Francisco | [Apply](https://jobs.ashbyhq.com/gumloop/abc) |',
  ].join('\n');
  const jobs = parseBoard(md, { name: 'resumax/tech-internships', kind: 'internship', term: 'detect' });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'Gumloop'); // not "**[Gumloop](…)**"
  assert.equal(jobs[0].city, 'sf');
  // The apply URL comes from the link column (Ashby), not the company's resumax.ai link.
  assert.equal(jobs[0].url, 'https://jobs.ashbyhq.com/gumloop/abc');
});

test('the zshah101 source map normalizes its id-keyed dict into url/company pairs', () => {
  const source = GITHUB_SOURCES.find((s) => s.name.startsWith('zshah101/'));
  assert.ok(source, 'zshah101 source is configured');
  assert.equal(typeof source.map, 'function');

  const raw = {
    'amazon:amazon:1': { url: 'https://job-boards.greenhouse.io/amazon/1', company: 'Amazon', is_open: 'True' },
    'stripe:stripe:2': { url: 'https://jobs.ashbyhq.com/stripe/2', company: 'Stripe', is_open: 'False' },
  };
  const listings = source.map(raw);
  assert.deepEqual(listings, [
    { url: 'https://job-boards.greenhouse.io/amazon/1', company_name: 'Amazon' },
    { url: 'https://jobs.ashbyhq.com/stripe/2', company_name: 'Stripe' },
  ]);
  // And that normalized shape is what the harvester consumes: every row carries a url.
  assert.ok(listings.every((l) => l.url));
});

test('the Canada listings source parses a Workday intern posting into a job', () => {
  const source = GITHUB_SOURCES.find((s) => s.name === 'zapplyjobs/Canada-Internships-2027');
  assert.ok(source);
  assert.equal(source.type, 'listings');
  const jobs = parseListings(
    [
      {
        id: 'x',
        title: 'Software Engineer Intern',
        company_name: 'Ada',
        locations: ['Toronto, Ontario'],
        url: 'https://ada.wd3.myworkdayjobs.com/careers/job/Toronto/SWE-Intern_R1',
      },
      // A "(Fall 2026)" title is off-cycle — isDevRole's year exclusion drops it.
      {
        id: 'y',
        title: 'Software Engineer Intern (Fall 2026)',
        company_name: 'TD',
        locations: ['Toronto, Ontario'],
        url: 'https://td.wd3.myworkdayjobs.com/careers/job/Toronto/SWE_R2',
      },
    ],
    source
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'Ada');
  assert.equal(jobs[0].city, 'toronto');
});
