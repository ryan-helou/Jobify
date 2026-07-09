import { chromium } from 'playwright';
import {
  CANDIDATE,
  CITIES,
  DRY_RUN,
  ENABLE_ATS,
  ENABLE_DISCOVERY,
  ENABLE_INDEED,
  ENABLE_ORACLE,
  ENABLE_SMARTRECRUITERS,
  ENABLE_WORKDAY,
  MANUAL_REVIEW_BATCH,
  MAX_APPLICATIONS_PER_RUN,
  MAX_JOBS_EXAMINED_PER_RUN,
  MIN_COMPATIBILITY,
  APPLY_UNSTATED_TERM,
  validateConfig,
} from './config.js';
import { loadTracker, identityKey, canonicalKey } from './tracker.js';
import { scrapeGithubBoards } from './scrapers/github.js';
import { scrapeAtsBoards } from './scrapers/ats.js';
import { scrapeWorkday } from './scrapers/workday.js';
import { scrapeOracle } from './scrapers/oracle.js';
import { scrapeSmartRecruiters } from './scrapers/smartrecruiters.js';
import { guessBoardPostings } from './scrapers/discover.js';
import { scrapeIndeed, fetchIndeedJobDetails } from './scrapers/indeed.js';
import { applyToJob, supportedAts } from './apply/index.js';
import { sponsorshipStance, fetchPostingText, feedSponsorshipVerdict } from './visa.js';
import { scoreJob, explainScore } from './score.js';
import { slack, notifyApplied, notifySummary } from './notify.js';

const CITY_PRIORITY = Object.fromEntries(CITIES.map((c, i) => [c.key, i]));

// Within a city, spend the application budget on the best-fitting jobs first.
// City still dominates — a mediocre Montreal role beats a perfect SF one, since
// the SF role costs a visa and a move.
const byCityThenFit = (a, b) =>
  CITY_PRIORITY[a.city] - CITY_PRIORITY[b.city] || b.scores.compatibility - a.scores.compatibility;

