import test from 'node:test';
import assert from 'node:assert/strict';

import { isDevRole, matchCity, parseListings, parseBoard } from '../src/scrapers/github.js';
import { mentionsSponsorship, feedSponsorshipVerdict } from '../src/visa.js';
import { canonicalKey, identityKey } from '../src/tracker.js';

test('isDevRole accepts software internships', () => {
  for (const t of [
    'Software Engineer Intern',
    'Software Engineering Internship',
    'Full Stack Engineering Intern',
    'Backend Developer Co-op',
    'Machine Learning Engineer Intern',
  ]) {
    assert.equal(isDevRole(t), true, t);
  }
});

test('isDevRole rejects non-developer and off-year internships', () => {
  for (const t of [
    'Research Scientist Intern', // non-dev track
    'GTM Engineer Intern', // go-to-market
    'Mechanical Engineer Intern', // hardware
    'Product Manager Intern',
    'Data Analyst Intern',
    'Software Engineer Intern - Summer 2025', // past season
    'Marketing Intern',
    'Software Engineer', // not an internship on an internship board
  ]) {
    assert.equal(isDevRole(t), false, t);
  }
});

test('newgrad kind allows entry-level titles without an "intern" token', () => {
  assert.equal(isDevRole('Software Developer – New Graduate', 'newgrad'), true);
  assert.equal(isDevRole('Junior Software Engineer, AI', 'newgrad'), true);
  assert.equal(isDevRole('Developer', 'newgrad'), true);
  assert.equal(isDevRole('Full Stack Software Developer 1', 'newgrad'), true);
});

test('newgrad kind rejects senior and levelled roles', () => {
  for (const t of [
    'Senior Software Engineer',
    'Staff Software Engineer',
    'Principal Engineer',
    'Software Developer 2',
    'Software Engineer III',
    'Engineering Manager',
    'Senior Model Validation Analyst',
  ]) {
    assert.equal(isDevRole(t, 'newgrad'), false, t);
  }
});

test('matchCity prefers the highest-priority target city', () => {
  assert.equal(matchCity(['San Francisco, CA', 'Toronto, ON']).key, 'toronto');
  assert.equal(matchCity(['Montreal, QC, Canada']).key, 'montreal');
  assert.equal(matchCity(['New York, NY']).key, 'nyc');
  assert.equal(matchCity(['Austin, TX']), null);
  assert.equal(matchCity([]), null);
});

test('parseListings honours active, visibility, season and category', () => {
  const source = { name: 'test', kind: 'internship' };
  const base = {
    url: 'https://example.com/j',
    title: 'Software Engineer Intern',
    company_name: 'Acme',
    locations: ['Toronto, ON'],
    active: true,
    is_visible: true,
    season: 'Summer',
  };
  assert.equal(parseListings([base], source).length, 1);
  assert.equal(parseListings([{ ...base, active: false }], source).length, 0, 'inactive dropped');
  assert.equal(parseListings([{ ...base, is_visible: false }], source).length, 0, 'hidden dropped');
  assert.equal(parseListings([{ ...base, season: 'Winter' }], source).length, 0, 'off-season dropped');
  assert.equal(parseListings([{ ...base, locations: ['Austin, TX'] }], source).length, 0, 'off-target city dropped');
});

test('parseListings applies the category allowlist for newgrad boards', () => {
  const source = { name: 'test', kind: 'newgrad' };
  const base = {
    url: 'https://example.com/j',
    title: 'Software Developer',
    company_name: 'Acme',
    locations: ['Montreal, QC, Canada'],
    active: true,
    is_visible: true,
  };
  assert.equal(parseListings([{ ...base, category: 'Software' }], source).length, 1);
  assert.equal(parseListings([{ ...base, category: 'Hardware' }], source).length, 0);
  assert.equal(parseListings([{ ...base, category: 'Product' }], source).length, 0);
});

