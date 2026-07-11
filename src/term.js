import { TERM_TARGET, TERM_OTHER_SEASON, YEAR_TARGET, YEAR_PAST, OFF_SEASON_TITLE } from './config.js';

// A start date names the hiring cycle as surely as a season phrase does: an internship
// you begin in September 2026 is the Fall 2026 cohort; one you begin in May 2027 is
// Summer 2027. Postings routinely give only this — "Are you able to start September
// 2026?", "Start date: May 2027", "September 2026 – December 2026" — and no season
// phrase at all, so without reading the date they sit in 'unstated' forever.
//
// Everything here is bilingual: Montreal is the first-priority city and Quebec postings
// are frequently in French ("Stage été 2027", "à partir de septembre 2026"), so the
// French season words, month names, and start phrases are matched alongside the English.

// Month token → the co-op season its *start* opens, or null. English and French stems
// both resolve here. Ambiguous months (August/août, November, December/décembre) return
// null so we never guess from them.
function monthSeason(raw) {
  const s = String(raw).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // strip accents: aout, fevrier
  if (/^jan/.test(s)) return 'winter'; // january, janvier
  if (/^fe[bv]/.test(s)) return 'winter'; // february, février
  if (/^mar/.test(s)) return 'spring'; // march, mars
  if (/^a(?:pr|vr)/.test(s)) return 'spring'; // april, avril
  if (/^ma[iy]$/.test(s)) return 'summer'; // may, mai
  if (/^ju(?:n|in)/.test(s)) return 'summer'; // june, juin
  if (/^ju(?:l|il)/.test(s)) return 'summer'; // july, juillet
  if (/^sep/.test(s)) return 'fall'; // september, septembre
  if (/^oct/.test(s)) return 'fall'; // october, octobre
  return null; // aug/août, nov, dec/décembre, unknown → no inference
}

const MONTHS =
  'jan(?:uary|vier)?|f[eé]v(?:rier|ruary)?|feb(?:ruary)?|mar(?:ch|s)?|a(?:pr|vr)(?:il)?|may|mai|jun(?:e)?|juin|jul(?:y)?|juil(?:let)?|aug(?:ust)?|ao[uû]t|sep(?:t(?:ember|embre)?)?|oct(?:ober|obre)?|nov(?:ember|embre)?|d[eé]c(?:ember|embre)?';
const MONTH_YEAR = new RegExp(`\\b(${MONTHS})\\.?\\s*,?\\s*(20\\d{2})\\b`, 'gi');
// A "Month – Month Year" range whose year sits on the *second* month ("September –
// December 2026", "mai à août 2027"). The first month names the season, the trailing
// year dates it. French uses "à"/"au" as the range separator.
const SEASON_RANGE = new RegExp(`\\b(${MONTHS})\\.?\\s*(?:-|–|—|to|through|until|à|au)\\s*(?:${MONTHS})\\.?\\s*,?\\s*(20\\d{2})\\b`, 'gi');
// The month/year only names a term when it's actually a *start*: anchored by a start
// word beside it, or by being the front of a date range. "Apply by September 2026" and
// "founded September 2010" must not qualify — they aren't start dates. French start
// cues: débuter, commencer, à partir de, à compter de, dès, disponible.
const START_WORD =
  /\bstart(?:s|ing|ed|\s+date)?\b|\bbegin(?:s|ning)?\b|\bcommenc\w*|\b(?:able|available)\s+to\b|\bd[eé]but\w*|\bà\s+(?:partir|compter)\b|\bd[eè]s\b|\bdisponible\b/i;
const RANGE_TAIL = new RegExp(`^\\s*(?:-|–|—|to|through|until|à|au)\\s*(?:${MONTHS})`, 'i');

// French season+year, the counterpart to config's English TERM_TARGET / TERM_OTHER_SEASON.
// "été" needs a lookbehind rather than \b: it isn't preceded by an ASCII word char, and
// without the guard it would fire inside "complété 2027" (completed, not summer).
const FR_SUMMER = "(?<![a-zà-ÿ])[eé]t[eé]";
const FR_TARGET = new RegExp(`${FR_SUMMER}\\s*(?:de\\s*)?2027\\b`, 'i'); // été 2027
const FR_OTHER_SEASON = new RegExp(
  `\\b(?:automne|hiver|printemps)\\s*(?:de\\s*)?20\\d{2}\\b|${FR_SUMMER}\\s*(?:de\\s*)?20(?:1\\d|2[0-6])\\b`,
  'i'
); // automne/hiver/printemps of any year, or été of a past year

// Returns '2027' | 'other-cycle' inferred from a start date, or null when there is no
// start date — or when several disagree, in which case a human should decide.
export function termFromStartDate(text) {
  const t = String(text || '');
  const terms = new Set();
  const add = (monthWord, year) => {
    const season = monthSeason(monthWord);
    if (season) terms.add(season === 'summer' && year === '2027' ? '2027' : 'other-cycle');
  };

  // Single dated month, only counted when a start word sits beside it or it opens a
  // "Month Year – Month Year" range.
  for (const m of t.matchAll(MONTH_YEAR)) {
    const before = t.slice(Math.max(0, m.index - 24), m.index);
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 24);
    if (START_WORD.test(before) || /^\s*start\b/i.test(after) || RANGE_TAIL.test(after)) add(m[1], m[2]);
  }
  // "Month – Month Year" range whose year is on the second month. Only the first
  // month and the trailing year are captured (the second month is non-capturing),
  // so the year is m[2].
  for (const m of t.matchAll(SEASON_RANGE)) add(m[1], m[2]);

  return terms.size === 1 ? [...terms][0] : null;
}

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

  const wantsTerm = TERM_TARGET.test(t) || FR_TARGET.test(t);
  const otherTerm = TERM_OTHER_SEASON.test(t) || FR_OTHER_SEASON.test(t);

  if (wantsTerm && !otherTerm) return '2027';
  if (otherTerm && !wantsTerm) return 'other-cycle';
  if (wantsTerm && otherTerm) return 'unstated'; // names both — ambiguous, needs eyes

  // No explicit season+year phrase. A start date is the next-strongest evidence — it
  // pins the cycle even when the posting never names a season ("start September 2026"
  // → Fall 2026) — so it's consulted before the weak bare-year signal below.
  const byStart = termFromStartDate(t);
  if (byStart) return byStart;

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
