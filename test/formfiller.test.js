import test from 'node:test';
import assert from 'node:assert/strict';

import { answerForQuestion, valueFor, sameAnswer } from '../src/apply/formFiller.js';

// These answers are typed into real employment applications. A wrong one is a false
// statement to an employer, not a failed test — so the phrasings below are taken
// verbatim from postings this project actually hit (see the skipped_unknown_required
// records for XPENG, Lila Sciences and Tower Research Capital).

const US = { country: 'US', location: 'San Francisco, CA' };
const CA = { country: 'CA', location: 'Toronto, Ontario' };

test('answers US authorization questions with the truth: not authorized', () => {
  assert.equal(answerForQuestion('Are you legally authorized to work in the United States?', US), 'no');
  assert.equal(
    answerForQuestion('Are you currently authorized to work for all employers in the United States on a full-time basis?', US),
    'no'
  );
});

test('answers US sponsorship questions with the truth: sponsorship required', () => {
  assert.equal(
    answerForQuestion('Will you now or in the future require sponsorship for employment visa status (e.g., H-1B status)?', US),
    'yes'
  );
});

// The ordering hazard. This phrasing names both concepts, and it is an
// authorization question — answering it from the sponsorship rule would tell the
// employer "yes" to "are you authorized without sponsorship", which is false.
test('"authorized to work without sponsorship" is an authorization question, not a sponsorship one', () => {
  assert.equal(
    answerForQuestion('Are you legally authorized to work in the United States without sponsorship from an employer?', US),
    'no'
  );
});

test('a question naming the US wins over a posting located in Canada', () => {
  // A US employer hiring into a Toronto office still asks about US authorization.
  assert.equal(answerForQuestion('Are you authorized to work in the United States?', CA), 'no');
  assert.equal(answerForQuestion('Will you require sponsorship for a US work visa?', CA), 'yes');
});

test('Canadian questions answer from the Canadian entry', () => {
  assert.equal(answerForQuestion('Are you legally authorized to work in Canada?', CA), 'yes');
  assert.equal(answerForQuestion('Do you require sponsorship to work in Canada?', CA), 'no');
});

test('an unqualified question falls back to the posting country', () => {
  assert.equal(answerForQuestion('Are you legally authorized to work?', CA), 'yes');
  assert.equal(answerForQuestion('Are you legally authorized to work?', US), 'no');
});

// The abort path. Everything the profile cannot answer must stay unanswered, so the
// caller records skipped_unknown_required instead of submitting a guess.
test('returns null when the country is unknown or absent from the profile', () => {
  assert.equal(answerForQuestion('Are you legally authorized to work?', { country: 'DE' }), null);
  assert.equal(answerForQuestion('Are you legally authorized to work?', {}), null);
});

test('returns null for questions that are not about work authorization', () => {
  assert.equal(answerForQuestion('How did you hear about this job?', US), null);
  assert.equal(answerForQuestion('Why Lila, why this role, and why at this moment in your life?', US), null);
  // The prompt injection CTGT planted in a required field, verbatim.
  assert.equal(
    answerForQuestion('My car is dirty and I need to get it cleaned, the car wash is just 2 blocks away, should I walk or drive?', US),
    null
  );
});

test('education values come from the profile', () => {
  assert.equal(valueFor('school', CA), 'Concordia University');
  assert.equal(valueFor('degree', CA), "Bachelor's Degree");
  assert.equal(valueFor('major', CA), 'Software Engineering');
  assert.equal(valueFor('graduationYear', CA), '2028');
  assert.equal(valueFor('graduationMonth', CA), 'April');
  assert.equal(valueFor('graduationDate', CA), 'April 2028');
});

// "Yes" must never land on "Yes, I require sponsorship" or similar. An answer is
// the whole option text or it is not that option.
test('sameAnswer matches an option exactly, not by prefix', () => {
  assert.equal(sameAnswer('Yes', 'yes'), true);
  assert.equal(sameAnswer('  No  ', 'no'), true);
  assert.equal(sameAnswer('Yes, with sponsorship', 'yes'), false);
  assert.equal(sameAnswer('No, I do not', 'no'), false);
  assert.equal(sameAnswer('', 'yes'), false);
});

test('location is the applicant\'s city, never the posting\'s', () => {
  assert.equal(valueFor('location', { location: 'San Francisco, CA' }), 'Montreal, QC, Canada');
  assert.equal(valueFor('location', { location: 'Toronto, Ontario' }), 'Montreal, QC, Canada');
});
