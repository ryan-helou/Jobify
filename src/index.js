import { chromium } from 'playwright';
import {
  CITIES,
  DRY_RUN,
  ENABLE_ATS,
  ENABLE_INDEED,
  MANUAL_REVIEW_BATCH,
  MAX_APPLICATIONS_PER_RUN,
  MAX_JOBS_EXAMINED_PER_RUN,
  validateConfig,
} from './config.js';
import { loadTracker, identityKey, canonicalKey } from './tracker.js';
import { scrapeGithubBoards } from './scrapers/github.js';
import { scrapeAtsBoards } from './scrapers/ats.js';
import { scrapeIndeed, fetchIndeedJobDetails } from './scrapers/indeed.js';
import { applyToJob, supportedAts } from './apply/index.js';
import { mentionsSponsorship, fetchPostingText, feedSponsorshipVerdict } from './visa.js';
import { slack, notifyApplied, notifySummary } from './notify.js';

const CITY_PRIORITY = Object.fromEntries(CITIES.map((c, i) => [c.key, i]));

async function main() {
  const problems = validateConfig();
  if (problems.length) {
    console.warn('Config warnings:\n - ' + problems.join('\n - '));
    if (problems.some((p) => p.includes('resume') || p.includes('APPLICANT'))) {
      await slack(`:warning: Jobify run aborted — configuration incomplete: ${problems.join('; ')}`);
      process.exit(1);
    }
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

  const counts = { found: 0, applied: 0, manual: 0, skipped: 0, wrongTerm: 0 };

  try {
    // 1. Scrape sources. The GitHub boards run first because their apply URLs are
    //    what tell us which company ATS boards exist. Indeed needs the shared
    //    browser and is opt-in since it's usually blocked in CI.
    const { jobs: githubJobs, postings } = await scrapeGithubBoards();
    const [atsJobs, indeedJobs] = await Promise.all([
      ENABLE_ATS ? scrapeAtsBoards(postings) : Promise.resolve([]),
      ENABLE_INDEED ? scrapeIndeed(context) : Promise.resolve([]),
    ]);
    if (!ENABLE_ATS) console.log('ATS board enumeration disabled (set ENABLE_ATS=true to enable).');
    if (!ENABLE_INDEED) console.log('Indeed scraping disabled (set ENABLE_INDEED=true to attempt it).');

    // 2. Dedup against the ledger and within this run. The same posting shows up
    //    on multiple boards under different URLs, so we also key on identity
    //    (company + title + city) to avoid applying twice. GitHub jobs come first
    //    so a curated source's declared term wins over the ATS copy's guess.
    const seenUrls = new Set();
    const seenIdentities = new Set();
    const fresh = [];
    for (const job of [...githubJobs, ...atsJobs, ...indeedJobs]) {
      const identity = identityKey(job);
      if (tracker.has(job.url) || tracker.hasIdentity(identity)) continue;
      if (seenUrls.has(canonicalKey(job.url)) || seenIdentities.has(identity)) continue;
      seenUrls.add(canonicalKey(job.url));
      seenIdentities.add(identity);
      fresh.push(job);
    }
    fresh.sort((a, b) => CITY_PRIORITY[a.city] - CITY_PRIORITY[b.city]); // Montreal first
    counts.found = fresh.length;
    console.log(
      `${fresh.length} new jobs after dedup ` +
        `(${githubJobs.length} github, ${atsJobs.length} ats, ${indeedJobs.length} indeed scraped)`
    );

    // 3. Gate on hiring term before spending anything on a posting. A board's name
    //    is not evidence of its cycle, so this is what stops last season's roles
    //    from reaching the applier.
    const wrongTerm = fresh.filter((j) => j.term === 'other-cycle');
    const unstated = fresh.filter((j) => j.term === 'unstated');
    const eligible = fresh.filter((j) => j.term === '2027' || j.term === 'exempt');
    console.log(`term gate: ${eligible.length} eligible, ${unstated.length} unstated, ${wrongTerm.length} wrong cycle`);

    for (const job of wrongTerm) {
      console.log(`  → skipped (wrong term): ${job.title} @ ${job.company}`);
      if (!DRY_RUN) tracker.add(job, 'skipped_wrong_term', 'posting names a non-2027 season');
      counts.wrongTerm++;
    }

    // Postings that never say which term they're for go to a human, not the
    // applier. Batched into one Slack message and capped — the uncapped remainder
    // stays out of the ledger so it resurfaces next run.
    const review = unstated.slice(0, MANUAL_REVIEW_BATCH);
    if (review.length) {
      const lines = review.map((j) => `• <${j.applyUrl || j.url}|${j.title}> — *${j.company}* (${j.location})`);
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

      // US visa filter: posting must explicitly offer sponsorship.
      // The feed's curated `sponsorship` field is authoritative when it says
      // anything definite, which saves rendering the page at all.
      if (job.country === 'US') {
        const verdict = feedSponsorshipVerdict(job);
        let sponsors = verdict === 'offers';

        if (verdict === 'unknown') {
          if (!description) description = await fetchPostingText(context, job.applyUrl || job.url);
          sponsors = mentionsSponsorship(description);
        }

        if (!sponsors) {
          const why = verdict === 'denies' ? `feed says "${job.sponsorship}"` : 'no explicit visa sponsorship mention';
          console.log(`  → skipped: US posting — ${why}`);
          if (!DRY_RUN) tracker.add(job, 'skipped_no_sponsorship', why);
          counts.skipped++;
          continue;
        }
      }

      // Apply, or hand off for manual review on unsupported platforms. Only opening
      // and filling a real form consumes the application budget — passing a Workday
      // link to Slack costs nothing and shouldn't crowd out a job we can apply to.
      const ats = supportedAts(job.applyUrl || job.url);
      if (!ats) {
        console.log('  → manual_review: unsupported application platform');
        if (!DRY_RUN) tracker.add(job, 'manual_review', 'unsupported application platform');
        counts.manual++;
        await slack(
          `:eyes: Manual review needed — *${job.title}* at *${job.company}* (${job.location})\n` +
            `<${job.applyUrl || job.url}|Apply here> — unsupported application platform`
        );
        continue;
      }

      applyAttempts++;
      const result = await applyToJob(context, job);
      console.log(`  → ${result.status}: ${result.details}`);
      // Dry runs never touch the ledger — otherwise a test run would block real applications.
      if (!DRY_RUN) tracker.add(job, result.status, result.details);

      if (result.status === 'applied' || result.status === 'submitted_unconfirmed') {
        counts.applied++;
        await notifyApplied(job);
      } else if (result.status === 'manual_review') {
        counts.manual++;
        await slack(
          `:eyes: Manual review needed — *${job.title}* at *${job.company}* (${job.location})\n` +
            `<${job.applyUrl || job.url}|Apply here> — ${result.details}`
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
