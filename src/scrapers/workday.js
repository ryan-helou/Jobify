import * as cheerio from 'cheerio';
import { ATS_CONCURRENCY, WORKDAY_MAX_PAGES, CAMPUS_SITE } from '../config.js';
import { isDevRole, matchCity } from './github.js';
import { classifyPosting } from '../term.js';
import { mapLimit, getJson, postJson } from './http.js';

// Workday, via its public "CxS" JSON API. No key, no auth.
//
//   POST /wday/cxs/{tenant}/{site}/jobs   {appliedFacets:{}, limit, offset, searchText}
//     → { total, jobPostings: [{ title, locationsText, postedOn, externalPath }] }
//   GET  /wday/cxs/{tenant}/{site}{externalPath}
//     → { jobPostingInfo: { jobDescription, ... } }
//
// Worth the trouble because Workday is 28% of Canadian postings and 22% of US ones
// — by far the biggest ATS we couldn't read. Greenhouse/Ashby/Lever, which the ats.js
// scraper covers, are only 13% of Canadian postings.
//
// Two quirks shape the code. `limit` is capped at 20 server-side (asking for 50
// returns nothing at all), so results are paged. And `searchText` is a fuzzy
// full-text match over the description, not the title — searching "intern" on
// Aptiv's board returns a Director in Krakow, because the word appears somewhere in
// the body. It still narrows 734 postings to 275, so we use it to cut the paging
// cost and then filter titles ourselves.

const PAGE = 20;
const TENANT_URL = /^https:\/\/([^.]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)/i;

// `.../myworkdayjobs.com/job/...` has no site segment — the first path element is
// the job itself. Enumerating a site called "job" just 404s.
const NOT_A_SITE = /^(job|jobs)$/i;

const base = ({ tenant, pod, site }) => `https://${tenant}.${pod}.myworkdayjobs.com/wday/cxs/${tenant}/${site}`;

// Keyed by tenant+site: one employer can run several sites ("bmo/Campus" and
// "bmo/Privileged"), and they list different jobs.
export function harvestWorkdayTenants(postings) {
  const tenants = new Map();
  for (const posting of postings) {
    const raw = typeof posting === 'string' ? posting : posting?.url;
    const company = (typeof posting === 'string' ? '' : posting?.company || '').trim();
    if (!raw) continue;

    const m = TENANT_URL.exec(raw);
    if (!m) continue;
    const [, tenant, pod, site] = m;
    if (NOT_A_SITE.test(site)) continue;

    const key = `${tenant}|${pod}|${site}`;
    if (!tenants.get(key)?.company) tenants.set(key, { tenant, pod, site, company });
  }
  return [...tenants.values()];
}

function htmlToText(html) {
  if (!html) return '';
  return cheerio.load(String(html)).text().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Campus/student sites are internships by construction, exactly like the new-grad
// boards. BMO posts "Application developer" on bmo/Campus — a co-op role whose title
// never says "intern", and which the internship policy would therefore reject.
const roleKind = (site) => (CAMPUS_SITE.test(site) ? 'campus' : 'internship');

async function scrapeSite(target) {
  const { tenant, site, company } = target;
  const api = base(target);
  const kind = roleKind(site);
  const hits = [];

  for (let offset = 0, total = Infinity; offset < total && offset < WORKDAY_MAX_PAGES * PAGE; offset += PAGE) {
    const page = await postJson(`${api}/jobs`, { appliedFacets: {}, limit: PAGE, offset, searchText: 'intern' });
    total = page.total ?? 0;
    const postings = page.jobPostings || [];
    if (!postings.length) break;

    for (const p of postings) {
      if (!p.externalPath || !isDevRole(p.title, kind)) continue;
      const city = matchCity(p.locationsText || '');
      if (!city) continue;
      hits.push({
        title: p.title,
        location: p.locationsText || '',
        city: city.key,
        country: city.country,
        externalPath: p.externalPath,
      });
    }
  }
  if (!hits.length) return [];

  // Only survivors cost a detail request. A failed description leaves the term
  // unstated, which routes to a human rather than dropping the job.
  const enriched = await mapLimit(hits, 4, async (h) => {
    const url = `https://${tenant}.${target.pod}.myworkdayjobs.com/${site}${h.externalPath}`;
    let description = '';
    try {
      const detail = await getJson(`${api}${h.externalPath}`, { headers: { Accept: 'application/json' } });
      description = htmlToText(detail.jobPostingInfo?.jobDescription);
    } catch {
      /* leave description empty → term unstated */
    }
    return {
      id: url,
      title: h.title,
      company: company || tenant,
      location: h.location,
      city: h.city,
      country: h.country,
      url,
      source: `workday:${tenant}`,
      sponsorship: null,
      description,
      term: classifyPosting(h.title, description),
    };
  });
  return enriched.filter(Boolean);
}

export async function scrapeWorkday(postings) {
  const targets = harvestWorkdayTenants(postings);
  if (!targets.length) return [];

  const campus = targets.filter((t) => CAMPUS_SITE.test(t.site)).length;
  console.log(`Workday: enumerating ${targets.length} tenant sites (${campus} campus/student portals)`);

  const results = await mapLimit(targets, ATS_CONCURRENCY, scrapeSite);
  const reachable = results.filter((r) => r !== null).length;

  const seen = new Set();
  const jobs = [];
  for (const list of results) {
    for (const job of list || []) {
      if (seen.has(job.url)) continue;
      seen.add(job.url);
      jobs.push(job);
    }
  }

  const byTerm = jobs.reduce((acc, j) => ({ ...acc, [j.term]: (acc[j.term] || 0) + 1 }), {});
  console.log(`Workday: ${reachable}/${targets.length} sites reachable, ${jobs.length} matching jobs ${JSON.stringify(byTerm)}`);
  return jobs;
}
