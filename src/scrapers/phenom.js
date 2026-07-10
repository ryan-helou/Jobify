import fs from 'node:fs';
import { ATS_CONCURRENCY, PHENOM_MAX_PAGES, PHENOM_SITES_PATH } from '../config.js';
import { classifyPosting } from '../term.js';
import { mapLimit, postJson, htmlToText, dedupeByUrl, termTally } from './http.js';
import { buildJob } from './candidate.js';

// Phenom People, via the `/widgets` search endpoint its career sites all expose.
//
//   POST https://{host}/widgets   { ddoKey:'refineSearch', keywords, from, size, ... }
//     → { refineSearch: { totalHits, data: { jobs: [{ title, jobId, jobSeqNo,
//                          location, city, state, country, description }] } } }
//
// Unlike the other platforms Phenom gives every employer a vanity domain
// (jobs.bell.ca, careers.tdbank.com), so there's no shared host to harvest tokens
// from — nothing in the GitHub feeds points at it. Instead the sites are listed
// explicitly in assets/phenom-sites.json, the same way discovery seeds employers.
// This is where the Canadian banks and telcos live, which is why it's worth the
// curation: Bell, TD and their peers run Phenom and appear on no other source here.
//
// Each site entry: { host, company?, country?, lang? }. country/lang default to US
// English and are only needed where the site is localized (Bell wants ca/en_ca).

export function loadPhenomSites(path = PHENOM_SITES_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
    const sites = Array.isArray(parsed) ? parsed : parsed.sites;
    return (Array.isArray(sites) ? sites : [])
      .map((s) => (typeof s === 'string' ? { host: s } : s))
      .filter((s) => s && s.host);
  } catch {
    return []; // no list, no Phenom scraping — not an error
  }
}

const jobUrl = (host, j) => `https://${host}/job/${encodeURIComponent(j.jobSeqNo || j.jobId)}`;

function jobLocation(j) {
  if (j.location) return String(j.location);
  return [j.city, j.state, j.country].filter(Boolean).join(', ');
}

function searchBody(site, from, size) {
  return {
    lang: site.lang || 'en_us',
    deviceType: 'desktop',
    country: site.country || 'us',
    ddoKey: 'refineSearch',
    sortBy: '',
    subsearch: '',
    from,
    jobs: true,
    counts: true,
    all_fields: ['category', 'country', 'state', 'city'],
    size,
    clearAll: false,
    jdsource: 'facets',
    isSliderEnable: false,
    pageName: 'search-results',
    keywords: 'intern',
    global: true,
    selected_fields: {},
    locationData: {},
  };
}

const SIZE = 20;

async function scrapeSite(site) {
  const { host, company = '' } = site;
  const jobs = [];
  for (let from = 0, total = Infinity; from < total && from < PHENOM_MAX_PAGES * SIZE; from += SIZE) {
    const res = await postJson(`https://${host}/widgets`, searchBody(site, from, SIZE));
    const refine = res.refineSearch || {};
    total = refine.totalHits ?? 0;
    const list = refine.data?.jobs || [];
    if (!list.length) break;
    for (const j of list) {
      if (!j.jobSeqNo && !j.jobId) continue;
      const description = htmlToText(j.description || j.descriptionTeaser || '');
      const job = buildJob({
        company: company || j.department,
        title: j.title,
        location: jobLocation(j),
        url: jobUrl(host, j),
        source: `phenom:${host}`,
        description,
      });
      if (job) jobs.push({ ...job, term: classifyPosting(job.title, description) });
    }
  }
  return jobs;
}

export async function scrapePhenom(sites = loadPhenomSites()) {
  if (!sites.length) return [];

  console.log(`Phenom: enumerating ${sites.length} employer sites`);
  const results = await mapLimit(sites, ATS_CONCURRENCY, scrapeSite);
  const reachable = results.filter((r) => r !== null).length;

  const jobs = dedupeByUrl(results);
  console.log(`Phenom: ${reachable}/${sites.length} sites reachable, ${jobs.length} matching jobs ${JSON.stringify(termTally(jobs))}`);
  return jobs;
}
