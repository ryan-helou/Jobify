import { ATS_CONCURRENCY, WORKABLE_MAX_PAGES } from '../config.js';
import { classifyPosting } from '../term.js';
import { mapLimit, getJson, postJson, htmlToText, dedupeByUrl, termTally } from './http.js';
import { buildJob } from './candidate.js';

// Workable, via its public embedded-careers API. No key, no auth.
//
//   POST /api/v3/accounts/{tenant}/jobs   {query:''}
//     → { total, results: [{ shortcode, title, state, location: {city,region,country},
//                            locations: [...], department, workplace }] }
//   GET  /api/v2/accounts/{tenant}/jobs/{shortcode}
//     → { title, description, requirements, benefits, location, locations }
//
// 222 postings across the feeds — the biggest ATS we couldn't read, and the one a
// lot of startups (Hugging Face among them) run. The listing carries no description,
// so it's a two-pass scrape like Greenhouse: cheap title+location filter first,
// then a detail fetch only for the survivors.
//
// Two host shapes appear in apply URLs, both backing the same API under the tenant
// slug:  apply.workable.com/{tenant}/j/{code}  and  {tenant}.workable.com/j/{code}.

const API = 'https://apply.workable.com/api';

// Path segments on apply.workable.com that are routes, not tenant slugs.
const NOT_A_TENANT = /^(?:j|jobs|api|assets|embed|widget|backend|spa)$/i;
// Subdomains on *.workable.com that aren't a tenant board.
const NOT_A_SUBDOMAIN = /^(?:www|apply|api|help|support|status|blog|careers)$/i;

// Returns the tenant slug from a Workable apply URL, or null.
function tenantOf(u) {
  if (/^apply\.workable\.com$/i.test(u.hostname)) {
    const seg = u.pathname.split('/').filter(Boolean)[0];
    if (!seg || NOT_A_TENANT.test(seg)) return null;
    try {
      return decodeURIComponent(seg);
    } catch {
      return seg;
    }
  }
  const sub = /^([^.]+)\.workable\.com$/i.exec(u.hostname);
  if (sub && !NOT_A_SUBDOMAIN.test(sub[1])) return sub[1].toLowerCase();
  return null;
}

// Keyed by tenant slug → employer display name (first non-empty wins), exactly like
// the Greenhouse/Lever harvester: the API doesn't return a company name, so the
// feed's company_name is how a job avoids being filed under its raw slug.
export function harvestWorkableTenants(postings) {
  const tenants = new Map();
  for (const posting of postings) {
    const raw = typeof posting === 'string' ? posting : posting?.url;
    const company = (typeof posting === 'string' ? '' : posting?.company || '').trim();
    if (!raw) continue;
    let u;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    const token = tenantOf(u);
    if (!token) continue;
    if (!tenants.get(token)) tenants.set(token, company);
  }
  return tenants;
}

// city/region can be blank on a remote posting; a Workable job also names every
// office in `locations`, so both feed the city match.
function locationText(loc, locations) {
  const parts = [];
  const push = (l) => l && parts.push([l.city, l.region, l.country].filter(Boolean).join(', '));
  push(loc);
  for (const l of locations || []) push(l);
  return parts.filter(Boolean).join(' ; ');
}

const applyUrl = (token, shortcode) => `https://apply.workable.com/${encodeURIComponent(token)}/j/${shortcode}/`;

async function scrapeTenant(token, company) {
  // Page through published jobs. The embedded API returns a `nextPage` cursor when
  // a board overflows one response; small boards (most internship boards) return
  // everything at once and never set it.
  const hits = [];
  let cursor;
  for (let page = 0; page < WORKABLE_MAX_PAGES; page++) {
    const body = { query: '', ...(cursor ? { token: cursor } : {}) };
    const res = await postJson(`${API}/v3/accounts/${encodeURIComponent(token)}/jobs`, body);
    for (const j of res.results || []) {
      if (j.state && j.state !== 'published') continue;
      const location = locationText(j.location, j.locations);
      const candidate = buildJob({ company, title: j.title, location, url: applyUrl(token, j.shortcode), source: `workable:${token}` });
      if (candidate && j.shortcode) hits.push({ candidate, shortcode: j.shortcode });
    }
    cursor = res.nextPage || res.paging?.next || null;
    if (!cursor) break;
  }
  if (!hits.length) return [];

  // Only survivors cost a detail fetch. A failed detail leaves the term unstated,
  // routing the job to a human rather than dropping it.
  return (
    await mapLimit(hits, 4, async ({ candidate, shortcode }) => {
      try {
        const detail = await getJson(`${API}/v2/accounts/${encodeURIComponent(token)}/jobs/${shortcode}`, {
          headers: { Accept: 'application/json' },
        });
        const description = htmlToText([detail.description, detail.requirements, detail.benefits].filter(Boolean).join(' '));
        // buildJob classified the term from the title alone; a description can
        // upgrade 'unstated' → '2027'.
        return { ...candidate, description, term: classifyPosting(candidate.title, description) };
      } catch {
        return candidate;
      }
    })
  ).filter(Boolean);
}

export async function scrapeWorkable(postings) {
  const tenants = harvestWorkableTenants(postings);
  if (!tenants.size) return [];

  console.log(`Workable: enumerating ${tenants.size} tenant boards`);
  const work = [...tenants].map(([token, company]) => ({ token, company }));
  const results = await mapLimit(work, ATS_CONCURRENCY, ({ token, company }) => scrapeTenant(token, company));
  const reachable = results.filter((r) => r !== null).length;

  const jobs = dedupeByUrl(results);
  console.log(`Workable: ${reachable}/${work.length} boards reachable, ${jobs.length} matching jobs ${JSON.stringify(termTally(jobs))}`);
  return jobs;
}
