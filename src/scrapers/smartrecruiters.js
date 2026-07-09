import { ATS_CONCURRENCY, SMARTRECRUITERS_MAX_PAGES } from '../config.js';
import { isDevRole, matchCity } from './github.js';
import { classifyPosting } from '../term.js';
import { mapLimit, getJson, htmlToText } from './http.js';

// SmartRecruiters, via its public postings API. No key, no auth.
//
//   GET /v1/companies/{company}/postings?limit=100&offset=0
//     → { totalFound, content: [{ id, name, location: { city, region, country } }] }
//   GET /v1/companies/{company}/postings/{id}
//     → { applyUrl, jobAd: { sections: { jobDescription: { text }, qualifications: … } } }
//
// 1,526 postings across 194 companies in the feeds, and the platform Ubisoft and
// Genetec use — the two biggest Montreal engineering employers that run neither
// Greenhouse nor Workday.
//
// Unlike Workday and Oracle there is no keyword parameter, so every posting is
// paged through and filtered locally. Pages hold 100, and no company in the feeds
// posts more than a few hundred roles at once.

const PAGE = 100;
const api = 'https://api.smartrecruiters.com/v1/companies';
const COMPANY_URL = /^https:\/\/(?:jobs|careers)\.smartrecruiters\.com\/([^/?#]+)/i;

export function harvestSmartRecruitersCompanies(postings) {
  const companies = new Map();
  for (const posting of postings) {
    const raw = typeof posting === 'string' ? posting : posting?.url;
    const name = (typeof posting === 'string' ? '' : posting?.company || '').trim();
    if (!raw) continue;

    const m = COMPANY_URL.exec(raw);
    if (!m) continue;
    let token;
    try {
      token = decodeURIComponent(m[1]);
    } catch {
      token = m[1];
    }
    // SmartRecruiters' own routes sit at the same path depth as an employer slug
    // ("jobs.smartrecruiters.com/oneclick-ui/company/…"), so they must be excluded
    // by prefix, not by exact match.
    if (/^(one[-_]?click|apply|login|search|jobs)(?:[-_]|$)/i.test(token)) continue;
    if (!companies.get(token)) companies.set(token, { token, name });
  }
  return [...companies.values()];
}

async function scrapeCompany({ token, name }) {
  const hits = [];

  for (let offset = 0, total = Infinity; offset < total && offset < SMARTRECRUITERS_MAX_PAGES * PAGE; offset += PAGE) {
    const page = await getJson(`${api}/${encodeURIComponent(token)}/postings?limit=${PAGE}&offset=${offset}`);
    total = page.totalFound ?? 0;
    const content = page.content || [];
    if (!content.length) break;

    for (const p of content) {
      if (!p.id || !isDevRole(p.name, 'internship')) continue;
      const location = [p.location?.city, p.location?.region, p.location?.country].filter(Boolean).join(', ');
      const city = matchCity(location);
      if (!city) continue;
      hits.push({ id: p.id, title: p.name, location, city: city.key, country: city.country });
    }
  }
  if (!hits.length) return [];

  return (
    await mapLimit(hits, 4, async (h) => {
      // The listing has no apply URL and no description; both live on the detail.
      let description = '';
      let url = `https://jobs.smartrecruiters.com/${encodeURIComponent(token)}/${encodeURIComponent(h.id)}`;
      try {
        const detail = await getJson(`${api}/${encodeURIComponent(token)}/postings/${encodeURIComponent(h.id)}`);
        const s = detail.jobAd?.sections || {};
        description = htmlToText([s.jobDescription?.text, s.qualifications?.text].filter(Boolean).join(' '));
        if (detail.applyUrl) url = detail.applyUrl;
      } catch {
        /* keep the constructed URL; term stays unstated → a human looks at it */
      }
      return {
        id: url,
        title: h.title,
        company: name || token,
        location: h.location,
        city: h.city,
        country: h.country,
        url,
        source: `smartrecruiters:${token}`,
        sponsorship: null,
        description,
        term: classifyPosting(h.title, description),
      };
    })
  ).filter(Boolean);
}

export async function scrapeSmartRecruiters(postings) {
  const companies = harvestSmartRecruitersCompanies(postings);
  if (!companies.length) return [];

  console.log(`SmartRecruiters: enumerating ${companies.length} company boards`);
  const results = await mapLimit(companies, ATS_CONCURRENCY, scrapeCompany);
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
  console.log(
    `SmartRecruiters: ${reachable}/${companies.length} boards reachable, ${jobs.length} matching jobs ${JSON.stringify(byTerm)}`
  );
  return jobs;
}
