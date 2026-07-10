import {
  SKILL_LEXICON,
  ROLE_FAMILIES,
  DEFAULT_ROLE_FAMILY,
  QUALITY_SIGNALS,
  QUALITY_RED_FLAGS,
  PAY_PATTERN,
  PAY_CURVE,
  PAY_UNSTATED_SCORE,
  HOURS_PER_MONTH,
  HOURS_PER_YEAR,
  TOP_TIER_COMPANIES,
  STRONG_TIER_COMPANIES,
  ODDS_BASE_RATE,
  ODDS_FLOOR,
  ODDS_CEILING,
  CANDIDATE,
} from './config.js';
import { feedSponsorshipVerdict, mentionsSponsorship } from './visa.js';

// Three numbers per posting.
//
//   compatibility — how well this candidate fits this posting        [0..100]
//   quality       — how good the internship is, candidate-independent [0..100]
//   interviewOdds — P(application → first-round interview), percent   [1..60]
//
// What these are worth, stated plainly, because a number on a dashboard invites
// more trust than it has earned:
//
//   `compatibility` is the honest one. It compares a posting's stated
//   requirements against a declared skill list. Both sides are text we can read.
//
//   `quality` is a defensible aggregate of things a good internship tends to
//   say about itself (pay, return offers, mentorship, real production work) plus
//   an editable opinion about company prestige. Reasonable people would weight
//   it differently.
//
//   `interviewOdds` is a heuristic prior, NOT a calibrated probability. Nothing
//   in this repo records whether an application ever led to an interview —
//   applied_jobs.json stores submissions, not outcomes — so there is no ground
//   truth to fit against. It is a base rate multiplied by factors chosen by
//   hand. Treat it as a *ranking* signal, useful for deciding which of two
//   postings to spend an application on, and not as a forecast. If you ever
//   start recording outcomes, this function is where to fit a real model.
//
// Every score degrades gracefully when the description is missing (the GitHub
// listings feeds carry none), which is what `confidence` reports.

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round = (n) => Math.round(clamp(n, 0, 100));

// Piecewise-linear lookup over an ascending [[x, y], ...] curve.
function interpolate(curve, x) {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x0, y0] = curve[i - 1];
    const [x1, y1] = curve[i];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return curve[curve.length - 1][1];
}

