import { chromium } from 'playwright';
import {
  CITIES,
  DRY_RUN,
  ENABLE_INDEED,
  MAX_APPLICATIONS_PER_RUN,
  validateConfig,
} from './config.js';
import { loadTracker } from './tracker.js';
import { scrapeGithubBoards } from './scrapers/github.js';
import { scrapeIndeed, fetchIndeedJobDetails } from './scrapers/indeed.js';
import { applyToJob, supportedAts } from './apply/index.js';
import { mentionsSponsorship, fetchPostingText } from './visa.js';
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

  const counts = { found: 0, applied: 0, manual: 0, skipped: 0 };

  try {
    // 1. Scrape sources. GitHub boards use plain fetch (parallel-safe); Indeed
    //    needs the shared browser and is opt-in since it's usually blocked in CI.
    const [githubJobs, indeedJobs] = await Promise.all([
      scrapeGithubBoards(),
      ENABLE_INDEED ? scrapeIndeed(context) : Promise.resolve([]),
    ]);
    if (!ENABLE_INDEED) console.log('Indeed scraping disabled (set ENABLE_INDEED=true to attempt it).');

    // 2. Dedup against the ledger and within this run.
    const seen = new Set();
    const fresh = [];
    for (const job of [...githubJobs, ...indeedJobs]) {
      if (tracker.has(job.url) || seen.has(job.url)) continue;
      seen.add(job.url);
      fresh.push(job);
    }
    fresh.sort((a, b) => CITY_PRIORITY[a.city] - CITY_PRIORITY[b.city]); // Montreal first
    counts.found = fresh.length;
    console.log(`${fresh.length} new jobs after dedup (${githubJobs.length} github, ${indeedJobs.length} indeed scraped)`);

    // 3. Process up to the per-run cap.
    let attempts = 0;
    for (const job of fresh) {
      if (attempts >= MAX_APPLICATIONS_PER_RUN) {
        console.log(`Per-run cap of ${MAX_APPLICATIONS_PER_RUN} reached; remaining jobs stay for the next run.`);
        break;
      }
      attempts++;
      console.log(`\n[${attempts}] ${job.title} @ ${job.company} (${job.location}) — ${job.url}`);

      // Enrich Indeed jobs: description (visa check) + external apply URL.
      let description = '';
      if (job.source === 'indeed') {
        const details = await fetchIndeedJobDetails(context, job);
        if (details.blocked) {
          attempts--; // blocked page, don't burn the cap or record the job
          continue;
        }
        description = details.description;
        if (details.externalApplyUrl) job.applyUrl = details.externalApplyUrl;
      }

      // US visa filter: posting must explicitly mention sponsorship.
      if (job.country === 'US') {
        if (!description) description = await fetchPostingText(context, job.applyUrl || job.url);
        if (!mentionsSponsorship(description)) {
          console.log('  → skipped: US posting with no explicit visa sponsorship mention');
          if (!DRY_RUN) tracker.add(job, 'skipped_no_sponsorship');
          counts.skipped++;
          continue;
        }
      }

      // Apply (or flag for manual review on unsupported platforms).
      const ats = supportedAts(job.applyUrl || job.url);
      const result = ats
        ? await applyToJob(context, job)
        : { status: 'manual_review', details: 'unsupported application platform' };
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
