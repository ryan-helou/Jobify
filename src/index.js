import { chromium } from 'playwright';
import {
  CANDIDATE,
  ENABLE_ATS,
  ENABLE_DISCOVERY,
  ENABLE_INDEED,
  ENABLE_ORACLE,
  ENABLE_SMARTRECRUITERS,
  ENABLE_WORKDAY,
  validateConfig,
} from './config.js';
import { identityKey, canonicalKey } from './tracker.js';
import { loadBoard, mergeBoard, saveBoard } from './board.js';
import { scrapeGithubBoards } from './scrapers/github.js';
import { scrapeAtsBoards } from './scrapers/ats.js';
import { scrapeWorkday } from './scrapers/workday.js';
import { scrapeOracle } from './scrapers/oracle.js';
import { scrapeSmartRecruiters } from './scrapers/smartrecruiters.js';
import { guessBoardPostings } from './scrapers/discover.js';
import { scrapeIndeed } from './scrapers/indeed.js';
import { scoreJob } from './score.js';
import { slack } from './notify.js';

// Jobify builds a board. It scrapes every source it knows, scores every posting
// against assets/profile.json, and writes the lot to board.json for the dashboard.
//
// It does not apply to anything. It used to, and the applier reached 8 of 239
// postings — the eight easiest forms, never the Workday roles worth having — while
// reporting nine submissions that no employer ever received. The scrape, the dedup,
// the term classifier and the scoring were always the valuable half. Every gate the
// applier needed (hiring term, sponsorship, platform) is now a column you filter on.
//
// Consequences worth stating: nothing here is irreversible, no résumé is uploaded
// anywhere, and a run that crashes costs nothing but a stale board.

async function main() {
  const { fatal, warnings } = validateConfig();
  if (warnings.length) console.warn('Config warnings:\n - ' + warnings.join('\n - '));
  if (fatal.length) {
    console.error('Config errors:\n - ' + fatal.join('\n - '));
    await slack(`:warning: Jobify run aborted — ${fatal.join('; ')}`);
    process.exit(1);
  }
  console.log('Jobify board refresh starting');

  // Indeed is the only scraper that needs a browser, and it is off by default
  // (Cloudflare blocks CI). Launching chromium for the other five would add a minute
  // to every run for nothing — and this runs every two hours.
  let browser = null;
  let context = null;
  if (ENABLE_INDEED) {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 900 },
      locale: 'en-US',
    });
  }

  try {
    // 1. Scrape. GitHub boards run first: their apply URLs are what tell us which
    //    company ATS boards exist. Discovery adds employers no board has named.
    const { jobs: githubJobs, postings: boardPostings } = await scrapeGithubBoards();
    const postings = ENABLE_DISCOVERY ? [...boardPostings, ...guessBoardPostings()] : boardPostings;

    const [atsJobs, workdayJobs, oracleJobs, srJobs, indeedJobs] = await Promise.all([
      ENABLE_ATS ? scrapeAtsBoards(postings) : Promise.resolve([]),
      ENABLE_WORKDAY ? scrapeWorkday(postings) : Promise.resolve([]),
      ENABLE_ORACLE ? scrapeOracle(postings) : Promise.resolve([]),
      ENABLE_SMARTRECRUITERS ? scrapeSmartRecruiters(postings) : Promise.resolve([]),
      ENABLE_INDEED ? scrapeIndeed(context) : Promise.resolve([]),
    ]);

    // 2. Dedup *within this run only*. The board itself is keyed on url and identity,
    //    so a posting seen last run is updated in place rather than dropped — that is
    //    how its scores stay current when the model changes.
    const seenUrls = new Set();
    const seenIdentities = new Set();
    const scraped = [];
    for (const job of [...githubJobs, ...atsJobs, ...workdayJobs, ...oracleJobs, ...srJobs, ...indeedJobs]) {
      const identity = identityKey(job);
      if (seenUrls.has(canonicalKey(job.url)) || seenIdentities.has(identity)) continue;
      seenUrls.add(canonicalKey(job.url));
      seenIdentities.add(identity);
      scraped.push(job);
    }

    // 3. Score. Pure and cheap — no network. Postings from the GitHub feeds carry no
    //    description, and `confidence` reports that rather than hiding it.
    for (const job of scraped) job.scores = scoreJob(job, CANDIDATE);

    console.log(
      `${scraped.length} postings scraped ` +
        `(${githubJobs.length} github, ${atsJobs.length} ats, ${workdayJobs.length} workday, ` +
        `${oracleJobs.length} oracle, ${srJobs.length} smartrecruiters, ${indeedJobs.length} indeed)`
    );

    // 4. Merge and write. Nothing is filtered out — that is the dashboard's job now.
    const before = loadBoard();
    const known = new Set(before.map((r) => canonicalKey(r.url)));
    const merged = mergeBoard(before, scraped);
    const added = merged.filter((r) => !known.has(canonicalKey(r.url))).length;
    const total = saveBoard(merged);

    const terms = tally(merged, (r) => r.term);
    const platforms = tally(merged, (r) => r.platform);
    console.log(`board: ${total} postings (${added} new this run)`);
    console.log(`  terms: ${describe(terms)}`);
    console.log(`  platforms: ${describe(platforms)}`);

    if (added) {
      const best = merged
        .filter((r) => !known.has(canonicalKey(r.url)))
        .sort((a, b) => (b.compatibility ?? -1) - (a.compatibility ?? -1))
        .slice(0, 5)
        .map((r) => `• <${r.applyUrl}|${r.title}> — *${r.company}* (${r.location}) _fit ${r.compatibility}_`);
      await slack(`:clipboard: ${added} new posting(s) on the board — ${total} total\n${best.join('\n')}`);
    }
  } finally {
    if (browser) await browser.close();
  }
}

const tally = (rows, key) =>
  rows.reduce((acc, r) => {
    const k = key(r) || 'unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

const describe = (counts) =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(', ');

main().catch(async (err) => {
  console.error(err);
  await slack(`:rotating_light: Jobify board refresh failed — ${err.message}`);
  process.exit(1);
});
