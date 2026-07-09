import fs from 'node:fs';
import {
  DEFAULT_RESUME_VARIANT,
  DEFAULT_ROLE_FAMILY,
  RESUME_COMPANY_HINTS,
  RESUME_FAMILY_VARIANT,
  RESUME_FAMILY_WEIGHT,
  RESUME_MAX_DESCRIPTION_CHARS,
  RESUME_MIN_MARGIN,
  RESUME_MIN_SUPPORT,
  RESUME_SIGNALS,
  RESUME_TITLE_MULTIPLIER,
  RESUME_VARIANTS,
  resumePath,
} from './config.js';
import { roleFamily } from './score.js';

// Picks which résumé to attach to a given posting.
//
// Two sources of evidence, deliberately weighted against each other:
//
//   The title, via roleFamily(). Reliable when it says something ("Backend
//   Engineer Intern"), useless when it doesn't — and most of them don't. Half
//   the internship market posts "Software Engineer Intern" and lets the body
//   explain what the job is.
//
//   The body, via RESUME_SIGNALS. Noisier: a posting mentions Docker because
//   the company uses Docker, not because you'll be writing Dockerfiles. So each
//   signal is counted once per field rather than once per occurrence — a
//   description that says "React" nine times is not nine times more frontend —
//   and the body only overrides the title when it wins by RESUME_MIN_MARGIN.
//
// When nothing speaks clearly, we attach the base résumé. That is the correct
// outcome, not a failure: a generic posting deserves the generic résumé.

/**
 * Deterministic ordering when two variants tie. Prefers the family the title
 * resolved to, then the default, then alphabetical — so the same posting always
 * yields the same résumé, which matters because the choice lands in the ledger.
 */
function tiebreak(a, b, familyVariant) {
  const rank = (v) => (v === familyVariant ? 0 : v === DEFAULT_RESUME_VARIANT ? 1 : 2);
  return rank(a) - rank(b) || a.localeCompare(b);
}

/**
 * Scores every résumé variant against a posting. Pure — no filesystem, no I/O.
 *
 * @returns {{variant: string, family: string, score: number, margin: number,
 *            confident: boolean, matched: string[], scores: Record<string, number>,
 *            reason: string, path: string}}
 */
export function chooseResume(job = {}) {
  const title = String(job.title || '');
  const description = String(job.description || '').slice(0, RESUME_MAX_DESCRIPTION_CHARS);
  const company = String(job.company || '');

  const family = roleFamily(title);
  const familyVariant = RESUME_FAMILY_VARIANT[family] || DEFAULT_RESUME_VARIANT;

  const scores = Object.fromEntries(RESUME_VARIANTS.map((v) => [v, 0]));
  const matched = Object.fromEntries(RESUME_VARIANTS.map((v) => [v, []]));
  // Title evidence is self-corroborating; body evidence is not. Tracked apart.
  const titleHits = Object.fromEntries(RESUME_VARIANTS.map((v) => [v, 0]));

  // The default family is the *absence* of a title signal, not evidence for the
  // base résumé. Scoring it would hand base a 3-point head start that the body
  // could almost never overcome — and "Software Engineer Intern" with a clearly
  // backend description is precisely the posting this router exists to catch.
  // A title that genuinely says "Full Stack" is different, and does score.
  if (family !== DEFAULT_ROLE_FAMILY) {
    scores[familyVariant] += RESUME_FAMILY_WEIGHT;
    matched[familyVariant].push(`title reads as ${family}`);
  }

  for (const [variant, signals] of Object.entries(RESUME_SIGNALS)) {
    for (const { label, re, weight } of signals) {
      // Title first, and `else` — a signal present in both fields scores once,
      // at the title's rate. Otherwise a posting that repeats its own title in
      // the body would double-count every term in it.
      if (re.test(title)) {
        scores[variant] += weight * RESUME_TITLE_MULTIPLIER;
        matched[variant].push(`${label} (title)`);
        titleHits[variant] += 1;
      } else if (re.test(description)) {
        scores[variant] += weight;
        matched[variant].push(label);
      }
    }
  }

  for (const { label, variant, weight, re } of RESUME_COMPANY_HINTS) {
    if (company && re.test(company)) {
      scores[variant] += weight;
      matched[variant].push(`${label} (company)`);
    }
  }

  const ranked = RESUME_VARIANTS.map((variant) => ({ variant, score: scores[variant] })).sort(
    (a, b) => b.score - a.score || tiebreak(a.variant, b.variant, familyVariant)
  );

  const [top, second] = ranked;
  const margin = top.score - (second?.score ?? 0);

  // Two independent bars, and the winner must clear both.
  //
  //   margin  — it beat the runner-up decisively, rather than by a coin flip.
  //   support — it said so more than once. A lone keyword is an aside, not a
  //             job description: "familiarity with HTML/CSS a plus" on a Go
  //             backend role used to score frontend=2, clear the margin, and
  //             send the frontend résumé.
  //
  // A title hit, or being the title's own family, exempts a variant from the
  // support bar. A posting that names the role in its title has corroborated
  // itself, and demanding a second mention would only punish terse postings.
  const titleEvidence = titleHits[top.variant] > 0 || top.variant === familyVariant;
  const supported = titleEvidence || matched[top.variant].length >= RESUME_MIN_SUPPORT;
  const confident = margin >= RESUME_MIN_MARGIN && supported;
  const variant = confident ? top.variant : familyVariant;

  // How the answer was actually reached, which is not the same question as
  // "was it confident". A title that says "Backend" and a body that murmurs
  // "React" is an unconfident *score* and a perfectly decided *résumé*.
  const decidedBy = confident
    ? 'evidence'
    : family !== DEFAULT_ROLE_FAMILY
      ? 'title'
      : 'default';

  const evidence = matched[variant].slice(0, 3);
  const runnerUp = ranked.find((r) => r.variant !== variant && r.score > 0) || null;
  const reason =
    (evidence.length
      ? `${variant} (${evidence.join(', ')})`
      : `${variant} (no role-specific signal in the posting)`) +
    // Recorded because it is the interesting part of a near-miss: months later,
    // "backend, but the body leaned frontend" explains a decision that a bare
    // variant name cannot.
    (runnerUp && !confident ? `; body leaned ${runnerUp.variant} (${runnerUp.score})` : '');

  return {
    variant,
    family,
    score: scores[variant],
    margin,
    confident,
    decidedBy,
    matched: matched[variant],
    runnerUp,
    scores,
    reason,
    path: resumePath(variant),
  };
}

/**
 * chooseResume(), then confirm the file is actually on disk. A variant we picked
 * but never exported degrades to the base résumé rather than attaching nothing —
 * the run should not die because one PDF is missing. `exists` is injectable so
 * this stays testable without touching assets/.
 *
 * If base is missing too, the caller sees a path that doesn't exist and reports
 * `could not attach resume`, which is the existing manual-review path.
 */
export function resolveResume(job, { exists = fs.existsSync } = {}) {
  const choice = chooseResume(job);
  if (exists(choice.path)) return { ...choice, fellBack: false };

  const fallbackPath = resumePath(DEFAULT_RESUME_VARIANT);
  return {
    ...choice,
    variant: DEFAULT_RESUME_VARIANT,
    path: fallbackPath,
    fellBack: true,
    reason: `${choice.reason}; no ${choice.variant} résumé on disk, attached ${DEFAULT_RESUME_VARIANT} instead`,
  };
}
