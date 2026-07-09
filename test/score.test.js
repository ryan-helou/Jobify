import test from 'node:test';
import assert from 'node:assert/strict';

import { scoreJob, parsePay, detectSkills, roleFamily, companyTier, normalizeCompany, explainScore } from '../src/score.js';

// A deterministic candidate — the real one lives in assets/profile.json and
// would make these assertions move whenever it's edited.
const PROFILE = {
  skills: ['javascript', 'typescript', 'python', 'react', 'node', 'sql', 'git', 'docker'],
  strongSkills: ['javascript', 'react'],
  preferredFamilies: ['swe', 'fullstack', 'backend', 'frontend', 'infra', 'ml'],
};

const job = (over = {}) => ({
  title: 'Software Engineer Intern',
  company: 'Acme',
  location: 'Montreal, QC',
  city: 'montreal',
  country: 'CA',
  url: 'https://example.com/1',
  source: 'ats:greenhouse',
  sponsorship: null,
  description: '',
  term: '2027',
  ...over,
});

// ---- pay parsing ----------------------------------------------------------

test('parsePay reads hourly, monthly and annual rates', () => {
  assert.equal(Math.round(parsePay('Pay: $45/hr').hourly), 45);
  assert.equal(Math.round(parsePay('$45 per hour').hourly), 45);
  assert.equal(Math.round(parsePay('$8,000/month').hourly), 46);
  assert.equal(Math.round(parsePay('$120k/year').hourly), 58);
});

test('parsePay takes the midpoint of a range', () => {
  assert.equal(Math.round(parsePay('$40 - $55 per hour').hourly), 48);
  assert.equal(Math.round(parsePay('CA$40 – CA$50 / hr').hourly), 45);
});

test('parsePay keeps the currency prefix in the text it echoes back', () => {
  // Ashby writes Canadian rates this way. Without the leading currency group the
  // range failed to match and the regex scored the posting off its upper bound.
  assert.equal(parsePay('Compensation: CA$40 - CA$50 / hr').raw, 'CA$40 - CA$50 / hr');
});

test('parsePay returns null when no rate is stated', () => {
  assert.equal(parsePay(''), null);
  assert.equal(parsePay('Competitive compensation and great benefits.'), null);
  assert.equal(parsePay(null), null);
});

test('parsePay rejects dollar figures that are not wages', () => {
  // Marketing copy and funding announcements are full of these; treating one as
  // a wage would sink the quality score of a perfectly good posting.
  assert.equal(parsePay('our customers save $10,000 per year'), null, 'below any real wage');
  assert.equal(parsePay('we process $500,000 per hour in payments'), null, 'above any real wage');
  assert.equal(parsePay('We raised $2 billion.'), null, 'no period unit at all');
});

// ---- skill detection ------------------------------------------------------

test('detectSkills finds the technologies a posting names', () => {
  const skills = detectSkills('You will write TypeScript and Python, deploy with Docker on AWS.');
  assert.deepEqual(skills.sort(), ['aws', 'docker', 'python', 'typescript']);
});

test('detectSkills does not fire on words that merely contain a skill name', () => {
  // Each of these is a real phrase from a real posting that a naive regex eats.
  assert.deepEqual(detectSkills('We are a go-to-market team'), [], 'go-to-market is not Golang');
  assert.deepEqual(detectSkills('the rest of the team'), [], '"rest" is not a REST API');
  assert.deepEqual(detectSkills('JavaScript developer'), ['javascript'], 'JavaScript is not Java');
  assert.deepEqual(detectSkills('Our C-level executives'), [], '"C-level" is not C');
});

test('detectSkills matches Java only as its own word', () => {
  assert.deepEqual(detectSkills('Java and Spring Boot').sort(), ['java', 'spring']);
});

test('detectSkills finds C++ and C# when followed by punctuation', () => {
  // A trailing \b after "++" needs a word character after it, so /\bc\+\+\b/
  // matches only "C++11" and never "C++." — the skill was undetectable in prose.
  assert.ok(detectSkills('We write C++.').includes('c++'));
  assert.ok(detectSkills('Experience with C++, Rust, or Go.').includes('c++'));
  assert.ok(detectSkills('embedded C/C++)').includes('c++'));
  assert.ok(detectSkills('C++11 and later').includes('c++'));
  assert.ok(detectSkills('Build services in C#.').includes('c#'));
});

test('skill fit shrinks toward the prior when a posting names few technologies', () => {
  // Zero technologies named is no evidence; two named and none matched is weak
  // evidence of a bad fit — and must not score the same as no evidence at all.
  const none = scoreJob(job({ description: 'Join our wonderful team.' }), PROFILE);
  const twoMissed = scoreJob(job({ description: 'You will write Verilog and RTOS firmware.' }), PROFILE);
  assert.ok(twoMissed.compatibility < none.compatibility, `${twoMissed.compatibility} should be under ${none.compatibility}`);
});

// ---- role families --------------------------------------------------------

