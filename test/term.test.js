import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyTerm, classifyPosting, termForSource, termFromStartDate } from '../src/term.js';

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

test('classifyTerm infers the cycle from a start date when no season is named', () => {
  // The motivating case: a start of September 2026 is the Fall 2026 cohort.
  assert.equal(classifyTerm('Are you able to start September 2026?'), 'other-cycle');
  assert.equal(classifyTerm('Start date: May 2027'), '2027'); // summer 2027 = target
  assert.equal(classifyTerm('This internship starts in January 2027.'), 'other-cycle'); // winter
  assert.equal(classifyTerm('Software Engineer Intern, beginning June 2026'), 'other-cycle'); // summer 2026, past
  // A duration range names the cycle by its first month, whichever month carries the year.
  assert.equal(classifyTerm('Internship period: September 2026 – December 2026'), 'other-cycle');
  assert.equal(classifyTerm('Duration: September – December 2026'), 'other-cycle');
  assert.equal(classifyTerm('Work term May – August 2027'), '2027');
});

test('start-date inference does not fire on non-start dates', () => {
  assert.equal(termFromStartDate('Applications close by September 2026.'), null); // a deadline, not a start
  assert.equal(termFromStartDate('Our company was founded in September 2010.'), null); // history, not a start
  assert.equal(termFromStartDate('Software Engineer Intern'), null); // no date at all
  // An ambiguous month (August) is deliberately not mapped.
  assert.equal(termFromStartDate('Start date August 2026'), null);
  // Two genuinely-anchored, disagreeing start dates → a human decides, not a guess.
  assert.equal(termFromStartDate('Start date May 2027; alternate start date September 2027'), null);
});

test('French season+year is read like the English one (Montreal is bilingual)', () => {
  assert.equal(classifyTerm('Stage été 2027 en génie logiciel'), '2027');
  assert.equal(classifyTerm("Stagiaire, développement — été 2027"), '2027');
  assert.equal(classifyTerm('Stage automne 2026'), 'other-cycle');
  assert.equal(classifyTerm('Poste hiver 2027'), 'other-cycle'); // winter 2027 is off-cycle
  assert.equal(classifyTerm('été 2026'), 'other-cycle'); // past summer
  // "été" must not fire inside another word: "complété 2026" would wrongly read as
  // été 2026 (other-cycle) without the lookbehind guard; it should stay unstated.
  assert.equal(classifyTerm('Projet complété 2026'), 'unstated');
});

test('French start dates infer the cycle', () => {
  assert.equal(classifyTerm('Début du stage : septembre 2026'), 'other-cycle'); // fall
  assert.equal(classifyTerm('Poste à partir de mai 2027'), '2027'); // summer 2027
  assert.equal(classifyTerm('Disponible dès janvier 2027'), 'other-cycle'); // winter
  assert.equal(classifyTerm('Stage de mai à août 2027'), '2027'); // range, first month = summer
  assert.equal(termFromStartDate("Fondée en septembre 2010"), null); // history, not a start
});

test('an explicit Summer 2027 phrase still beats a stray start date', () => {
  assert.equal(classifyTerm('Summer 2027 internship. Onboarding may begin September 2026.'), '2027');
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