test('parseListings carries the sponsorship field through', () => {
  const jobs = parseListings(
    [
      {
        url: 'https://example.com/j',
        title: 'Software Engineer Intern',
        company_name: 'Acme',
        locations: ['New York, NY'],
        active: true,
        is_visible: true,
        season: 'Summer',
        sponsorship: 'Offers Sponsorship',
      },
    ],
    { name: 'test', kind: 'internship' }
  );
  assert.equal(jobs[0].sponsorship, 'Offers Sponsorship');
  assert.equal(jobs[0].country, 'US');
});

test('parseBoard reads markdown tables and carries ↳ company continuation', () => {
  const md = [
    '| Company | Role | Location | Application/Link | Date Posted |',
    '| ------- | ---- | -------- | ---------------- | ----------- |',
    '| Optiver | Software Engineer Intern | Toronto, ON | <a href="https://ex.com/a">Apply</a> | Jul 07 |',
    '| ↳ | Backend Engineer Intern | Montreal, QC | <a href="https://ex.com/b">Apply</a> | Jul 07 |',
    '| Acme | Marketing Intern | Toronto, ON | <a href="https://ex.com/c">Apply</a> | Jul 07 |',
  ].join('\n');
  const jobs = parseBoard(md, { name: 'md', kind: 'internship' });
  assert.equal(jobs.length, 2, 'marketing role filtered out');
  assert.equal(jobs[1].company, 'Optiver', '↳ inherits previous company');
  assert.equal(jobs[1].city, 'montreal');
});

test('feedSponsorshipVerdict maps curated values', () => {
  assert.equal(feedSponsorshipVerdict({ sponsorship: 'Offers Sponsorship' }), 'offers');
  assert.equal(feedSponsorshipVerdict({ sponsorship: 'Does Not Offer Sponsorship' }), 'denies');
  assert.equal(feedSponsorshipVerdict({ sponsorship: 'U.S. Citizenship is Required' }), 'denies');
  assert.equal(feedSponsorshipVerdict({ sponsorship: 'Other' }), 'unknown');
  assert.equal(feedSponsorshipVerdict({}), 'unknown');
});

test('mentionsSponsorship requires an offer and respects negations', () => {
  assert.equal(mentionsSponsorship('We offer visa sponsorship for this role.'), true);
  assert.equal(mentionsSponsorship('We are willing to sponsor H1B candidates.'), true);
  assert.equal(mentionsSponsorship('Great team, great benefits.'), false);
  // A negation wins even though the keyword appears.
  assert.equal(mentionsSponsorship('We are unable to provide sponsorship at this time.'), false);
  assert.equal(mentionsSponsorship('We do not sponsor H1B visas.'), false);
  assert.equal(mentionsSponsorship('Candidates must be authorized to work without sponsorship.'), false);
});

test('canonicalKey strips tracking params and normalizes', () => {
  assert.equal(
    canonicalKey('https://Ex.com/job/1?utm_source=github-vansh&utm_medium=x#top'),
    canonicalKey('https://ex.com/job/1')
  );
  assert.notEqual(canonicalKey('https://ex.com/job/1'), canonicalKey('https://ex.com/job/2'));
});

test('identityKey collapses the same job seen on different boards', () => {
  const a = { company: 'mthree', title: 'Junior Software Developer', city: 'montreal' };
  const b = { company: 'M-Three', title: 'Junior  Software   Developer', city: 'montreal' };
  const c = { company: 'mthree', title: 'Junior Software Developer', city: 'toronto' };
  assert.equal(identityKey(a), identityKey(b), 'punctuation-insensitive');
  assert.notEqual(identityKey(a), identityKey(c), 'different city is a different job');
});

test('identityKey is accent-insensitive', () => {
  const a = { company: 'Naïve', title: 'Software Engineer Intern', city: 'sf' };
  const b = { company: 'Naive', title: 'Software Engineer Intern', city: 'sf' };
  assert.equal(identityKey(a), identityKey(b));
  assert.equal(identityKey({ company: 'Ether.fi', title: 'x', city: 'nyc' }), identityKey({ company: 'etherfi', title: 'x', city: 'nyc' }));
});
