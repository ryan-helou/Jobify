import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Minimal .env loader (no dependency) — real env vars always win.
try {
  const envFile = fs.readFileSync('.env', 'utf8');
  for (const line of envFile.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {
  /* no .env file — fine */
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Ordered by priority: Montreal, Toronto, New York, San Francisco. The order is
// load-bearing twice over — it sorts the apply queue, and matchCity resolves a
// multi-city posting to the first entry it names, so a "New York / SF" role is
// treated as New York.
// `match` covers the whole commutable metro, not just the city proper: postings
// say "San Jose" or "Sunnyvale" for what is the same Bay Area office market, and
// matching only "San Francisco" silently discarded a third of the Summer 2027
// listings. Suburb names are qualified with a province/state where the bare name
// is ambiguous ("Laval" is also in France, "Waterloo" also in Ontario vs Iowa).
export const CITIES = [
  {
    key: 'montreal',
    name: 'Montreal, QC',
    country: 'CA',
    indeedDomain: 'ca.indeed.com',
    match: /montr[eé]al|laval, ?qc|longueuil/i,
  },
  {
    key: 'toronto',
    name: 'Toronto, ON',
    country: 'CA',
    indeedDomain: 'ca.indeed.com',
    match: /toronto|mississauga|markham|north york|etobicoke|vaughan|waterloo, ?on/i,
  },
  {
    key: 'nyc',
    name: 'New York, NY',
    country: 'US',
    indeedDomain: 'www.indeed.com',
    match: /new york|\bnyc\b|manhattan|brooklyn|jersey city|hoboken/i,
  },
  {
    key: 'sf',
    name: 'San Francisco, CA',
    country: 'US',
    indeedDomain: 'www.indeed.com',
    match: /san francisco|\bsf\b|bay area|san jose|sunnyvale|palo alto|mountain view|menlo park|santa clara|cupertino|redwood city|south san francisco|foster city/i,
  },
];

export const SEARCH_QUERY = 'software engineering internship summer 2027';

// Role must look like an internship / entry-level dev role, and not be for a past/other season.
// The word boundaries are load-bearing: an unanchored /intern/ also matches
// "Internal", "International" and "Internet", which quietly admitted senior
// full-time roles ("Software Engineer - Internal Platform") to the apply queue.
export const ROLE_INCLUDE = /\b(intern(?:ship|s)?|new grad(?:uate)?s?|entry[\s-]?level|co[\s-]?op)\b/i;
export const ROLE_EXCLUDE = /\b20(2[0-6])\b/; // mentions 2020–2026 explicitly → not summer 2027

// Software/developer signal — at least one must be present so we don't apply to
// unrelated internships (finance, design, ops) that merely contain "intern".
export const DEV_INCLUDE =
  /\b(software|swe|sde|developer|dev|engineer|engineering|full[\s-]?stack|front[\s-]?end|back[\s-]?end|firmware|embedded|infrastructure|platform|systems|web|mobile|ios|android|data engineer|machine learning|ml|ai|devops|sre|security|programming|coding|computer science|cs)\b/i;

// Explicitly non-developer roles that can slip past DEV_INCLUDE (e.g. "GTM Engineer",
// "Research Scientist", hardware/design/sales tracks). Skipped even if they say "engineer".
//
// Note the `engineer(?:ing)?` suffixes: "Mechanical Engineer" and "Mechanical
// Engineering Intern" are the same role, but `\bmechanical engineer\b` only matches
// the first — a word boundary can't sit between "engineer" and "ing".
export const NON_DEV_EXCLUDE =
  /\b(research scientist|quantitative research|quant research|go[\s-]?to[\s-]?market|gtm|sales|marketing|merchandising|recruit(?:ing|er|ment)?|talent|analyst|strategist|consultant|field application|solutions? architect|technical writer|product manage(?:r|ment)|product design|program manager|project manager|ux|ui\/ux|graphic|content|community|(?:mechanical|electrical|hardware|civil|chemical|industrial|aerospace) engineer(?:ing)?|biomedical|manufacturing|supply chain|accounting|legal|hr)\b/i;

// A title that names a non-summer season is off-cycle no matter which year it
// gives — the target is Summer 2027 specifically. Guarded against "Spring Boot"
// (a framework) and "waterfall" (no word boundary before "fall").
export const OFF_SEASON_TITLE = /\b(fall|autumn|winter)\b|\bspring\b(?!\s*(?:boot|framework))/i;

// US postings must explicitly mention sponsorship, otherwise skipped.
export const VISA_KEYWORDS = [
  'visa sponsorship',
  'sponsorship available',
  'sponsorship is available',
  'able to sponsor',
  'we sponsor',
  'do sponsor',
  'offer sponsorship',
  'provide sponsorship',
  'will sponsor',
  'willing to sponsor',
  'h1b',
  'h-1b',
  'h1-b',
  'sponsor work visa',
  'sponsor a work visa',
  'sponsor a visa',
  'sponsor visas',
  'work authorization sponsorship',
  'immigration sponsorship',
];

// Phrases that mean "we do NOT sponsor" — their presence forces a skip even if a
// stray keyword above also appears (e.g. "we are unable to provide sponsorship").
export const VISA_NEGATIONS = [
  'unable to sponsor',
  'not able to sponsor',
  'cannot sponsor',
  "can't sponsor",
  'do not sponsor',
  "don't sponsor",
  'not sponsor',
  'no sponsorship',
  'without sponsorship',
  'not provide sponsorship',
  'not offer sponsorship',
  'unable to provide sponsorship',
  'not offer visa sponsorship',
  'not provide visa sponsorship',
  'must be authorized to work',
  'must already be authorized',
  'without the need for sponsorship',
  'do not require sponsorship',
];

// GitHub job boards. Prefer each repo's structured listings.json over its README:
// the JSON carries authoritative `active`, `season`, `sponsorship` and a proper
// locations array, so we filter precisely and skip dead postings before opening
// a browser. Only speedyapply lacks a JSON feed, so it stays on markdown parsing.
//
//   kind: 'internship' → title must say intern/co-op, and season must be Summer
//   kind: 'newgrad'    → the whole board is entry-level, so no intern token is
//                        required; instead reject senior/levelled titles
//
// `term` says how much the source itself guarantees about the hiring cycle. A
// board's *name* is not evidence: SimplifyJobs/Summer2026-Internships is pushed
// daily and looks alive, but its listings are last cycle's, and these repos get
// renamed in place when the cycle turns. Only declare '2027' where the feed
// enforces it (a repo scoped to 2027 whose season field we also filter on).
//
//   term: '2027'   → every posting from this source is Summer 2027 by construction
//   term: 'detect' → unknown; classify each posting from its description
//
// `harvestOnly` sources contribute no jobs at all — we read them purely for the
// company ATS board tokens hidden in their apply URLs. A board can be worthless
// as a job feed (wrong hiring cycle, wrong role type) while still naming hundreds
// of employers whose own Greenhouse/Ashby/Lever boards do carry Summer 2027 roles.
export const GITHUB_SOURCES = [
  {
    name: 'vanshb03/Summer2027-Internships',
    type: 'listings',
    kind: 'internship',
    term: '2027', // repo is 2027-only and we filter season === Summer below
    url: 'https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/dev/.github/scripts/listings.json',
  },
  {
    name: 'speedyapply/2027-SWE-College-Jobs',
    type: 'markdown',
    kind: 'internship',
    term: '2027', // repo is scoped to the 2027 cycle
    url: 'https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/README.md',
  },
  {
    // Full-time new-grad roles, not internships. Mined for board tokens only.
    name: 'SimplifyJobs/New-Grad-Positions',
    type: 'listings',
    harvestOnly: true,
    url: 'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json',
  },
  {
    // Last cycle's internships — never apply to these. But its ~15k postings name
    // the employers who run summer internship programs at all, which is exactly
    // the set of ATS boards worth enumerating for Summer 2027.
    name: 'SimplifyJobs/Summer2026-Internships',
    type: 'listings',
    harvestOnly: true,
    url: 'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json',
  },
];

// ---- hiring-term classification ------------------------------------------
// Only a season+year phrase is trusted to *reject* a posting. A bare year is too
// weak on its own: Summer 2026 listings routinely say "graduating by 2027", so
// treating a stray "2027" as proof would readmit exactly the stale roles we're
// trying to exclude. Anything ambiguous falls through to 'unstated' → a human
// looks at it, rather than being auto-applied or silently dropped.
export const TERM_TARGET = /summer\s*(?:of\s*)?['’]?\s*2027|2027\s+summer/i;
export const TERM_OTHER_SEASON = /(?:summer|fall|autumn|winter|spring)\s*(?:of\s*)?['’]?\s*20(?:1\d|2[0-6])\b/i;
export const YEAR_TARGET = /\b2027\b/;
export const YEAR_PAST = /\b20(?:1\d|2[0-6])\b/;

// Internship boards carry off-cycle seasons too — we only want Summer.
export const WANTED_SEASON = /summer/i;

// New-grad boards mix in levelled and senior roles ("Software Developer 2",
// "Senior Model Validation Analyst"). Those are not entry-level.
export const SENIOR_EXCLUDE =
  /\b(senior|sr\.?|staff|principal|lead|manager|director|head of|vp|vice president|architect|distinguished|fellow)\b|\b(engineer|developer|scientist)\s*(ii|iii|iv|v|[2-9])\b/i;

// Categories on the new-grad board that count as developer work.
export const DEV_CATEGORIES = new Set([
  'Software Engineering',
  'Software',
  'AI/ML/Data',
  'Data Science, AI & Machine Learning',
]);

// Authoritative sponsorship values used by the SimplifyJobs-style feeds.
// 'Other' (and anything unknown) means "not stated" → fall back to reading the page.
export const SPONSORSHIP_VERDICT = {
  'Offers Sponsorship': 'offers',
  'Does Not Offer Sponsorship': 'denies',
  'U.S. Citizenship is Required': 'denies',
};

export const APPLICANT = {
  name: process.env.APPLICANT_NAME || '',
  email: process.env.APPLICANT_EMAIL || '',
  phone: process.env.APPLICANT_PHONE || '',
  linkedin: process.env.APPLICANT_LINKEDIN || '',
  github: process.env.APPLICANT_GITHUB || '',
  website: process.env.APPLICANT_WEBSITE || '',
};

export const RESUME_PATH = path.join(ROOT, 'assets', 'resume.pdf');
export const COVER_LETTER_PDF_PATH = path.join(ROOT, 'assets', 'cover_letter.pdf');
export const COVER_LETTER_TXT_PATH = path.join(ROOT, 'assets', 'cover_letter.txt');
export const APPLIED_JOBS_PATH = path.join(ROOT, 'applied_jobs.json');

export const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
export const DRY_RUN = (process.env.DRY_RUN || 'true').toLowerCase() !== 'false';
// The number of applications actually submitted in a run.
export const MAX_APPLICATIONS_PER_RUN = parseInt(process.env.MAX_APPLICATIONS_PER_RUN || '10', 10);
// A separate, looser bound on how many jobs we'll *look at* to fill that quota.
// Needed because a job can be examined and then skipped (no sponsorship) or handed
// to a human (unsupported ATS) without ever costing an application. Without this,
// a queue full of skips would either submit nothing or grind through everything.
export const MAX_JOBS_EXAMINED_PER_RUN = parseInt(process.env.MAX_JOBS_EXAMINED_PER_RUN || '60', 10);
// Indeed sits behind Cloudflare and is almost always blocked from CI runners, so
// it's off by default. Set ENABLE_INDEED=true to attempt it (best on a residential IP).
export const ENABLE_INDEED = (process.env.ENABLE_INDEED || 'false').toLowerCase() === 'true';

// Company ATS boards (Greenhouse/Lever/Ashby) expose public, unauthenticated JSON
// APIs. We harvest board tokens from the apply URLs the GitHub feeds already give
// us, then enumerate each board directly — that surfaces postings weeks before a
// volunteer adds them to a README, and hands us the description for free, so most
// visa checks no longer need a browser.
export const ENABLE_ATS = (process.env.ENABLE_ATS || 'true').toLowerCase() !== 'false';
export const ATS_CONCURRENCY = parseInt(process.env.ATS_CONCURRENCY || '16', 10);

// Postings whose term we can't determine go to a human instead of being applied
// to or dropped. Cap how many we surface per run so a first run doesn't dump
// hundreds of Slack lines; the rest stay unrecorded and resurface next run.
export const MANUAL_REVIEW_BATCH = parseInt(process.env.MANUAL_REVIEW_BATCH || '20', 10);

// Shared status vocabulary — kept here so the dashboard and the runner agree.
export const STATUS_META = {
  applied: { label: 'Applied', kind: 'success' },
  submitted_unconfirmed: { label: 'Submitted (unconfirmed)', kind: 'warn' },
  manual_review: { label: 'Manual review', kind: 'info' },
  skipped_unknown_required: { label: 'Skipped — unknown field', kind: 'muted' },
  skipped_no_sponsorship: { label: 'Skipped — no sponsorship', kind: 'muted' },
  skipped_closed: { label: 'Skipped — closed', kind: 'muted' },
  skipped_wrong_term: { label: 'Skipped — wrong hiring term', kind: 'muted' },
};

export function coverLetterText() {
  try {
    return fs.readFileSync(COVER_LETTER_TXT_PATH, 'utf8').trim();
  } catch {
    return '';
  }
}

export function validateConfig() {
  const problems = [];
  if (!APPLICANT.name) problems.push('APPLICANT_NAME is not set');
  if (!APPLICANT.email) problems.push('APPLICANT_EMAIL is not set');
  if (!APPLICANT.phone) problems.push('APPLICANT_PHONE is not set');
  if (!fs.existsSync(RESUME_PATH)) problems.push(`resume not found at ${RESUME_PATH}`);
  if (!SLACK_WEBHOOK_URL) problems.push('SLACK_WEBHOOK_URL is not set (notifications disabled)');
  return problems;
}
