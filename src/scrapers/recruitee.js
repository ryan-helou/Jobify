import { ATS_CONCURRENCY } from '../config.js';
import { mapLimit, getJson, htmlToText, dedupeByUrl, termTally } from './http.js';
import { buildJob } from './candidate.js';

// Recruitee, via its public offers API. No key, no auth, and — unlike most of the
// others — one pass: the listing already carries the full description.
//
//   GET https://{tenant}.recruitee.com/api/offers/
//     → { offers: [{ id, title, status, city, country, location, locations,
//                    department, description, requirements, careers_url,
//                    careers_apply_url, company_name, slug }] }
//
// Only ~10 postings across the feeds, but the scraper is cheap and Recruitee is
// common enough among smaller European-and-Canadian startups that discovery
// (assets/employers.json) can turn up boards the feeds never named.

const NOT_A_TENANT = /^(?:www|api|help|support|status|blog|jobs|careers)$/i;

// Tenant lives in the subdomain: {tenant}.recruitee.com. Apply URLs also appear as
// the offer's own careers_apply_url, but in the feeds it's the subdomain we see.
export function harvestRecruiteeTenants(postings) {
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
    const m = /^([^.]+)\.recruitee\.com$/i.exec(u.hostname);
    if (!m || NOT_A_TENANT.test(m[1])) continue;
    const token = m[1].toLowerCase();
    if (!tenants.get(token)) tenants.set(token, company);
  }
  return tenants;
}

function offerLocation(o) {
  const parts = [[o.city, o.country].filter(Boolean).join(', ')];
  for (const l of o.locations || []) {
    if (typeof l === 'string') parts.push(l);
    else if (l) parts.push([l.city, l.country].filter(Boolean).join(', '));
  }
  return parts.filter(Boolean).join(' ; ') || o.location || '';
}

async function scrapeTenant(token, company) {
  const { offers = [] } = await getJson(`https://${encodeURIComponent(token)}.recruitee.com/api/offers/`);
  return offers
    .filter((o) => !o.status || o.status === 'published')
    .map((o) => {
      const description = htmlToText([o.description, o.requirements].filter(Boolean).join(' '));
      const url = o.careers_apply_url || o.careers_url || `https://${token}.recruitee.com/o/${o.slug || o.id}`;
      return buildJob({
        company: company || o.company_name,
        title: o.title,
        location: offerLocation(o),
        url,
        source: `recruitee:${token}`,
        description,
      });
    })
    .filter(Boolean);
}

export async function scrapeRecruitee(postings) {
  const tenants = harvestRecruiteeTenants(postings);
  if (!tenants.size) return [];

  console.log(`Recruitee: enumerating ${tenants.size} tenant boards`);
  const work = [...tenants].map(([token, company]) => ({ token, company }));
  const results = await mapLimit(work, ATS_CONCURRENCY, ({ token, company }) => scrapeTenant(token, company));
  const reachable = results.filter((r) => r !== null).length;

  const jobs = dedupeByUrl(results);
  console.log(`Recruitee: ${reachable}/${work.length} boards reachable, ${jobs.length} matching jobs ${JSON.stringify(termTally(jobs))}`);
  return jobs;
}
