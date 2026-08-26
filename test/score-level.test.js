import test from 'node:test';
import assert from 'node:assert/strict';

import { scoreJob } from '../src/score.js';

// Real postings from a real run. Before levelMismatch, Marvell's PhD role scored 66
// and D2L's new-grad role scored 72 — above genuine internships this candidate could
// take. Skill overlap is meaningless when the candidate cannot hold the job.
const undergrad = {
  skills: ['python', 'c++', 'algorithms', 'javascript', 'react'],
  strongSkills: ['python', 'react'],
  preferredFamilies: ['swe', 'fullstack', 'backend', 'frontend', 'infra', 'ml'],
};

const posting = (title, extra = {}) => ({
  title,
  company: 'Example',
  city: 'toronto',
  country: 'CA',
  term: 'unstated',
  source: 'ats',
  ...extra,
});

const fit = (title, desc) => scoreJob(posting(title), undergrad, desc).signals.fit;

test('a PhD-only internship is not a fit for an undergraduate', () => {
  const phd = fit('Analog Engineer Intern - PhD', 'Design analog circuits in C++ and Python.');
  const real = fit('Software Engineer Intern', 'Build services in Python and React.');
  assert.ok(phd < 20, `PhD role scored ${phd}, expected < 20`);
  assert.ok(real > phd * 2, `real internship ${real} should dominate PhD role ${phd}`);
});

test('a new-grad role is not an internship', () => {
  const newGrad = fit('Software Developer - New Graduate', 'Python, React, algorithms.');
  assert.ok(newGrad < 25, `new-grad role scored ${newGrad}, expected < 25`);
});

test('senior and entry-level full-time roles are excluded too', () => {
  assert.ok(fit('Senior Software Engineer', 'Python React') < 25);
  assert.ok(fit('Entry Level .Net Developer', 'C# and SQL') < 25);
});

test('a real internship is untouched by the level gate', () => {
  const score = fit('Software Engineering Intern', 'Ship production Python and React code.');
  assert.ok(score > 55, `expected a healthy score, got ${score}`);
});

// "BS, MS, or PhD" lists a doctorate as acceptable, not required. Matching the bare
// word demoted 22 postings on a real board, one of them a plain Fullstack intern role.
test('a PhD merely mentioned in the body changes nothing', () => {
  const clean = fit('Software Engineer Intern', 'You will write Python and React.');
  assert.equal(fit('Software Engineer Intern', 'BS, MS, or PhD in Computer Science. Python and React.'), clean);
  assert.equal(fit('Software Engineer Intern', 'A PhD is a plus. You will write Python and React.'), clean);
});

test('a PhD stated as required dampens, but does not disqualify, an intern title', () => {
  const body = fit('Software Engineer Intern', 'Candidates must have a PhD in machine learning. Python and React.');
  const clean = fit('Software Engineer Intern', 'Python and React.');
  assert.ok(body < clean, `required-PhD body ${body} should score below ${clean}`);
  assert.ok(body > 20, `body evidence should not disqualify, got ${body}`);
});

test('a PhD requirement alongside a Bachelors is not a requirement', () => {
  const both = fit('Software Engineer Intern', 'Requires a PhD, MS, or Bachelors degree. Python and React.');
  assert.equal(both, fit('Software Engineer Intern', 'Python and React.'));
});

test('levelReason explains a near-zero score', () => {
  const s = scoreJob(posting('Analog Engineer Intern - PhD'), undergrad, 'circuits');
  assert.equal(s.signals.levelReason, 'requires a PhD');
  assert.equal(scoreJob(posting('Software Engineer Intern'), undergrad, 'python').signals.levelReason, null);
});

// `chance` must not advertise a real shot at a job you cannot hold. It inherits the
// level collapse through `fit`, which is the whole reason difficulty only subtracts.
test('chance collapses for ineligible postings', () => {
  const phd = scoreJob(posting('Analog Engineer Intern - PhD'), undergrad, 'circuits in C++').chance;
  const real = scoreJob(posting('Software Engineer Intern'), undergrad, 'Python and React production work').chance;
  assert.ok(phd < real, `PhD chance ${phd} should be below real chance ${real}`);
  assert.ok(phd < 20, `an undergraduate cannot hold this job at all, yet it scored ${phd}`);
});

// Less evidence, less movement away from neutral.
test('difficulty shrinks toward neutral when there is no description', () => {
  const NEUTRAL = 40; // DIFFICULTY_NEUTRAL in src/score.js
  const withText = scoreJob(posting('Software Engineer Intern'), undergrad, 'Python React '.repeat(90));
  const without = scoreJob(posting('Software Engineer Intern'), undergrad, '');
  assert.equal(without.confidence, 'low');
  assert.ok(
    Math.abs(without.signals.difficulty - NEUTRAL) < Math.abs(withText.signals.difficulty - NEUTRAL),
    `no-description difficulty ${without.signals.difficulty} should sit closer to neutral than ${withText.signals.difficulty}`
  );
});

// Real title from a real board. `grad(uate)?\b` does not match "Grads" — the word
// boundary fails between the d and the s — so this scored 85 until the plural landed.
test('plural "New Grads" is caught, not just the singular', () => {
  assert.ok(fit('Software Engineer - 2027 New Grads', 'Rust, distributed systems.') < 25);
  assert.ok(fit('Software Engineer, New Graduates', 'Python.') < 25);
  assert.ok(fit('Graduate Programme - Software', 'Java.') < 25);
});