// "Jane Street Capital, Inc." → "janestreetcapital". Only *trailing* legal
// suffixes are stripped: "Labs" and "Technologies" are load-bearing parts of
// real company names ("Haize Labs"), so removing them everywhere would collide
// distinct employers.
const LEGAL_SUFFIX = /\s*\b(inc|llc|ltd|corp|corporation|plc|gmbh|nv|sa|co)\.?\s*$/i;
export function normalizeCompany(name) {
  let s = (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  let prev;
  do {
    prev = s;
    s = s.replace(/,\s*$/, '').replace(LEGAL_SUFFIX, '');
  } while (s !== prev);
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function companyTier(company) {
  const key = normalizeCompany(company);
  if (!key) return 'unknown';
  if (TOP_TIER_COMPANIES.has(key)) return 'top';
  if (STRONG_TIER_COMPANIES.has(key)) return 'strong';
  return 'unknown';
}

// Which canonical skills a posting names. Order follows SKILL_LEXICON so the
// output is stable across runs (it lands in the committed ledger).
export function detectSkills(text) {
  const t = String(text || '');
  if (!t.trim()) return [];
  return Object.entries(SKILL_LEXICON)
    .filter(([, re]) => re.test(t))
    .map(([skill]) => skill);
}

export function roleFamily(title) {
  const t = String(title || '');
  const hit = ROLE_FAMILIES.find(([, re]) => re.test(t));
  return hit ? hit[0] : DEFAULT_ROLE_FAMILY;
}

// Normalizes any stated pay to an hourly equivalent. Returns null when the text
// never states one, which is the common case and must not be read as "$0".
export function parsePay(text) {
  const m = PAY_PATTERN.exec(String(text || ''));
  if (!m) return null;

  const [, lo, loK, hi, hiK, unit] = m;
  const num = (raw, k) => {
    const n = parseFloat(String(raw).replace(/,/g, ''));
    return Number.isFinite(n) ? n * (k ? 1000 : 1) : NaN;
  };

  const low = num(lo, loK);
  const high = hi ? num(hi, hiK) : NaN;
  if (!Number.isFinite(low)) return null;
  // A range takes its midpoint; a malformed upper bound falls back to the lower.
  const amount = Number.isFinite(high) && high >= low ? (low + high) / 2 : low;

  const period = unit.toLowerCase();
  let hourly;
  if (period === 'hour' || period === 'hr') hourly = amount;
  else if (period === 'month' || period === 'mo') hourly = amount / HOURS_PER_MONTH;
  else hourly = amount / HOURS_PER_YEAR;

  // Sanity window. Descriptions are full of dollar figures that aren't wages
  // ("our customers save $10,000 per year", "$2B raised"), and a stray match
  // would dominate the pay score. Nothing in these markets pays an intern under
  // $5/hr or over $500/hr, so anything outside that isn't a wage — drop it and
  // fall back to "unstated" rather than scoring the posting on noise.
  if (!Number.isFinite(hourly) || hourly < 5 || hourly > 500) return null;
  return { hourly, raw: m[0].trim(), period };
}

// ---- compatibility --------------------------------------------------------

// How many technologies a posting must name before its skill overlap is taken
// at face value. Below this, the observed ratio is shrunk toward a neutral prior
// in proportion to how much evidence there actually is:
//
//   0 named  → pure prior (55). A posting that lists no technologies has told us
//              nothing; scoring it 0 would punish it for being terse, and every
//              description-less GitHub-feed job lands here.
//   1 named  → ⅓ observation, ⅔ prior
//   3+ named → pure observation
//
// The earlier version returned a flat 55 for anything under the floor, which
// ignored the matches it had: a posting naming two technologies the candidate
// doesn't know scored the same as one naming none.
const SKILL_EVIDENCE_FLOOR = 3;
const NEUTRAL_SKILL_FIT = 55;

function skillFit(text, profile) {
  const required = detectSkills(text);
  const have = new Set(profile.skills);
  const strong = new Set(profile.strongSkills);
  const matched = required.filter((s) => have.has(s));
  const thin = required.length < SKILL_EVIDENCE_FLOOR;

  if (!required.length) return { score: NEUTRAL_SKILL_FIT, matched, required, thin };

  // Raw overlap, curved: a posting lists everything it touches, so matching 7 of
  // 10 is a strong fit, not a 70% one. The exponent below 1 rewards that.
  const ratio = matched.length / required.length;
  let observed = 100 * Math.pow(ratio, 0.8);

  // Matching the skills you'd actually be interviewed on counts for more than
  // matching an incidental mention of Docker.
  const strongHits = matched.filter((s) => strong.has(s)).length;
  observed += Math.min(10, strongHits * 3.5);

  const weight = Math.min(1, required.length / SKILL_EVIDENCE_FLOOR);
  const score = observed * weight + NEUTRAL_SKILL_FIT * (1 - weight);

  return { score: clamp(score, 0, 100), matched, required, thin };
}

function roleFit(title, profile) {
  const family = roleFamily(title);
  const i = profile.preferredFamilies.indexOf(family);
  if (i < 0) return { score: 40, family };
  return { score: clamp(100 - i * 8, 30, 100), family };
}

// Can this candidate actually take the job? Term and work authorization.
//
// A *multiplier*, not a weighted component, and city is absent entirely. Both
// choices are corrections to an earlier version that scored eligibility and
// location as 20%-weighted additive terms:
//
//   - Every posting that survives scraping is already in a target city and past
//     the term gate, so those terms were near-max for nearly everything. They
//     put a ~60-point floor under the score, compressing the whole range into
//     60–97 — an unpaid Verilog role scored 66 against a React candidate.
//   - Additive is the wrong shape anyway. Being unable to take a job is not
//     worth "minus twenty points"; it should collapse the score.
//
// City preference still decides the apply order — it's the primary sort key in
// index.js — it just isn't part of how well you *fit* the work.
// A posting the candidate cannot hold. Compatibility read skills and city but never
// the *level* of the role, so Marvell's "Analog Engineer Intern — PhD" scored 66 and
// D2L's "Software Developer — New Graduate" scored 72 — above real internships an
// undergraduate could actually take. Skill overlap is irrelevant when the door is
// shut, so these multiply rather than subtract.
//
// Graduate-only and new-grad postings are near-disqualifying, not merely worse: a
// second-year undergraduate is not eligible, and a full-time new-grad role is not an
// internship at all. `advanced` also catches "Master's or PhD required".
export const LEVEL_PATTERNS = {
  phd: /\bph\.?d\b|\bdoctoral\b|\bdoctorate\b/i,
  masters: /\bmaster'?s?\b(?!\s*of\s*none)|\bm\.?s\.?c?\.?\s+(?:required|student|candidate)/i,
  // "New Grads" plural: `grad(uate)?\b` fails between the d and the s, so a posting
  // titled "Software Engineer - 2027 New Grads" scored 85 on a real board.
  newGrad: /\bnew\s*grad(?:uate)?s?\b|\bentry[\s-]*level\b|\bcampus\s*hire\b|\bgraduate\s+(?:programme?|scheme)\b/i,
  senior: /\bsenior\b|\bstaff\b|\bprincipal\b|\blead\s+engineer\b|\b\d+\+?\s*years?\s+of\s+experience\b/i,
};

// A body that merely *mentions* a PhD proves nothing: "BS, MS, or PhD in Computer
// Science" lists a doctorate as acceptable, not required, and matching on the bare
// word demoted 22 postings on a real board — including a plain "Fullstack Engineer
// Intern". So the body must state a requirement, and must not also welcome an
// undergraduate degree.
const PHD_REQUIRED =
  /\b(?:requires?|required|must\s+(?:be|have|hold)|open\s+only\s+to)\b[^.]{0,60}\bph\.?d\b|\bph\.?d\b[^.]{0,40}\b(?:is\s+)?(?:required|mandatory|only)\b/i;
const UNDERGRAD_WELCOME = /\bbachelor'?s?\b|\bb\.?s\.?c?\.?\b|\bundergrad(?:uate)?\b/i;

// A posting that says "intern" is an internship even if the body namechecks a PhD.
// The title is the contract; the body is context.
function levelMismatch(title, description) {
  const t = String(title || '');
  const body = String(description || '');

  if (LEVEL_PATTERNS.phd.test(t)) return { factor: 0.15, reason: 'requires a PhD' };
  if (LEVEL_PATTERNS.newGrad.test(t)) return { factor: 0.2, reason: 'new-grad role, not an internship' };
  if (LEVEL_PATTERNS.senior.test(t)) return { factor: 0.15, reason: 'senior role' };
  if (LEVEL_PATTERNS.masters.test(t)) return { factor: 0.35, reason: "requires a Master's" };

  // Body evidence is weaker than a title, so it dampens rather than disqualifies.
  if (PHD_REQUIRED.test(body) && !UNDERGRAD_WELCOME.test(body)) {
    return { factor: 0.7, reason: 'posting states a PhD is required' };
  }
  return { factor: 1, reason: null };
}

function eligibilityMultiplier(job, description) {
  const term = job.term === '2027' || job.term === 'exempt' ? 1 : job.term === 'unstated' ? 0.9 : 0.3;

  let visa = 1; // Canadian postings need no sponsorship
  if (job.country === 'US') {
    const verdict = feedSponsorshipVerdict(job);
    if (verdict === 'offers') visa = 1;
    else if (verdict === 'denies') visa = 0.4;
    else visa = mentionsSponsorship(description) ? 1 : 0.85; // silence ≠ refusal
  }

  const level = levelMismatch(job.title, description);
  return { multiplier: term * visa * level.factor, levelReason: level.reason };
}

const COMPAT_WEIGHTS = { skill: 0.6, role: 0.4 };

// ---- quality --------------------------------------------------------------

// No location or eligibility term here: `quality` answers "is this a good
// internship", which cannot depend on which city *this* candidate prefers or
// whether *this* candidate needs a visa. Those belong to compatibility.
const QUALITY_WEIGHTS = { pay: 0.35, program: 0.3, substance: 0.2, company: 0.15 };
const TIER_QUALITY = { top: 95, strong: 78, unknown: 55 };
const RED_FLAG_CEILING = 25;

function payScore(text, job) {
  // Ashby hands us a parsed compensation summary; everything else hides the
  // number in prose, if it states one at all.
  const pay = parsePay(job.compensation || '') || parsePay(text);
  if (!pay) return { score: PAY_UNSTATED_SCORE, pay: null };
  return { score: interpolate(PAY_CURVE, pay.hourly), pay };
}

// ---- interview odds -------------------------------------------------------

// Prestige cuts both ways: a top-tier name raises `quality` and sinks the odds,
// because everyone else applied there too.
const TIER_COMPETITION = { top: 0.4, strong: 0.7, unknown: 1.3 };

// How early in a posting's life we reached it. A company's own ATS board lists a
// job days before a volunteer copies it into a README, and applying early is one
// of the few levers an applicant actually has.
function channelMultiplier(source) {
  if (String(source || '').startsWith('ats:')) return 1.25;
  if (source === 'indeed') return 0.8; // aggregator; the posting has been up a while
  return 1.0;
}

// ---- public API -----------------------------------------------------------

/**
 * Scores a posting. Pure: same job + profile + description → same numbers.
 * `description` falls back to job.description, so this is safe to call before
 * and after a page fetch — call it again once you have the text.
 */
export function scoreJob(job, profile = CANDIDATE, description = null) {
  const desc = description ?? job.description ?? '';
  const text = `${job.title || ''}\n${desc}`;

  // --- compatibility
  const skill = skillFit(text, profile);
  const role = roleFit(job.title, profile);
  const { multiplier: eligibility, levelReason } = eligibilityMultiplier(job, desc);

  const compatibility = round((skill.score * COMPAT_WEIGHTS.skill + role.score * COMPAT_WEIGHTS.role) * eligibility);

  // --- quality
  const tier = companyTier(job.company);
  const { score: pay, pay: parsedPay } = payScore(desc, job);

  const signal = (re) => re.test(desc);
  const program =
    40 +
    (signal(QUALITY_SIGNALS.returnOffer) ? 25 : 0) +
    (signal(QUALITY_SIGNALS.mentorship) ? 20 : 0) +
    (signal(QUALITY_SIGNALS.cohort) ? 10 : 0) +
    (signal(QUALITY_SIGNALS.relocation) ? 5 : 0);

  const substance = 45 + (signal(QUALITY_SIGNALS.ship) ? 35 : 0) + (signal(QUALITY_SIGNALS.review) ? 20 : 0);

  const flags = Object.entries(QUALITY_RED_FLAGS)
    .filter(([, re]) => re.test(desc))
    .map(([name]) => name);

  let quality = round(
    pay * QUALITY_WEIGHTS.pay +
      program * QUALITY_WEIGHTS.program +
      substance * QUALITY_WEIGHTS.substance +
      TIER_QUALITY[tier] * QUALITY_WEIGHTS.company
  );
  // An unpaid or credit-only internship is a bad internship regardless of how
  // well the rest of the posting reads.
  if (flags.length) quality = Math.min(quality, RED_FLAG_CEILING);

  // How much text the scores actually rest on. `low` means the posting had no
  // description, so `quality` is mostly company tier and `compatibility` is
  // mostly title and location.
  const confidence = !desc.trim() ? 'low' : desc.length > 800 && !skill.thin ? 'high' : 'medium';

  // --- interview odds (see the header comment: a prior, not a forecast)
  //
  // Two changes make this less dishonest than it was, without pretending it is
  // calibrated. It now inherits the level penalty through `compatibility`, so a
  // PhD-only posting no longer advertises a double-digit chance at an interview.
  // And it shrinks toward the base rate in proportion to the evidence behind it:
  // a posting with no description moves the prior barely at all, because every
  // factor below was computed from a title and a company name.
  const compatMult = 0.4 + 1.4 * Math.pow(compatibility / 100, 1.3);
  const qualityMult = 1.1 - 0.25 * (quality / 100); // desirable roles draw more applicants
  const raw = ODDS_BASE_RATE * compatMult * TIER_COMPETITION[tier] * channelMultiplier(job.source) * qualityMult;

  const evidence = { high: 1, medium: 0.7, low: 0.4 }[confidence];
  const shrunk = ODDS_BASE_RATE + (raw - ODDS_BASE_RATE) * evidence;

  const odds = clamp(shrunk, ODDS_FLOOR, ODDS_CEILING);
  const interviewOdds = Math.max(1, Math.round(odds * 100));

  return {
    compatibility,
    quality,
    interviewOdds,
    confidence,
    signals: {
      matchedSkills: skill.matched,
      requiredSkills: skill.required,
      family: role.family,
      tier,
      pay: parsedPay ? parsedPay.raw : null,
      flags,
      // Why an otherwise-good posting scored near zero. Without this a PhD-only
      // role just looks mysteriously bad on the board.
      levelReason,
    },
  };
}

// One-line explanation for Slack and the dashboard tooltip.
export function explainScore(scores) {
  const s = scores.signals;
  const bits = [`fit ${scores.compatibility}`, `quality ${scores.quality}`, `~${scores.interviewOdds}% interview`];
  if (s.matchedSkills.length) bits.push(`matches ${s.matchedSkills.slice(0, 5).join(', ')}`);
  if (s.pay) bits.push(s.pay);
  if (s.tier !== 'unknown') bits.push(`${s.tier}-tier`);
  if (s.flags.length) bits.push(`⚠ ${s.flags.join(', ')}`);
  if (scores.confidence === 'low') bits.push('low confidence — no description');
  return bits.join(' · ');
}
