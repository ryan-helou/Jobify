import { ATS_CONCURRENCY, ORACLE_MAX_PAGES } from '../config.js';
import { isDevRole, matchCity } from './github.js';
import { classifyPosting } from '../term.js';
import { mapLimit, getJson, htmlToText } from './http.js';

// Oracle Fusion "Candidate Experience", via its public REST API. No key, no auth.
//
//   GET /hcmRestApi/resources/latest/recruitingCEJobRequisitions
//         ?onlyData=true&expand=requisitionList
//         &finder=findReqs;siteNumber={site},keyword=intern,limit=200,offset=0
//     → { items: [ { TotalJobsCount, requisitionList: [{ Id, Title, PrimaryLocation, … }] } ] }
//
//   GET /hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails
//         ?expand=all&onlyData=true&finder=ById;Id="{id}",siteNumber={site}
//     → { items: [ { ExternalDescriptionStr, … } ] }
//
// This is the largest ATS we couldn't read after Workday — 4,289 postings across
// 177 tenant sites, and the platform Canadian banks, telcos, CAE and Bombardier
// run their campus hiring on.
//
// Each tenant lives on its own host (`emit.fa.ca3.oraclecloud.com`,
// `fa-exvu-saasfaprod1.fa.ocs.oraclecloud.com`), so host and site number together
// identify a board. `keyword` is a fuzzy full-text match, exactly as on Workday: it
// cuts 3,753 postings to 1,861 but still returns titles with no "intern" in them,
// so it bounds the paging rather than doing the filtering.

const PAGE = 200;
const SITE_URL = /^https:\/\/([^/]+\.oraclecloud\.com)\/.*\/sites\/([^/?#]+)/i;

const listUrl = (host, site, offset) =>
  `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions` +
  `?onlyData=true&expand=requisitionList&finder=findReqs;siteNumber=${encodeURIComponent(site)},` +
  `keyword=intern,limit=${PAGE},offset=${offset}`;

const detailUrl = (host, site, id) =>
  `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails` +
  `?expand=all&onlyData=true&finder=ById;Id=%22${encodeURIComponent(id)}%22,siteNumber=${encodeURIComponent(site)}`;

const applyUrl = (host, site, id) =>
  `https://${host}/hcmUI/CandidateExperience/en/sites/${encodeURIComponent(site)}/job/${encodeURIComponent(id)}`;

export function harvestOracleSites(postings) {
  const sites = new Map();
  for (const posting of postings) {
    const raw = typeof posting === 'string' ? posting : posting?.url;
    const company = (typeof posting === 'string' ? '' : posting?.company || '').trim();
    if (!raw) continue;

    const m = SITE_URL.exec(raw);
    if (!m) continue;
    const [, host, site] = m;
    const key = `${host}|${site}`;
    if (!sites.get(key)?.company) sites.set(key, { host, site, company });
  }
  return [...sites.values()];
}

async function scrapeSite({ host, site, company }) {
  const hits = [];

  for (let offset = 0, total = Infinity; offset < total && offset < ORACLE_MAX_PAGES * PAGE; offset += PAGE) {
    const box = (await getJson(listUrl(host, site, offset))).items?.[0];
    const reqs = box?.requisitionList || [];
    total = box?.TotalJobsCount ?? 0;
    if (!reqs.length) break;

    for (const r of reqs) {
      if (!r.Id || !isDevRole(r.Title, 'internship')) continue;
      const city = matchCity(r.PrimaryLocation || '');
      if (!city) continue;
      hits.push({ id: r.Id, title: r.Title, location: r.PrimaryLocation || '', city: city.key, country: city.country });
    }
  }
  if (!hits.length) return [];

  return (
    await mapLimit(hits, 4, async (h) => {
      let description = '';
      try {
        const item = (await getJson(detailUrl(host, site, h.id))).items?.[0] || {};
        description = htmlToText(
          [item.ExternalDescriptionStr, item.ExternalResponsibilitiesStr, item.ExternalQualificationsStr]
            .filter(Boolean)
            .join(' ')
        );
      } catch {
        /* no description → term stays unstated → a human looks at it */
      }
      return {
        id: applyUrl(host, site, h.id),
        title: h.title,
        company: company || host.split('.')[0],
        location: h.location,
        city: h.city,
        country: h.country,
        url: applyUrl(host, site, h.id),
        source: `oracle:${host.split('.')[0]}`,
        sponsorship: null,
        description,
        term: classifyPosting(h.title, description),
      };
    })
  ).filter(Boolean);
}

export async function scrapeOracle(postings) {
  const sites = harvestOracleSites(postings);
  if (!sites.length) return [];

  console.log(`Oracle: enumerating ${sites.length} tenant sites`);
  const results = await mapLimit(sites, ATS_CONCURRENCY, scrapeSite);
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
  console.log(`Oracle: ${reachable}/${sites.length} sites reachable, ${jobs.length} matching jobs ${JSON.stringify(byTerm)}`);
  return jobs;
}
