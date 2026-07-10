import { ADZUNA_APP_ID, ADZUNA_APP_KEY, ADZUNA_MAX_PAGES, ADZUNA_COUNTRIES } from '../config.js';
import { getJson, htmlToText } from './http.js';
import { buildJob } from './candidate.js';

// Adzuna, via its free public job-search API. Needs an app_id/app_key from open
// registration (no payment step); without them this no-ops, like Indeed without a
// browser. One pass — each result carries a description.
//
//   GET /v1/api/jobs/{country}/search/{page}
//         ?app_id=…&app_key=…&what=software intern&results_per_page=50
//     → { count, results: [{ title, company:{display_name},
//                            location:{display_name}, redirect_url, description }] }
//
// An aggregator, so it overlaps the ATS scrapers — but it reaches job boards none of
// them cover, and querying the `ca` and `us` endpoints separately gives clean
// coverage of both target countries. redirect_url is an Adzuna hop, not an ATS URL,
// so there's nothing to harvest — jobs only.

const PER_PAGE = 50;
const api = (country, page) => `https://api.adzuna.com/v1/api/jobs/${country}/search/${page}`;

async function scrapeCountry(country) {
  const jobs = [];
  const auth = `app_id=${encodeURIComponent(ADZUNA_APP_ID)}&app_key=${encodeURIComponent(ADZUNA_APP_KEY)}`;
  const query = `what=${encodeURIComponent('software intern')}&results_per_page=${PER_PAGE}&content-type=application/json`;

  for (let page = 1; page <= ADZUNA_MAX_PAGES; page++) {
    let res;
    try {
      res = await getJson(`${api(country, page)}?${auth}&${query}`);
    } catch (err) {
      if (page === 1) console.error(`Adzuna ${country} failed: ${err.message}`);
      break;
    }
    const results = res.results || [];
    if (!results.length) break;
    for (const r of results) {
      const job = buildJob({
        company: r.company?.display_name,
        title: r.title,
        location: r.location?.display_name || '',
        url: r.redirect_url,
        source: `adzuna:${country}`,
        description: htmlToText(r.description),
      });
      if (job) jobs.push(job);
    }
  }
  return jobs;
}

export async function scrapeAdzuna() {
  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) return { jobs: [], postings: [] };

  const jobs = [];
  for (const country of ADZUNA_COUNTRIES) jobs.push(...(await scrapeCountry(country)));

  // De-dupe: the same posting can surface in both country feeds via a remote tag.
  const seen = new Set();
  const deduped = jobs.filter((j) => (seen.has(j.url) ? false : seen.add(j.url)));
  console.log(`Adzuna: ${deduped.length} matching postings across ${ADZUNA_COUNTRIES.join(', ')}`);
  return { jobs: deduped, postings: [] };
}
