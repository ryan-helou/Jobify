import test from 'node:test';
import assert from 'node:assert/strict';

import { harvestWorkableTenants } from '../src/scrapers/workable.js';
import { harvestRecruiteeTenants } from '../src/scrapers/recruitee.js';
import { harvestBambooTenants } from '../src/scrapers/bamboohr.js';
import { harvestIcimsSites } from '../src/scrapers/icims.js';
import { harvestEightfoldSites } from '../src/scrapers/eightfold.js';
import { harvestPersonioTenants } from '../src/scrapers/personio.js';
import { loadPhenomSites } from '../src/scrapers/phenom.js';

// The Tier-1 scrapers all follow the same harvest-then-enumerate shape as ats.js and
// workday.js; these tests cover the pure token-extraction half, where the URL parsing
// lives. The enumerate half is live HTTP and exercised by a smoke run, not here.

// ---- Workable -------------------------------------------------------------

test('Workable: token from apply.workable.com path and *.workable.com subdomain', () => {
  const t = harvestWorkableTenants([
    { url: 'https://apply.workable.com/huggingface/j/ABC123/', company: 'Hugging Face' },
    { url: 'https://deel.workable.com/j/XYZ', company: 'Deel' },
  ]);
  assert.equal(t.get('huggingface'), 'Hugging Face');
  assert.equal(t.get('deel'), 'Deel');
});

test('Workable: route segments and non-tenant subdomains are not tenants', () => {
  const t = harvestWorkableTenants([
    'https://apply.workable.com/j/ABC', // /j/ is a route, not a tenant
    'https://apply.workable.com/api/v3/accounts/x/jobs',
    'https://www.workable.com/jobs', // vendor marketing site
    'https://apply.workable.com/', // no segment
  ]);
  assert.equal(t.size, 0);
});

test('Workable: first non-empty company name wins and dedupes', () => {
  const t = harvestWorkableTenants([
    { url: 'https://apply.workable.com/ramp/j/1/', company: 'Ramp' },
    { url: 'https://apply.workable.com/ramp/j/2/', company: '' },
    'https://apply.workable.com/ramp/j/3/',
  ]);
  assert.equal(t.size, 1);
  assert.equal(t.get('ramp'), 'Ramp');
});

// ---- Recruitee ------------------------------------------------------------

test('Recruitee: tenant from subdomain, skipping vendor subdomains', () => {
  const t = harvestRecruiteeTenants([
    { url: 'https://greenchoice.recruitee.com/o/dev-intern', company: 'Greenchoice' },
    'https://www.recruitee.com/features',
  ]);
  assert.deepEqual([...t.keys()], ['greenchoice']);
  assert.equal(t.get('greenchoice'), 'Greenchoice');
});

// ---- BambooHR -------------------------------------------------------------

test('BambooHR: tenant from subdomain', () => {
  const t = harvestBambooTenants([
    { url: 'https://workleap.bamboohr.com/careers/21', company: 'Workleap' },
    'https://www.bamboohr.com/signup',
  ]);
  assert.deepEqual([...t.keys()], ['workleap']);
  assert.equal(t.get('workleap'), 'Workleap');
});

// ---- iCIMS ----------------------------------------------------------------

test('iCIMS: the whole employer subdomain is the identity', () => {
  const s = harvestIcimsSites([
    { url: 'https://careers-gdms.icims.com/jobs/73370/x/job', company: 'GDMS' },
    { url: 'https://jobs-nnn.icims.com/jobs/1/y/job?in_iframe=1', company: 'NNN' },
  ]);
  assert.equal(s.get('careers-gdms.icims.com'), 'GDMS');
  assert.equal(s.get('jobs-nnn.icims.com'), 'NNN');
});

test('iCIMS: vendor infrastructure subdomains are skipped', () => {
  const s = harvestIcimsSites([
    'https://login.icims.com/x',
    'https://www.icims.com/',
    'https://configure.icims.com/y',
  ]);
  assert.equal(s.size, 0);
});

// ---- Eightfold ------------------------------------------------------------

test('Eightfold: host key with a {tenant}.com domain guess', () => {
  const s = harvestEightfoldSites([{ url: 'https://aexp.eightfold.ai/careers/job/123', company: 'Amex' }]);
  assert.deepEqual(s.get('aexp.eightfold.ai'), { company: 'Amex', domain: 'aexp.com' });
});

test('Eightfold: an override replaces the domain guess', () => {
  const s = harvestEightfoldSites([{ url: 'https://bnymellon.eightfold.ai/careers/job/1', company: 'BNY' }], {
    'bnymellon.eightfold.ai': 'bny.com',
  });
  assert.equal(s.get('bnymellon.eightfold.ai').domain, 'bny.com');
});

// ---- Personio -------------------------------------------------------------

test('Personio: tenant and TLD from the jobs host', () => {
  const t = harvestPersonioTenants([
    { url: 'https://acme.jobs.personio.de/job/9', company: 'Acme' },
    { url: 'https://beta.jobs.personio.com/job/3', company: 'Beta' },
  ]);
  assert.deepEqual(t.get('acme'), { company: 'Acme', tld: 'de' });
  assert.deepEqual(t.get('beta'), { company: 'Beta', tld: 'com' });
});

// ---- Phenom ---------------------------------------------------------------

test('Phenom: normalizes string entries and drops those without a host', () => {
  const sites = loadPhenomSites();
  // The seeded assets file must at least contain the confirmed Bell site.
  assert.ok(sites.some((s) => s.host === 'jobs.bell.ca'));
  assert.ok(sites.every((s) => s.host));
});

// ---- shared negative cases across all harvesters --------------------------

test('every harvester ignores non-matching and malformed URLs', () => {
  const junk = ['https://job-boards.greenhouse.io/x/jobs/1', 'not-a-url', '', null, undefined];
  assert.equal(harvestWorkableTenants(junk).size, 0);
  assert.equal(harvestRecruiteeTenants(junk).size, 0);
  assert.equal(harvestBambooTenants(junk).size, 0);
  assert.equal(harvestIcimsSites(junk).size, 0);
  assert.equal(harvestEightfoldSites(junk).size, 0);
  assert.equal(harvestPersonioTenants(junk).size, 0);
});
