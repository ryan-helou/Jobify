import test from 'node:test';
import assert from 'node:assert/strict';

import { harvestWorkdayTenants } from '../src/scrapers/workday.js';

const keys = (t) => t.map((x) => `${x.tenant}/${x.pod}/${x.site}`).sort();

test('parses tenant, pod and site out of a Workday job URL', () => {
  const t = harvestWorkdayTenants([
    'https://expedia.wd108.myworkdayjobs.com/private/job/Canada---Quebec---Montreal/Developer_R-98643',
  ]);
  assert.deepEqual(t, [{ tenant: 'expedia', pod: 'wd108', site: 'private', company: '' }]);
});

test('skips the optional locale segment', () => {
  const t = harvestWorkdayTenants([
    'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA/Intern_JR123',
  ]);
  assert.deepEqual(keys(t), ['nvidia/wd5/NVIDIAExternalCareerSite']);
});

test('ignores URLs whose first segment is the job itself, not a site', () => {
  // .../myworkdayjobs.com/job/... has no site segment; enumerating a site
  // called "job" would just 404.
  const t = harvestWorkdayTenants([
    'https://acme.wd1.myworkdayjobs.com/job/Toronto/Software-Engineer-Intern_R1',
    'https://acme.wd1.myworkdayjobs.com/jobs/Toronto/Software-Engineer-Intern_R2',
  ]);
  assert.deepEqual(t, []);
});

test('ignores non-Workday and malformed URLs', () => {
  const t = harvestWorkdayTenants([
    'https://job-boards.greenhouse.io/haizelabs/jobs/123',
    'https://jobs.lever.co/traackr/abc',
    'not-a-url',
    '',
    null,
    undefined,
  ]);
  assert.deepEqual(t, []);
});

test('keys on tenant+site: one employer can run several sites listing different jobs', () => {
  const t = harvestWorkdayTenants([
    { url: 'https://bmo.wd3.myworkdayjobs.com/Campus/job/Toronto/Application-developer_R1', company: 'BMO' },
    { url: 'https://bmo.wd3.myworkdayjobs.com/Privileged/job/Toronto/Software-Engineer_R2', company: 'BMO' },
  ]);
  assert.deepEqual(keys(t), ['bmo/wd3/Campus', 'bmo/wd3/Privileged']);
});

test('dedupes repeated postings from the same site', () => {
  const t = harvestWorkdayTenants([
    'https://acme.wd1.myworkdayjobs.com/careers/job/A_R1',
    'https://acme.wd1.myworkdayjobs.com/careers/job/B_R2',
    'https://acme.wd1.myworkdayjobs.com/careers/job/C_R3',
  ]);
  assert.equal(t.length, 1);
});

test('learns the company name, and a later nameless URL does not erase it', () => {
  const t = harvestWorkdayTenants([
    { url: 'https://zebra.wd501.myworkdayjobs.com/Zebra_careers/job/Montreal/Dev_JR1', company: '' },
    { url: 'https://zebra.wd501.myworkdayjobs.com/Zebra_careers/job/Montreal/Dev_JR2', company: 'Zebra Technologies' },
    'https://zebra.wd501.myworkdayjobs.com/Zebra_careers/job/Montreal/Dev_JR3',
  ]);
  assert.equal(t.length, 1);
  assert.equal(t[0].company, 'Zebra Technologies');
});