test('roleFamily resolves the more specific pattern first', () => {
  assert.equal(roleFamily('Full Stack Engineer Intern'), 'fullstack');
  assert.equal(roleFamily('Machine Learning Intern'), 'ml');
  assert.equal(roleFamily('Frontend Engineer Intern'), 'frontend');
  assert.equal(roleFamily('Software Engineer Intern'), 'swe', 'no family named → generic');
});

// ---- company normalization ------------------------------------------------

test('normalizeCompany strips trailing legal suffixes but keeps meaningful words', () => {
  assert.equal(normalizeCompany('Jane Street Capital, Inc.'), 'janestreetcapital');
  assert.equal(normalizeCompany('Stripe, Inc.'), 'stripe');
  // "Labs" distinguishes real employers, so it must survive.
  assert.equal(normalizeCompany('Haize Labs'), 'haizelabs');
  assert.equal(normalizeCompany('Ellipsis Labs'), 'ellipsislabs');
});

test('companyTier recognizes known names through their legal suffix', () => {
  assert.equal(companyTier('Stripe, Inc.'), 'top');
  assert.equal(companyTier('Jane Street'), 'top');
  assert.equal(companyTier('Shopify'), 'strong');
  assert.equal(companyTier('Some Startup Nobody Knows'), 'unknown');
  assert.equal(companyTier(''), 'unknown');
});

// ---- compatibility --------------------------------------------------------

test('compatibility rises with skill overlap', () => {
  const mine = scoreJob(job({ description: 'Build with React, TypeScript, Node and SQL.' }), PROFILE);
  const theirs = scoreJob(job({ description: 'Write Verilog and RTOS firmware for embedded C/C++.' }), PROFILE);
  assert.ok(mine.compatibility > theirs.compatibility, `${mine.compatibility} should beat ${theirs.compatibility}`);
  assert.deepEqual(mine.signals.matchedSkills.sort(), ['node', 'react', 'sql', 'typescript']);
});

test('a terse posting gets a neutral skill prior, not a zero', () => {
  // Two skills is not enough evidence to conclude a bad fit. Scoring 0/0 overlap
  // would punish a posting for being short.
  const terse = scoreJob(job({ description: 'Join our team. We use Rust.' }), PROFILE);
  const hostile = scoreJob(
    job({ description: 'Requires Rust, Verilog, RTOS firmware, embedded C/C++, Kotlin, Scala and Azure.' }),
    PROFILE
  );
  assert.ok(terse.compatibility > hostile.compatibility);
  assert.ok(terse.compatibility >= 50, `terse posting scored ${terse.compatibility}, expected a neutral-ish prior`);
});

test('compatibility ignores city — that is the apply queue\'s job, not a measure of fit', () => {
  // City is already a hard filter (matchCity) and the primary sort key. Folding
  // it in here only compressed the range: every posting that survives scraping
  // is in a target city, so the term was near-max for all of them.
  const desc = 'React and TypeScript.';
  const mtl = scoreJob(job({ city: 'montreal', country: 'CA', description: desc }), PROFILE);
  const tor = scoreJob(job({ city: 'toronto', country: 'CA', description: desc }), PROFILE);
  assert.equal(mtl.compatibility, tor.compatibility);
});

test('a US posting that refuses sponsorship has its compatibility collapsed', () => {
  const base = { city: 'nyc', country: 'US', location: 'New York, NY', description: 'React, TypeScript, Node.' };
  const offers = scoreJob(job({ ...base, sponsorship: 'Offers Sponsorship' }), PROFILE);
  const denies = scoreJob(job({ ...base, sponsorship: 'Does Not Offer Sponsorship' }), PROFILE);
  // A multiplier, not a fixed penalty: you cannot take the job at all, so the
  // score should collapse rather than lose a handful of points.
  assert.ok(denies.compatibility < offers.compatibility * 0.5, `${denies.compatibility} vs ${offers.compatibility}`);
});

test('an off-cycle posting cannot score as a good fit however well the skills match', () => {
  const desc = 'React, TypeScript, Node and SQL — a perfect match.';
  const right = scoreJob(job({ description: desc, term: '2027' }), PROFILE);
  const wrong = scoreJob(job({ description: desc, term: 'other-cycle' }), PROFILE);
  assert.ok(wrong.compatibility < 40, `off-cycle posting scored ${wrong.compatibility}`);
  assert.ok(right.compatibility > 85);
});

test('the score range is not compressed by terms that are constant across postings', () => {
  // The regression this guards: an unpaid embedded role once scored 66/100 for a
  // web candidate, because location and eligibility contributed a ~60-point floor.
  const bad = scoreJob(
    job({ title: 'Embedded Firmware Intern', description: 'Verilog, RTOS firmware, embedded C/C++.' }),
    PROFILE
  );
  const good = scoreJob(job({ description: 'React, TypeScript, Node and SQL.' }), PROFILE);
  assert.ok(bad.compatibility < 45, `mismatched role scored ${bad.compatibility}, expected a low fit`);
  assert.ok(good.compatibility - bad.compatibility > 40, 'good and bad fits should be far apart');
});

// ---- quality --------------------------------------------------------------

