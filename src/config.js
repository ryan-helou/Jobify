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
export const ROLE_INCLUDE = /intern|new grad|entry[\s-]?level/i;
export const ROLE_EXCLUDE = /\b20(2[0-6])\b/; // mentions 2020–2026 explicitly → not summer 2027

// US postings must explicitly mention sponsorship, otherwise skipped.
export const VISA_KEYWORDS = [
  'visa sponsorship',
  'sponsorship available',
  'sponsorship is available',
  'will sponsor',
  'willing to sponsor',
  'h1b',
  'h-1b',
  'sponsor work visa',
  'sponsor a visa',
  'sponsor visas',
  'immigration sponsorship',
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
