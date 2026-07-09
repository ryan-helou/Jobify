import { TERM_TARGET, TERM_OTHER_SEASON, YEAR_TARGET, YEAR_PAST, OFF_SEASON_TITLE } from './config.js';

// Which hiring cycle a posting is for: '2027' | 'other-cycle' | 'unstated'.
//
// Evidence is ranked, because the cheap signals lie. A posting titled "Software
// Engineer Intern" with no year could be Summer 2027, a Fall 2026 co-op, or a
// leftover from last spring, and roughly 85% of live intern postings look exactly
// like that. So:
//
//   1. A season+year phrase ("Summer 2027", "Fall 2026") is the only evidence
//      strong enough to accept or reject on its own.
//   2. If a posting names both our term and another, a human decides.
//   3. Failing that, a bare year only ever *accepts* — never rejects. Summer 2026
//      postings commonly say "graduating by 2027", so a bare past year proves
//      nothing, and rejecting on it would throw away good roles.
//
// Everything left over is 'unstated', which the caller routes to manual review.
export function classifyTerm(text) {
  const t = String(text || '');
  if (!t.trim()) return 'unstated';

  const wantsTerm = TERM_TARGET.test(t);
  const otherTerm = TERM_OTHER_SEASON.test(t);

  if (wantsTerm && !otherTerm) return '2027';
  if (otherTerm && !wantsTerm) return 'other-cycle';
  if (wantsTerm && otherTerm) return 'unstated'; // names both — ambiguous, needs eyes

  if (YEAR_TARGET.test(t) && !YEAR_PAST.test(t)) return '2027';
  return 'unstated';
}

// Classify a posting whose season isn't declared by a feed, using the description
// for evidence and the title as a tiebreak. "Rust Engineering Intern - Fall" never
// names a year, so classifyTerm alone calls it unstated — but a title that names
// an off-summer season is off-cycle regardless of year. Only consulted when the
// text was ambiguous, so an explicit "Summer 2027" still wins.
export function classifyPosting(title, description) {
  const term = classifyTerm(`${title || ''} ${description || ''}`);
  if (term === 'unstated' && OFF_SEASON_TITLE.test(title || '')) return 'other-cycle';
  return term;
}

// A source can vouch for the hiring *cycle* of its postings, but not the season:
// speedyapply/2027-SWE-College-Jobs is scoped to 2027 and still lists "Software
// Engineer Winter Co-Op". A declared source therefore still gets the off-season
// title check, unless the title explicitly names our term.
export function termForSource(source, title) {
  if (source?.term === 'exempt') return 'exempt';
  if (source?.term === '2027') {
    if (!TERM_TARGET.test(title || '') && OFF_SEASON_TITLE.test(title || '')) return 'other-cycle';
    return '2027';
  }
  return classifyTerm(title);
}
