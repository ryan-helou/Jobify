import test from 'node:test';
import assert from 'node:assert/strict';

import { parseJobBankFeed } from '../src/scrapers/jobbank.js';
import { levelsPostings } from '../src/scrapers/levelsfyi.js';
import { urlsIn } from '../src/scrapers/hnhiring.js';

// Tier 2 sources are their own job feeds / token mines. These cover the pure parsing;
// the network paging is exercised by a live smoke run, not here.

// ---- Job Bank (Atom feed) -------------------------------------------------

const atom = (entries) =>
  `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">${entries
    .map(
      (e) =>
        `<entry><title>${e.title}</title><link rel="alternate" href="${e.url}"/>` +
        `<summary>&lt;strong&gt;Job number:&lt;/strong&gt; 1&lt;br /&gt;&lt;strong&gt;Location:&lt;/strong&gt; ${e.loc}  &lt;br /&gt;&lt;strong&gt;Employer:&lt;/strong&gt; ${e.employer}&lt;br /&gt;</summary></entry>`
    )
    .join('')}</feed>`;

test('Job Bank: keeps a dev internship, filling company and city from the summary', () => {
  const jobs = parseJobBankFeed(
    atom([{ title: 'software developer co-op', url: 'https://www.jobbank.gc.ca/jobsearch/jobposting/1', loc: 'Montreal (QC)', employer: 'Acme Corp' }])
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'Acme Corp');
  assert.equal(jobs[0].city, 'montreal');
  assert.equal(jobs[0].source, 'jobbank');
});

test('Job Bank: a full-time role (no intern/co-op token) is dropped', () => {
  const jobs = parseJobBankFeed(
    atom([{ title: 'senior software engineer', url: 'https://www.jobbank.gc.ca/jobsearch/jobposting/2', loc: 'Toronto (ON)', employer: 'Acme' }])
  );
  assert.equal(jobs.length, 0);
});

test('Job Bank: "City (QC)" is normalized so metro suburbs pass the city gate', () => {
  const jobs = parseJobBankFeed(
    atom([{ title: 'software developer intern', url: 'https://www.jobbank.gc.ca/jobsearch/jobposting/3', loc: 'Dorval (QC)', employer: 'X' }])
  );
  // Job Bank writes "Dorval (QC)"; matchCity's metro pattern expects "Dorval, QC".
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].city, 'montreal');
});

test('Job Bank: a Canadian city outside Montreal is still dropped', () => {
  const jobs = parseJobBankFeed(
    atom([{ title: 'software developer intern', url: 'https://www.jobbank.gc.ca/jobsearch/jobposting/4', loc: 'London (ON)', employer: 'X' }])
  );
  assert.equal(jobs.length, 0);
});

// ---- levels.fyi (token mine) ----------------------------------------------

test('levels.fyi: maps rows with an http link to { url, company }, dropping the rest', () => {
  const postings = levelsPostings([
    { company: 'Stripe', title: 'SWE Intern', link: 'https://job-boards.greenhouse.io/stripe/jobs/1' },
    { company: 'NoLink', title: 'x', link: '' },
    { company: 'Relative', link: '/careers' },
    null,
  ]);
  assert.deepEqual(postings, [{ url: 'https://job-boards.greenhouse.io/stripe/jobs/1', company: 'Stripe' }]);
});

// ---- HN "Who is hiring?" (URL mine) ---------------------------------------

test('HN: extracts entity-encoded href URLs a plain regex would miss', () => {
  // Algolia hands back `/` as &#x2F; and `&` as &amp; inside <a href>.
  const html =
    '<a href="https:&#x2F;&#x2F;jobs.ashbyhq.com&#x2F;wirescreen&#x2F;abc?utm_source=hn&amp;x=1" rel="nofollow">Apply</a>';
  assert.deepEqual(urlsIn(html), ['https://jobs.ashbyhq.com/wirescreen/abc?utm_source=hn&x=1']);
});

test('HN: skips links to HN itself and to images', () => {
  const html =
    '<a href="https://news.ycombinator.com/item?id=1">thread</a> ' +
    '<a href="https://img.shields.io/badge.svg">badge</a> ' +
    '<a href="https://job-boards.greenhouse.io/acme">Apply</a>';
  assert.deepEqual(urlsIn(html), ['https://job-boards.greenhouse.io/acme']);
});

test('HN: a comment with no links yields nothing', () => {
  assert.deepEqual(urlsIn('Blaine, WA | CaseLight | Founding Engineer | email me'), []);
});