test('quality rewards pay, return offers and mentorship', () => {
  const rich = scoreJob(
    job({
      description:
        'Paid at $50/hr. Interns are paired with a senior engineer as a mentor, ship code to production, ' +
        'and strong performers receive a return offer for full-time conversion.',
    }),
    PROFILE
  );
  const bare = scoreJob(job({ description: 'An internship at our company.' }), PROFILE);
  assert.ok(rich.quality > bare.quality, `${rich.quality} should beat ${bare.quality}`);
  assert.equal(rich.signals.pay, '$50/hr');
});

test('an unpaid or credit-only internship is capped regardless of the rest', () => {
  const unpaid = scoreJob(
    job({
      company: 'Stripe', // top tier, would otherwise score well
      description: 'This is an unpaid internship. You will be mentored, ship to production, and get a return offer.',
    }),
    PROFILE
  );
  assert.ok(unpaid.quality <= 25, `unpaid internship scored ${unpaid.quality}`);
  assert.deepEqual(unpaid.signals.flags, ['unpaid']);

  const credit = scoreJob(job({ description: 'Offered for course credit only.' }), PROFILE);
  assert.ok(credit.quality <= 25);
});

test('quality does not read "unpaid leave" in a benefits section as an unpaid role', () => {
  const s = scoreJob(job({ description: 'Benefits include paid and unpaid leave options.' }), PROFILE);
  assert.deepEqual(s.signals.flags, []);
});

test('a prestigious employer raises quality', () => {
  const desc = 'Software engineering internship.';
  assert.ok(scoreJob(job({ company: 'Google', description: desc }), PROFILE).quality >
    scoreJob(job({ company: 'Unknown Co', description: desc }), PROFILE).quality);
});

// ---- interview odds -------------------------------------------------------

test('interview odds fall as competition rises', () => {
  // Same posting, different employer. The name that makes an internship worth
  // having is the name that makes it hard to get.
  const desc = 'Build with React, TypeScript and Node.';
  const top = scoreJob(job({ company: 'Google', description: desc }), PROFILE);
  const unknown = scoreJob(job({ company: 'Unknown Co', description: desc }), PROFILE);
  assert.ok(unknown.interviewOdds > top.interviewOdds, `${unknown.interviewOdds} vs ${top.interviewOdds}`);
  assert.ok(top.quality > unknown.quality, 'but the prestigious one is the better internship');
});

test('interview odds rise with compatibility', () => {
  const good = scoreJob(job({ description: 'React, TypeScript, Node, SQL, Docker, Git.' }), PROFILE);
  const poor = scoreJob(job({ description: 'Verilog, RTOS, embedded C/C++, Kotlin, Scala, Azure.' }), PROFILE);
  assert.ok(good.interviewOdds > poor.interviewOdds);
});

test('interview odds stay inside their stated bounds', () => {
  for (const j of [job(), job({ company: 'Google' }), job({ city: 'sf', country: 'US', term: 'unstated' })]) {
    const { interviewOdds } = scoreJob(j, PROFILE);
    assert.ok(interviewOdds >= 1 && interviewOdds <= 60, `odds out of range: ${interviewOdds}`);
  }
});

// ---- robustness -----------------------------------------------------------

test('scoring is pure — same input, same numbers', () => {
  const j = job({ description: 'React and TypeScript at $40/hr.' });
  assert.deepEqual(scoreJob(j, PROFILE), scoreJob(j, PROFILE));
});

test('a posting with no description still scores, at low confidence', () => {
  const s = scoreJob(job({ description: '' }), PROFILE);
  assert.equal(s.confidence, 'low');
  assert.ok(s.compatibility > 0 && s.compatibility <= 100);
  assert.ok(s.quality > 0 && s.quality <= 100);
  assert.equal(s.signals.pay, null);
});

test('confidence reports how much text the scores rest on', () => {
  assert.equal(scoreJob(job({ description: '' }), PROFILE).confidence, 'low');
  assert.equal(scoreJob(job({ description: 'We use React.' }), PROFILE).confidence, 'medium');
  const long = 'We build with React, TypeScript, Node, SQL and Docker. '.repeat(20);
  assert.equal(scoreJob(job({ description: long }), PROFILE).confidence, 'high');
});

test('scoreJob prefers an explicitly passed description over the job field', () => {
  const j = job({ description: '' });
  const s = scoreJob(j, PROFILE, 'React, TypeScript, Node and SQL at $60/hr.');
  assert.equal(s.signals.pay, '$60/hr');
  assert.notEqual(s.confidence, 'low');
});

test('Ashby structured compensation is used when the prose has none', () => {
  const s = scoreJob(job({ compensation: '$55 - $65 / hr', description: 'A great internship.' }), PROFILE);
  assert.ok(s.signals.pay, 'should have found the structured rate');
});

test('explainScore names the evidence behind the numbers', () => {
  const s = scoreJob(job({ company: 'Stripe', description: 'React and TypeScript, $50/hr.' }), PROFILE);
  const text = explainScore(s);
  assert.match(text, /fit \d+/);
  assert.match(text, /quality \d+/);
  assert.match(text, /~\d+% interview/);
  assert.match(text, /top-tier/);
});
