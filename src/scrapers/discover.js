import fs from 'node:fs';
import { EMPLOYERS_PATH } from '../config.js';

// Every board we enumerate is one some job board already told us about. That is a
// circular dependency: an employer absent from the GitHub feeds is never queried,
// so we never learn it exists. It bit Canadian coverage hardest — only 7 of 44
// major Canadian tech firms appeared anywhere in the US-centric feeds.
//
// So guess. A company's board slug is almost always its name with the punctuation
// removed, and the four APIs below answer on a deterministic URL. Probing "hopper"
// against Ashby either returns Hopper's 116 postings or a 404; there is no third
// outcome, and a 404 is one cheap request.
//
// Rather than plumb a second token pipeline, this emits *canonical apply URLs* for
// each guess. The existing harvesters already parse a board token out of exactly
// that shape, so a guessed employer flows through the same scrapers, dedup and
// term gate as one that came from a real posting. The URLs are never fetched —
// only their first path segment is read.

const TEMPLATES = [
  (slug) => `https://job-boards.greenhouse.io/${slug}/jobs/0`,
  (slug) => `https://jobs.lever.co/${slug}/0`,
  (slug) => `https://jobs.ashbyhq.com/${slug}/0`,
  (slug) => `https://jobs.smartrecruiters.com/${slug}/0`,
];

// Boards are named inconsistently: "1Password" runs `1password`, Faire runs
// `faire`, NBCUniversal runs `NBCUniversal3`. Cover the cheap variants and let the
// 404s fall where they may.
export function slugVariants(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return [];
  const lower = trimmed.toLowerCase();
  return [
    ...new Set([
      lower.replace(/[^a-z0-9]/g, ''),
      lower.replace(/[^a-z0-9]+/g, '-'),
      trimmed.replace(/[^A-Za-z0-9]/g, ''),
    ]),
  ].filter(Boolean);
}

export function loadEmployers(path = EMPLOYERS_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
    return Array.isArray(parsed.employers) ? parsed.employers : [];
  } catch {
    return []; // no list, no discovery — not an error
  }
}

// Returns { url, company } postings, the same shape the GitHub feeds produce.
export function guessBoardPostings(employers = loadEmployers()) {
  const postings = [];
  for (const company of employers) {
    for (const slug of slugVariants(company)) {
      for (const template of TEMPLATES) postings.push({ url: template(slug), company });
    }
  }
  if (postings.length) {
    console.log(`Discovery: ${employers.length} employers → ${postings.length} candidate boards to probe`);
  }
  return postings;
}