async function main() {
  const { fatal, warnings } = validateConfig();
  if (warnings.length) console.warn('Config warnings:\n - ' + warnings.join('\n - '));
  if (fatal.length) {
    // Applications are irreversible and get recorded as applied, so a broken
    // résumé would silently poison the whole run. Refuse to start, even on a dry
    // run — a dry run that passes with a bad résumé teaches you nothing.
    console.error('Config errors:\n - ' + fatal.join('\n - '));
    await slack(`:warning: Jobify run aborted — ${fatal.join('; ')}`);
    process.exit(1);
  }
  console.log(`Jobify run starting (dry run: ${DRY_RUN})`);

  const tracker = loadTracker();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    locale: 'en-US',
  });

  const counts = { found: 0, applied: 0, manual: 0, skipped: 0, wrongTerm: 0, lowFit: 0 };

  try {
    // 1. Scrape sources. The GitHub boards run first because their apply URLs are
    //    what tell us which company ATS boards exist. Discovery adds employers no
    //    board has named, so its guesses join the same pool before enumeration.
    //    Indeed needs the shared browser and is opt-in; it's usually blocked in CI.
    const { jobs: githubJobs, postings: boardPostings } = await scrapeGithubBoards();
    const postings = ENABLE_DISCOVERY ? [...boardPostings, ...guessBoardPostings()] : boardPostings;

    const [atsJobs, workdayJobs, oracleJobs, srJobs, indeedJobs] = await Promise.all([
      ENABLE_ATS ? scrapeAtsBoards(postings) : Promise.resolve([]),
      ENABLE_WORKDAY ? scrapeWorkday(postings) : Promise.resolve([]),
      ENABLE_ORACLE ? scrapeOracle(postings) : Promise.resolve([]),
      ENABLE_SMARTRECRUITERS ? scrapeSmartRecruiters(postings) : Promise.resolve([]),
      ENABLE_INDEED ? scrapeIndeed(context) : Promise.resolve([]),
    ]);
    if (!ENABLE_ATS) console.log('ATS board enumeration disabled (set ENABLE_ATS=true to enable).');
    if (!ENABLE_WORKDAY) console.log('Workday enumeration disabled (set ENABLE_WORKDAY=true to enable).');
    if (!ENABLE_ORACLE) console.log('Oracle enumeration disabled (set ENABLE_ORACLE=true to enable).');
    if (!ENABLE_SMARTRECRUITERS) console.log('SmartRecruiters enumeration disabled (set ENABLE_SMARTRECRUITERS=true).');
    if (!ENABLE_INDEED) console.log('Indeed scraping disabled (set ENABLE_INDEED=true to attempt it).');

    // 2. Dedup against the ledger and within this run. The same posting shows up
    //    on multiple boards under different URLs, so we also key on identity
    //    (company + title + city) to avoid applying twice. GitHub jobs come first
    //    so a curated source's declared term wins over the ATS copy's guess.
    const seenUrls = new Set();
    const seenIdentities = new Set();
    const fresh = [];
    for (const job of [...githubJobs, ...atsJobs, ...workdayJobs, ...oracleJobs, ...srJobs, ...indeedJobs]) {
      const identity = identityKey(job);
      if (tracker.has(job.url) || tracker.hasIdentity(identity)) continue;
      if (seenUrls.has(canonicalKey(job.url)) || seenIdentities.has(identity)) continue;
      seenUrls.add(canonicalKey(job.url));
      seenIdentities.add(identity);
      fresh.push(job);
    }
    // Score every posting up front. It's pure and cheap — no network — and the
    // ATS sources already carry descriptions, so most jobs get a well-evidenced
    // score here. The rest are re-scored below once a description is fetched.
    for (const job of fresh) job.scores = scoreJob(job, CANDIDATE);

    fresh.sort(byCityThenFit); // Montreal first, best fit first within each city
    counts.found = fresh.length;
    console.log(
      `${fresh.length} new jobs after dedup ` +
        `(${githubJobs.length} github, ${atsJobs.length} ats, ${workdayJobs.length} workday, ` +
        `${oracleJobs.length} oracle, ${srJobs.length} smartrecruiters, ${indeedJobs.length} indeed scraped)`
    );

    // 3. Gate on hiring term before spending anything on a posting. A board's name
    //    is not evidence of its cycle, so this is what stops last season's roles
    //    from reaching the applier.
    const wrongTerm = fresh.filter((j) => j.term === 'other-cycle');
    // With APPLY_UNSTATED_TERM on, term-ambiguous postings join the apply queue
    // instead of the review queue. `fresh` is already in city-then-fit order, so
    // they interleave by merit rather than landing behind every stated posting.
    const unstated = APPLY_UNSTATED_TERM ? [] : fresh.filter((j) => j.term === 'unstated');
    const eligible = fresh.filter(
      (j) => j.term === '2027' || j.term === 'exempt' || (APPLY_UNSTATED_TERM && j.term === 'unstated')
    );
    console.log(`term gate: ${eligible.length} eligible, ${unstated.length} unstated, ${wrongTerm.length} wrong cycle`);

    for (const job of wrongTerm) {
      console.log(`  → skipped (wrong term): ${job.title} @ ${job.company}`);
      if (!DRY_RUN) tracker.add(job, 'skipped_wrong_term', 'posting names a non-2027 season');
      counts.wrongTerm++;
    }

    // Postings that never say which term they're for go to a human, not the
    // applier. Batched into one Slack message and capped — the uncapped remainder
    // stays out of the ledger so it resurfaces next run. `unstated` inherits the
    // city-then-fit order, so the cap spends a human's attention on the best of
    // them rather than on whichever board happened to be scraped first.
    const review = unstated.slice(0, MANUAL_REVIEW_BATCH);
    if (review.length) {
      const lines = review.map(
        (j) =>
          `• <${j.applyUrl || j.url}|${j.title}> — *${j.company}* (${j.location})` +
          `  _fit ${j.scores.compatibility} · quality ${j.scores.quality} · ~${j.scores.interviewOdds}% interview_`
      );
      await slack(
        `:mag: ${review.length} posting(s) don't state a hiring term — worth a look` +
          (unstated.length > review.length ? ` _(${unstated.length - review.length} more next run)_` : '') +
          `\n${lines.join('\n')}`
      );
      for (const job of review) {
        if (!DRY_RUN) tracker.add(job, 'manual_review', 'hiring term not stated in posting');
        counts.manual++;
      }
    }

    // 4. Process the eligible queue.
    //
    // Two separate budgets, because they bound different things. `examined` bounds
    // the *work* — each job can cost a page render for the visa check. `submitted`
    // bounds the *applications*, which is what the cap is actually meant to limit.
    //
    // Conflating them was a bug worth naming: a job skipped for no sponsorship, or
    // flagged for manual review, used to consume an application slot. A run whose
    // queue happened to start with a run of US no-sponsorship postings would burn
    // its whole budget and submit nothing, while appliable jobs sat behind them.
    let examined = 0;
    let applyAttempts = 0;
    for (const job of eligible) {
      if (applyAttempts >= MAX_APPLICATIONS_PER_RUN) {
        console.log(`Application cap of ${MAX_APPLICATIONS_PER_RUN} reached; remaining jobs stay for the next run.`);
        break;
      }
      if (examined >= MAX_JOBS_EXAMINED_PER_RUN) {
        console.log(`Examined ${examined} jobs without filling the application cap; stopping here for this run.`);
        break;
      }
      examined++;
      console.log(`\n[${examined}] ${job.title} @ ${job.company} (${job.location}) — ${job.url}`);

      // ATS boards already handed us the description; only fall back to rendering
      // the page for sources that didn't.
      let description = job.description || '';
      if (job.source === 'indeed') {
        const details = await fetchIndeedJobDetails(context, job);
        if (details.blocked) {
          examined--; // blocked page: no work done, don't burn the budget or record it
          continue;
        }
        description = details.description;
        if (details.externalApplyUrl) job.applyUrl = details.externalApplyUrl;
      }

      // US visa filter: skip only a posting that explicitly refuses to sponsor.
      //
      // This used to demand an explicit *offer*, which meant silence was treated as
      // refusal — and most US postings never mention sponsorship at all. It skipped
      // 56 of 60 examined postings, including every one that would have taken the
      // application. The employer's own form asks the question, and the applier now
      // answers it truthfully from profile.json, so let them decide.
      //
      // The feed's curated `sponsorship` field is authoritative when it says
      // anything definite, which saves rendering the page at all.
      if (job.country === 'US') {
        const verdict = feedSponsorshipVerdict(job);
        let stance = verdict === 'unknown' ? null : verdict;

        if (!stance) {
          if (!description) description = await fetchPostingText(context, job.applyUrl || job.url);
          stance = sponsorshipStance(description);
        }

        if (stance === 'denies') {
          const why = verdict === 'denies' ? `feed says "${job.sponsorship}"` : 'posting states it will not sponsor';
          console.log(`  → skipped: US posting — ${why}`);
          if (!DRY_RUN) tracker.add(job, 'skipped_no_sponsorship', why, { description });
          counts.skipped++;
          continue;
        }
      }

      // Re-score now that we may have fetched a description the pre-sort didn't
      // have. Scoring is pure, so this just replaces a weakly-evidenced guess with
      // a better one; the queue order was already fixed above and doesn't change.
      job.scores = scoreJob(job, CANDIDATE, description);
      console.log(`  → ${explainScore(job.scores)}`);

      // Optional fit floor. Gated *here*, after the description is in hand, rather
      // than before the fetch: a posting with no description scores on its title
      // alone, and rejecting it on that would throw away jobs we simply hadn't
      // read yet. The examined-jobs budget already bounds the work this costs.
      if (job.scores.compatibility < MIN_COMPATIBILITY) {
        const why = `compatibility ${job.scores.compatibility} below floor of ${MIN_COMPATIBILITY}`;
        console.log(`  → skipped: ${why}`);
        if (!DRY_RUN) tracker.add(job, 'skipped_low_compatibility', why, { description });
        counts.lowFit++;
        continue;
      }

      // Apply, or hand off for manual review on unsupported platforms. Only opening
      // and filling a real form consumes the application budget — passing a Workday
      // link to Slack costs nothing and shouldn't crowd out a job we can apply to.
      const ats = supportedAts(job.applyUrl || job.url);
      if (!ats) {
        console.log('  → manual_review: unsupported application platform');
        if (!DRY_RUN) tracker.add(job, 'manual_review', 'unsupported application platform', { description });
        counts.manual++;
        await slack(
          `:eyes: Manual review needed — *${job.title}* at *${job.company}* (${job.location})\n` +
            `<${job.applyUrl || job.url}|Apply here> — unsupported application platform\n` +
            `_${explainScore(job.scores)}_`
        );
        continue;
      }

      applyAttempts++;
      const result = await applyToJob(context, job);
      const resumeNote = result.resume ? ` [résumé: ${result.resumeReason}]` : '';
      console.log(`  → ${result.status}: ${result.details}${resumeNote}`);
      // Dry runs never touch the ledger — otherwise a test run would block real applications.
      // The résumé rides along as its own field rather than appended to `details`,
      // so the dashboard can show which one was sent without parsing prose.
      if (!DRY_RUN) {
        tracker.add(job, result.status, result.details, {
          description,
          resume: result.resume ? { variant: result.resume, reason: result.resumeReason } : null,
        });
      }

      if (result.status === 'applied' || result.status === 'submitted_unconfirmed') {
        counts.applied++;
        await notifyApplied(job, result.resume);
      } else if (result.status === 'manual_review') {
        counts.manual++;
        await slack(
          `:eyes: Manual review needed — *${job.title}* at *${job.company}* (${job.location})\n` +
            `<${job.applyUrl || job.url}|Apply here> — ${result.details}\n` +
            `_${explainScore(job.scores)}_`
        );
      } else {
        counts.skipped++;
      }
    }
  } finally {
    await browser.close();
    if (!DRY_RUN) tracker.save();
  }

  await notifySummary({ ...counts, dryRun: DRY_RUN });
  console.log(`\nDone: ${JSON.stringify(counts)}`);
}

main().catch(async (err) => {
  console.error(err);
  await slack(`:x: Jobify run crashed: ${err.message}`);
  process.exit(1);
});
