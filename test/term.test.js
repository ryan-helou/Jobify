import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyTerm, classifyPosting, termForSource } from '../src/term.js';

test('classifyTerm accepts an explicit Summer 2027 phrase', () => {
  for (const t of [
    'Software Engineer Intern (Summer 2027)',
    'summer of 2027 internship',
    "Summer '27 is not a match but 2027 Summer is",
  ]) {
    assert.equal(classifyTerm(t), '2027', t);
  }
});

test('classifyTerm rejects an explicit off-cycle season+year', () => {
  for (const t of [
    'Software Engineer Intern - Fall 2026',
    'Winter 2026 Co-op',
    'Spring 2025 internship',
    'Summer 2026 Internship',
  ]) {
    assert.equal(classifyTerm(t), 'other-cycle', t);
  }
});

test('classifyTerm defers to a human when a posting names both terms', () => {
  assert.equal(classifyTerm('Summer 2027 and Fall 2026 cohorts'), 'unstated');
});

test('a bare year can accept but never reject', () => {
  // Bare target year is enough to accept.
  assert.equal(classifyTerm('Software Engineer - 2027 Interns'), '2027');
  // Summer 2026 postings routinely say "graduating by 2027" — a past year alongside
  // the target year proves nothing, so it must not be accepted OR rejected.
  assert.equal(classifyTerm('Intern; must graduate by 2027. Program starts 2026.'), 'unstated');
  // A bare past year alone is not evidence of an off cycle.
  assert.equal(classifyTerm('Intern, graduating 2026'), 'unstated');
});

test('classifyTerm treats empty/blank input as unstated', () => {
  assert.equal(classifyTerm(''), 'unstated');
  assert.equal(classifyTerm('   '), 'unstated');
  assert.equal(classifyTerm(null), 'unstated');
  assert.equal(classifyTerm('Software Engineer Intern'), 'unstated', 'no term named');
});

test('classifyPosting falls back to an off-season title when the text is silent', () => {
  // Names a season but no year, so classifyTerm alone says unstated.
  assert.equal(classifyTerm('Rust Engineering Intern - Fall'), 'unstated');
  assert.equal(classifyPosting('Rust Engineering Intern - Fall', ''), 'other-cycle');
  assert.equal(classifyPosting('Software Engineering Intern - Winter Co-Op', ''), 'other-cycle');
  // An explicit Summer 2027 still wins over the title heuristic.
  assert.equal(classifyPosting('Intern - Fall', 'This is a Summer 2027 position.'), '2027');
});

test('classifyPosting does not mistake Spring Boot for a spring cohort', () => {
  assert.equal(classifyPosting('Software Engineer Intern - Spring Boot / Java', ''), 'unstated');
});

test('termForSource trusts a 2027-scoped source but still rejects off-season titles', () => {
  const source = { term: '2027' };
  assert.equal(termForSource(source, 'Software Engineer Intern'), '2027', 'source vouches for the cycle');
  // speedyapply/2027-SWE-College-Jobs really does list this.
  assert.equal(termForSource(source, 'Software Engineer Winter Co-Op'), 'other-cycle');
  // An explicit Summer 2027 in the title beats the off-season check.
  assert.equal(termForSource(source, 'Summer 2027 Intern (formerly a Fall role)'), '2027');
});

test('termForSource passes exempt through and classifies undeclared sources', () => {
  assert.equal(termForSource({ term: 'exempt' }, 'anything'), 'exempt');
  assert.equal(termForSource(null, 'Software Engineer Intern (Summer 2027)'), '2027');
  assert.equal(termForSource(undefined, 'Software Engineer Intern'), 'unstated');
});
