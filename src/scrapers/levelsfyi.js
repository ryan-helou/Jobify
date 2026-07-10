import { getJson } from './http.js';

// levels.fyi's internship dataset — the JSON that backs its intern salary pages.
//
//   GET https://www.levels.fyi/js/internshipData.json
//     → [{ company, title, loc, link, season, hourlySalary, ... }]  (~14k records)
//
// Harvest-only, exactly like the SimplifyJobs feeds: we don't parse these as jobs
// (the rows are salary datapoints, many for past seasons), we mine the `link` field
// for company apply URLs. Each link points at the employer's own careers page —
// frequently a Greenhouse/Lever/Workday/Workable board — so 14k rows is a large
// injection of ATS board tokens the GitHub feeds never named, and the pair with
// `company` labels each one for identity dedup.

const URL_OK = /^https?:\/\//i;

// Pure: dataset rows → { url, company } postings. Exported for testing.
export function levelsPostings(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && typeof r.link === 'string' && URL_OK.test(r.link))
    .map((r) => ({ url: r.link, company: (r.company || '').trim() }));
}

export async function scrapeLevelsFyi() {
  let data;
  try {
    // Node's fetch decompresses the gzipped body transparently.
    data = await getJson('https://www.levels.fyi/js/internshipData.json');
  } catch (err) {
    console.error(`levels.fyi feed failed: ${err.message}`);
    return { jobs: [], postings: [] };
  }

  const rows = Array.isArray(data) ? data : [];
  const postings = levelsPostings(rows);
  console.log(`levels.fyi: token mine only, ${postings.length} apply URLs from ${rows.length} rows`);
  return { jobs: [], postings };
}
