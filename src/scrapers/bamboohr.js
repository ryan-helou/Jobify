import { ATS_CONCURRENCY } from '../config.js';
import { classifyPosting } from '../term.js';
import { mapLimit, getJson, htmlToText, dedupeByUrl, termTally } from './http.js';
import { buildJob } from './candidate.js';

// BambooHR, via its public careers API. No key, no auth.
//
//   GET /careers/list          → { result: [{ id, jobOpeningName, departmentLabel,
//                                             location: {city,state}, atsLocation:{country,...},
//                                             isRemote, employmentStatusLabel }] }
//   GET /careers/{id}/detail   → { result: { jobOpening: { jobOpeningShareUrl,
//                                             location, atsLocation, description,
//                                             compensation } } }
//
// The list has no description, so it's a two-pass scrape: cheap title+location
// filter, then a detail fetch for the survivors. ~22 postings across the feeds,
// mostly smaller companies that run nothing else.

const NOT_A_TENANT = /^(?:www|api|help|support|status|blog)$/i;

export function harvestBambooTenants(postings) {
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
    const m = /^([^.]+)\.bamboohr\.com$/i.exec(u.hostname);
    if (!m || NOT_A_TENANT.test(m[1])) continue;
    const token = m[1].toLowerCase();
    if (!tenants.get(token)) tenants.set(token, company);
  }
  return tenants;
}

// atsLocation is the richer of the two (it carries country); location is the
// display one. Merge both so "Toronto / Ontario / Canada" all reach the matcher.
function jobLocation(job) {
  const l = job.location || {};
  const a = job.atsLocation || {};
  const bits = [l.city || a.city, l.state || a.state || a.province, a.country];
  const text = [...new Set(bits.filter(Boolean))].join(', ');
  return job.isRemote && !text ? 'Remote' : text;
}

const listUrl = (token) => `https://${encodeURIComponent(token)}.bamboohr.com/careers/list`;
const detailUrl = (token, id) => `https://${encodeURIComponent(token)}.bamboohr.com/careers/${encodeURIComponent(id)}/detail`;
const shareUrl = (token, id) => `https://${encodeURIComponent(token)}.bamboohr.com/careers/${encodeURIComponent(id)}`;

async function scrapeTenant(token, company) {
  const { result = [] } = await getJson(listUrl(token), { headers: { Accept: 'application/json' } });

  const hits = [];
  for (const j of result) {
    if (!j.id) continue;
    const candidate = buildJob({
      company,
      title: j.jobOpeningName,
      location: jobLocation(j),
      url: shareUrl(token, j.id),
      source: `bamboohr:${token}`,
    });
    if (candidate) hits.push({ candidate, id: j.id });
  }
  if (!hits.length) return [];

  return (
    await mapLimit(hits, 4, async ({ candidate, id }) => {
      try {
        const { result: detail = {} } = await getJson(detailUrl(token, id), { headers: { Accept: 'application/json' } });
        const opening = detail.jobOpening || {};
        const description = htmlToText(opening.description);
        const url = opening.jobOpeningShareUrl || candidate.url;
        return { ...candidate, url, id: url, description, term: classifyPosting(candidate.title, description) };
      } catch {
        return candidate;
      }
    })
  ).filter(Boolean);
}

export async function scrapeBambooHR(postings) {
  const tenants = harvestBambooTenants(postings);
  if (!tenants.size) return [];

  console.log(`BambooHR: enumerating ${tenants.size} tenant boards`);
  const work = [...tenants].map(([token, company]) => ({ token, company }));
  const results = await mapLimit(work, ATS_CONCURRENCY, ({ token, company }) => scrapeTenant(token, company));
  const reachable = results.filter((r) => r !== null).length;

  const jobs = dedupeByUrl(results);
  console.log(`BambooHR: ${reachable}/${work.length} boards reachable, ${jobs.length} matching jobs ${JSON.stringify(termTally(jobs))}`);
  return jobs;
}
