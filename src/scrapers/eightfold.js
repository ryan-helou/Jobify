import fs from 'node:fs';
import { ATS_CONCURRENCY, EIGHTFOLD_MAX_PAGES, EIGHTFOLD_DOMAINS_PATH } from '../config.js';
import { mapLimit, getJson, htmlToText, dedupeByUrl, termTally } from './http.js';
import { buildJob } from './candidate.js';

// Eightfold, via its public talent-network API. No key, no auth — in theory.
//
//   GET https://{tenant}.eightfold.ai/api/apply/v2/jobs
//         ?domain={corp-domain}&query=intern&num={n}&start={offset}&sort_by=relevance
//     → { count, positions: [{ name, location, locations, canonicalPositionUrl, id }] }
//
// 152 postings across the feeds (Amex, John Deere, Qualcomm, Zebra). Two caveats,
// both real:
//
//   1. The API demands a `domain` param set to the employer's *corporate* domain
//      (aexp.eightfold.ai wants domain=aexp.com), which the eightfold hostname
//      doesn't give us. The heuristic is `{tenant}.com`, correct for the common
//      case and overridable in assets/eightfold-domains.json when it isn't.
//   2. Eightfold fingerprints clients aggressively and soft-blocks datacenter IPs,
//      returning an empty result rather than an error — exactly like Indeed. So on
//      a CI runner this may quietly yield nothing; it works from a residential IP.
//      A miss is empty, never wrong, so it's safe to leave on.

const PAGE = 50;

function loadDomainOverrides() {
  try {
    const parsed = JSON.parse(fs.readFileSync(EIGHTFOLD_DOMAINS_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// Keyed by eightfold host → { company, domain }. The domain is the corporate one the
// API insists on: an override if we have it, else the `{tenant}.com` guess.
export function harvestEightfoldSites(postings, overrides = loadDomainOverrides()) {
  const sites = new Map();
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
    const m = /^([^.]+)\.eightfold\.ai$/i.exec(u.hostname);
    if (!m) continue;
    const host = u.hostname.toLowerCase();
    const tenant = m[1].toLowerCase();
    if (!sites.has(host)) {
      sites.set(host, { company, domain: overrides[host] || overrides[tenant] || `${tenant}.com` });
    } else if (company && !sites.get(host).company) {
      sites.get(host).company = company;
    }
  }
  return sites;
}

function positionLocation(p) {
  const many = Array.isArray(p.locations) ? p.locations : [];
  return [p.location, ...many].filter(Boolean).join(' ; ');
}

async function scrapeSite(host, company, domain) {
  const base = `https://${host}/api/apply/v2/jobs?domain=${encodeURIComponent(domain)}&query=intern&sort_by=relevance&num=${PAGE}`;
  const hits = [];
  for (let page = 0, total = Infinity; page * PAGE < total && page < EIGHTFOLD_MAX_PAGES; page++) {
    const res = await getJson(`${base}&start=${page * PAGE}`, { headers: { Accept: 'application/json' } });
    total = res.count ?? 0;
    const positions = res.positions || [];
    if (!positions.length) break;
    for (const p of positions) {
      const url = p.canonicalPositionUrl || (p.id != null ? `https://${host}/careers/job/${p.id}` : null);
      const job = buildJob({
        company,
        title: p.name,
        location: positionLocation(p),
        url,
        source: `eightfold:${host}`,
        description: htmlToText(p.job_description || p.description || ''),
      });
      if (job) hits.push(job);
    }
  }
  return hits;
}

export async function scrapeEightfold(postings) {
  const sites = harvestEightfoldSites(postings);
  if (!sites.size) return [];

  console.log(`Eightfold: enumerating ${sites.size} employer sites`);
  const work = [...sites].map(([host, { company, domain }]) => ({ host, company, domain }));
  const results = await mapLimit(work, ATS_CONCURRENCY, ({ host, company, domain }) => scrapeSite(host, company, domain));
  const reachable = results.filter((r) => r !== null).length;

  const jobs = dedupeByUrl(results);
  console.log(`Eightfold: ${reachable}/${work.length} sites reachable, ${jobs.length} matching jobs ${JSON.stringify(termTally(jobs))}`);
  return jobs;
}
