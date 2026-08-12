import test from 'node:test';
import assert from 'node:assert/strict';

import { buildJob } from '../src/scrapers/candidate.js';

// buildJob is the shared gate every Tier-1 scraper runs a raw posting through.

test('builds a board job for a dev internship in a target city', () => {
  const job = buildJob({
    company: 'Acme',
    title: 'Software Engineer Intern',
    location: 'Toronto, ON, Canada',
    url: 'https://acme.example/jobs/1',
    source: 'workable:acme',
    description: 'Summer 2027 internship building distributed systems.',
  });
  assert.equal(job.title, 'Software Engineer Intern');
  assert.equal(job.city, 'toronto');
  assert.equal(job.country, 'CA');
  assert.equal(job.source, 'workable:acme');
  assert.equal(job.term, '2027');
  assert.equal(job.sponsorship, null);
});

test('rejects a non-developer internship', () => {
  assert.equal(buildJob({ company: 'X', title: 'Marketing Intern', location: 'Toronto, ON', url: 'u', source: 's' }), null);
});

test('rejects a role outside the target cities', () => {
  assert.equal(buildJob({ company: 'X', title: 'SWE Intern', location: 'Austin, TX', url: 'u', source: 's' }), null);
});

test('rejects a posting that names a past cycle year in the title', () => {
  // ROLE_EXCLUDE fires on 2020–2026 in the title.
  assert.equal(
    buildJob({ company: 'X', title: 'Optical Engineering Co-Op (Aug–Dec 2026)', location: 'New York, NY', url: 'u', source: 's' }),
    null
  );
});

test('requires both a title and a url', () => {
  assert.equal(buildJob({ company: 'X', title: '', location: 'New York, NY', url: 'u', source: 's' }), null);
  assert.equal(buildJob({ company: 'X', title: 'SWE Intern', location: 'New York, NY', url: '', source: 's' }), null);
});

test('campus kind waives the intern-token requirement', () => {
  // On a student-only site a bare "Developer" title is still an internship.
  assert.equal(buildJob({ company: 'X', title: 'Application Developer', location: 'Toronto, ON', url: 'u', source: 's' }), null);
  const job = buildJob({ company: 'X', title: 'Application Developer', location: 'Toronto, ON', url: 'u', source: 's', kind: 'campus' });
  assert.equal(job.city, 'toronto');
});
