import { ATS_CONCURRENCY, ICIMS_MAX_PAGES } from '../config.js';
import { isDevRole } from './github.js';
import { mapLimit, getText, htmlToText, dedupeByUrl, termTally } from './http.js';
import { buildJob } from './candidate.js';

// iCIMS — by far the biggest ATS we couldn't read (1,351 postings across the feeds).
// It has no JSON API, but two things make it tractable:
//
//   1. The hosted search page lists job links we can page through:
//      GET https://{host}/jobs/search?ss=1&pr={page}&in_iframe=1&searchKeyword=intern
//        → HTML with <a href=".../jobs/{id}/{slug}/job"> per result
//   2. Every job page embeds a schema.org JobPosting as ld+json — title, a proper
//      PostalAddress, employmentType and the full description — so we never scrape
//      brittle per-tenant markup for the fields that matter.
//
// Each employer runs its own subdomain (careers-gdms.icims.com, jobs-nnn.icims.com),
// so the whole hostname is the identity — there's no shared tenant slug to parse.
//
// Two passes: the search page gives cheap (id, slug) pairs, the slug approximates
// the title well enough to pre-filter with isDevRole, and only survivors cost a
// detail fetch. The slug→title guess is deliberately loose (kebab → spaces); the
// authoritative title comes from the JSON-LD on the detail page.

// iCIMS' own infrastructure subdomains, not employer boards.
const VENDOR_HOST = /^(?:www|login|configure|secure|hire|internal|admin|api)\.icims\.com$/i;

export function harvestIcimsSites(postings) {
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
    if (!/\.icims\.com$/i.test(u.hostname) || VENDOR_HOST.test(u.hostname)) continue;
    const host = u.hostname.toLowerCase();
    if (!sites.get(host)) sites.set(host, company);
  }
  return sites;
}

const JOB_LINK = /\/jobs\/(\d+)\/([^/"?]+)\/(?:login|job)/gi;

// Rough title for the pre-filter: the slug is the title, kebab-cased and
// percent-encoded. Good enough for a keyword gate, not for display.
function slugToTitle(slug) {
  let s = slug;
  try {
    s = decodeURIComponent(slug);
  } catch {
    /* keep raw */
  }
  return s.replace(/-+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Pull the schema.org JobPosting out of a job page. There can be several ld+json
// blocks (BreadcrumbList, Organization); we want the JobPosting one.
function jobPostingLd(html) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    try {
      const data = JSON.parse(b[1].trim());
      const items = Array.isArray(data) ? data : [data];
      const posting = items.find((d) => d && (d['@type'] === 'JobPosting' || (Array.isArray(d['@type']) && d['@type'].includes('JobPosting'))));
      if (posting) return posting;
    } catch {
      /* malformed block — try the next */
    }
  }
  return null;
}

function ldLocation(ld) {
  const places = Array.isArray(ld.jobLocation) ? ld.jobLocation : [ld.jobLocation].filter(Boolean);
  return places
    .map((p) => {
      const a = p?.address || {};
      return [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(', ');
    })
    .filter(Boolean)
    .join(' ; ');
}

async function scrapeSite(host, company) {
  // Page the search results, collecting unique (id, slug). searchKeyword narrows
  // server-side; we stop when a page adds nothing new or the cap is hit.
  const found = new Map();
  for (let pr = 0; pr < ICIMS_MAX_PAGES; pr++) {
    let html;
    try {
      html = await getText(`https://${host}/jobs/search?ss=1&pr=${pr}&in_iframe=1&searchKeyword=intern`);
    } catch {
      break; // a dead page ends paging rather than losing the site
    }
    let added = 0;
    for (const m of html.matchAll(JOB_LINK)) {
      const [, id, slug] = m;
      if (found.has(id)) continue;
      found.set(id, slug);
      added++;
    }
    if (!added) break;
  }
  if (!found.size) return [];

  // Cheap pre-filter on the slug-derived title before paying for detail fetches.
  const candidates = [...found].filter(([, slug]) => isDevRole(slugToTitle(slug), 'internship'));
  if (!candidates.length) return [];

  return (
    await mapLimit(candidates, 4, async ([id, slug]) => {
      const url = `https://${host}/jobs/${id}/${slug}/job`;
      let html;
      try {
        // `?in_iframe=1` is load-bearing: the bare job URL returns the full careers-site
        // shell (hundreds of KB, no structured data), while the iframe view returns the
        // lean page that actually carries the schema.org JobPosting. We store the clean
        // URL for the human and parse the iframe one.
        html = await getText(`${url}?in_iframe=1`);
      } catch {
        return null; // couldn't read the page — no reliable title/location, so skip
      }
      const ld = jobPostingLd(html);
      if (!ld || !ld.title) return null;
      return buildJob({
        company: company || ld.hiringOrganization?.name,
        title: ld.title,
        location: ldLocation(ld),
        url,
        source: `icims:${host}`,
        description: htmlToText(ld.description),
      });
    })
  ).filter(Boolean);
}

export async function scrapeIcims(postings) {
  const sites = harvestIcimsSites(postings);
  if (!sites.size) return [];

  console.log(`iCIMS: enumerating ${sites.size} employer sites`);
  const work = [...sites].map(([host, company]) => ({ host, company }));
  const results = await mapLimit(work, ATS_CONCURRENCY, ({ host, company }) => scrapeSite(host, company));
  const reachable = results.filter((r) => r !== null).length;

  const jobs = dedupeByUrl(results);
  console.log(`iCIMS: ${reachable}/${work.length} sites reachable, ${jobs.length} matching jobs ${JSON.stringify(termTally(jobs))}`);
  return jobs;
}
