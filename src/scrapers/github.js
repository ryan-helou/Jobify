import * as cheerio from 'cheerio';
import {
  CITIES,
  GITHUB_SOURCES,
  ROLE_INCLUDE,
  ROLE_EXCLUDE,
  DEV_INCLUDE,
  NON_DEV_EXCLUDE,
  SENIOR_EXCLUDE,
  DEV_CATEGORIES,
  WANTED_SEASON,
} from '../config.js';
import { termForSource } from '../term.js';

// True when a title looks like a software/developer role we'd want.
// `kind` selects the policy: internship boards must say "intern"; new-grad boards
// are entry-level by construction, so we reject senior/levelled titles instead.
export function isDevRole(title, kind = 'internship') {
  if (!title) return false;
  if (ROLE_EXCLUDE.test(title)) return false; // explicit past/other-year season
  if (NON_DEV_EXCLUDE.test(title)) return false; // clearly non-developer track

  if (kind === 'newgrad') {
    if (SENIOR_EXCLUDE.test(title)) return false;
  } else if (!ROLE_INCLUDE.test(title)) {
    return false; // internship boards: must be intern/new-grad/co-op
  }
  return DEV_INCLUDE.test(title); // must carry a software signal
}

// Picks the highest-priority target city named in a posting's location(s).
// A posting listing both "San Francisco, CA" and "Toronto, ON" resolves to
// Toronto — CITIES is ordered by preference (Montreal first), and preferring the
// Canadian office also avoids a needless visa filter on a role we can take.
export function matchCity(locations) {
  const text = (Array.isArray(locations) ? locations.join(' ; ') : locations || '').toString();
  return CITIES.find((c) => c.match.test(text)) || null;
}

function cellText(html) {
  return cheerio.load(html)('body').text().replace(/\s+/g, ' ').trim();
}

function cellLink(html) {
  const $ = cheerio.load(html);
  return $('a[href]').first().attr('href') || '';
}

// ---- structured listings.json feeds -------------------------------------

export function parseListings(listings, source) {
  const jobs = [];
  for (const l of listings) {
    if (!l || l.active === false || l.is_visible === false) continue; // dead posting
    if (!l.url || !String(l.url).startsWith('http')) continue;
    if (source.kind === 'internship' && l.season && !WANTED_SEASON.test(l.season)) continue;
    if (source.kind === 'newgrad' && l.category && !DEV_CATEGORIES.has(l.category)) continue;
    if (!isDevRole(l.title, source.kind)) continue;

    const city = matchCity(l.locations);
    if (!city) continue;

    jobs.push({
      id: l.id || l.url,
      title: l.title,
      company: l.company_name || 'Unknown',
      location: (Array.isArray(l.locations) ? l.locations : [l.locations]).filter(Boolean).join(', '),
      city: city.key,
      country: city.country,
      url: l.url,
      source: source.name,
      // Authoritative when present; 'Other'/absent means the feed doesn't say.
      sponsorship: l.sponsorship || null,
      term: termForSource(source, l.title),
    });
  }
  return jobs;
}

// ---- markdown README tables ---------------------------------------------

export function parseBoard(markdown, source) {
  const sourceName = typeof source === 'string' ? source : source.name;
  const kind = typeof source === 'string' ? 'internship' : source.kind;
  const jobs = [];
  let columns = null;
  let lastCompany = '';

  for (const line of markdown.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
    if (cells.every((c) => /^[\s:-]*$/.test(c))) continue; // separator row

    const texts = cells.map((c) => c.trim());
    const lower = texts.map((t) => t.toLowerCase());

    if (lower.some((t) => t === 'company')) {
      columns = {
        company: lower.findIndex((t) => t.includes('company')),
        role: lower.findIndex((t) => t.includes('role') || t.includes('position') || t.includes('title')),
        location: lower.findIndex((t) => t.includes('location')),
        link: lower.findIndex((t) => t.includes('link') || t.includes('application') || t.includes('posting') || t.includes('apply')),
      };
      continue;
    }
    if (!columns || columns.company < 0 || columns.role < 0 || columns.link < 0) continue;
    if (texts.length <= Math.max(columns.company, columns.role, columns.location, columns.link)) continue;

    let company = cellText(texts[columns.company]);
    if (company === '↳' || company === '') company = lastCompany;
    else lastCompany = company;

    const title = cellText(texts[columns.role]);
    const location = columns.location >= 0 ? cellText(texts[columns.location].replace(/<\/?br\s*\/?>/gi, ', ')) : '';
    const url = cellLink(texts[columns.link]) || cellLink(texts[columns.company]);

    if (!company || !title || !url || !url.startsWith('http')) continue;
    if (!isDevRole(title, kind)) continue;

    const city = matchCity(location);
    if (!city) continue;

    jobs.push({
      id: url,
      title,
      company,
      location,
      city: city.key,
      country: city.country,
      url,
      source: sourceName,
      sponsorship: null, // markdown tables don't carry it
      term: termForSource(typeof source === 'string' ? null : source, title),
    });
  }
  return jobs;
}

// ---- driver --------------------------------------------------------------

async function scrapeSource(source) {
  const res = await fetch(source.url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  let jobs;
  let postings;
  if (source.type === 'listings') {
    const listings = await res.json();
    // Every posting on the board, not just the ones we want — an apply URL for a
    // Seattle PM role still tells us that company's Greenhouse board token, and
    // its company_name is how we learn that token's real display name.
    postings = listings.filter((l) => l?.url).map((l) => ({ url: l.url, company: l.company_name || '' }));
    jobs = source.harvestOnly ? [] : parseListings(listings, source);
  } else {
    jobs = source.harvestOnly ? [] : parseBoard(await res.text(), source);
    postings = jobs.map((j) => ({ url: j.url, company: j.company }));
  }

  console.log(
    source.harvestOnly
      ? `GitHub board ${source.name}: token mine only, ${postings.length} apply URLs`
      : `GitHub board ${source.name}: ${jobs.length} matching jobs`
  );
  return { jobs, postings };
}

// Returns { jobs, postings } — postings feed ATS board-token harvesting, which
// needs both the apply URL (for the token) and the company name (to label it).
export async function scrapeGithubBoards() {
  const results = await Promise.allSettled(GITHUB_SOURCES.map(scrapeSource));
  const jobs = [];
  const postings = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      jobs.push(...r.value.jobs);
      postings.push(...r.value.postings);
    } else {
      console.error(`GitHub board ${GITHUB_SOURCES[i].name} failed: ${r.reason.message}`);
    }
  });
  return { jobs, postings };
}
