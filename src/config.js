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

// Ordered by priority — Montreal first.
export const CITIES = [
  { key: 'montreal', name: 'Montreal, QC', country: 'CA', indeedDomain: 'ca.indeed.com', match: /montr[eé]al/i },
  { key: 'toronto', name: 'Toronto, ON', country: 'CA', indeedDomain: 'ca.indeed.com', match: /toronto/i },
  { key: 'sf', name: 'San Francisco, CA', country: 'US', indeedDomain: 'www.indeed.com', match: /san francisco|\bsf\b/i },
  { key: 'nyc', name: 'New York, NY', country: 'US', indeedDomain: 'www.indeed.com', match: /new york|\bnyc\b/i },
];

export const SEARCH_QUERY = 'software engineering internship summer 2027';

// Role must look like an internship / entry-level dev role, and not be for a past/other season.
export const ROLE_INCLUDE = /intern|new grad|entry[\s-]?level|co[\s-]?op/i;
export const ROLE_EXCLUDE = /\b20(2[0-6])\b/; // mentions 2020–2026 explicitly → not summer 2027

// Software/developer signal — at least one must be present so we don't apply to
// unrelated internships (finance, design, ops) that merely contain "intern".
export const DEV_INCLUDE =
  /\b(software|swe|sde|developer|dev|engineer|engineering|full[\s-]?stack|front[\s-]?end|back[\s-]?end|firmware|embedded|infrastructure|platform|systems|web|mobile|ios|android|data engineer|machine learning|ml|ai|devops|sre|security|programming|coding|computer science|cs)\b/i;

// Explicitly non-developer roles that can slip past DEV_INCLUDE (e.g. "GTM Engineer",
// "Research Scientist", hardware/design/sales tracks). Skipped even if they say "engineer".
export const NON_DEV_EXCLUDE =
  /\b(research scientist|quantitative research|quant research|go[\s-]?to[\s-]?market|gtm|sales|marketing|recruit|talent|financial analyst|business analyst|data analyst|product manager|program manager|project manager|ux|ui\/ux|graphic|content|community|mechanical engineer|electrical engineer|hardware engineer|civil engineer|chemical engineer|biomedical|manufacturing|supply chain|operations analyst|accounting|legal|hr\b)\b/i;

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

// GitHub markdown job boards (raw README URLs).
export const GITHUB_SOURCES = [
  {
    name: 'vanshb03/Summer2027-Internships',
    url: 'https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/main/README.md',
  },
  {
    name: 'speedyapply/2027-SWE-College-Jobs',
    url: 'https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/README.md',
  },
];

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
export const MAX_APPLICATIONS_PER_RUN = parseInt(process.env.MAX_APPLICATIONS_PER_RUN || '10', 10);
// Indeed sits behind Cloudflare and is almost always blocked from CI runners, so
// it's off by default. Set ENABLE_INDEED=true to attempt it (best on a residential IP).
export const ENABLE_INDEED = (process.env.ENABLE_INDEED || 'false').toLowerCase() === 'true';

// Shared status vocabulary — kept here so the dashboard and the runner agree.
export const STATUS_META = {
  applied: { label: 'Applied', kind: 'success' },
  submitted_unconfirmed: { label: 'Submitted (unconfirmed)', kind: 'warn' },
  manual_review: { label: 'Manual review', kind: 'info' },
  skipped_unknown_required: { label: 'Skipped — unknown field', kind: 'muted' },
  skipped_no_sponsorship: { label: 'Skipped — no sponsorship', kind: 'muted' },
  skipped_closed: { label: 'Skipped — closed', kind: 'muted' },
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
