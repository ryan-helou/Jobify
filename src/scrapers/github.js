import * as cheerio from 'cheerio';
import {
  CITIES,
  CANADA_ANY,
  CANADA_FALLBACK,
  GITHUB_SOURCES,
  ROLE_INCLUDE,
  ROLE_EXCLUDE,
  DEV_INCLUDE,
  NON_DEV_EXCLUDE,
  SENIOR_EXCLUDE,
  DEV_CATEGORIES,
  WANTED_SEASON,
  SPONSORSHIP_MARKERS,
} from '../config.js';
import { termForSource } from '../term.js';

// True when a title looks like a software/developer role we'd want.
// `kind` selects the policy:
//   internship → the board mixes role types, so the title must say intern/co-op
//   newgrad    → entry-level by construction; reject senior/levelled titles instead
//   campus     → a student/campus portal. Every posting is an internship whether or
//                not it says so: BMO advertises "Application developer" on its
//                Campus site. Demanding an intern token there loses real roles.
export function isDevRole(title, kind = 'internship') {
  if (!title) return false;
  if (ROLE_EXCLUDE.test(title)) return false; // explicit past/other-year season
  if (NON_DEV_EXCLUDE.test(title)) return false; // clearly non-developer track

  if (kind === 'newgrad' || kind === 'campus') {
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
  const hub = CITIES.find((c) => c.match.test(text));
  if (hub) return hub;
  // Anywhere else in Canada still counts. A US posting must never reach here as
  // Canadian: the US hubs were tried above, and CANADA_ANY only fires on Canada
  // context, so "Austin, TX" stays unplaced (null) while "Halifax, NS" is kept.
  if (CANADA_ANY.test(text)) return CANADA_FALLBACK;
  return null;
}

// A table cell's visible text. Cells mix HTML and markdown: a company may be an
// `<a>` tag, plain text, or a markdown `**[Name](url)**` (resumax writes the last).
// Collapse the markdown link to its text and drop emphasis markers before letting
// cheerio strip any HTML, so the company reads "Gumloop", not "**[Gumloop](…)**".
function cellText(html) {
  const demarkdowned = String(html)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) → text
    .replace(/[*`]/g, ''); // bold/italic/code emphasis markers
  return cheerio.load(demarkdowned)('body').text().replace(/\s+/g, ' ').trim();
}

// Badge images and icons are links too, and they are never the apply URL.
const BADGE_ASSET = /img\.shields\.io|badgen\.net|\.(?:png|svg|gif|jpe?g)(?:$|\?)/i;

// Boards write the apply link three ways, and only the first is HTML:
//
//   <a href="https://…">Apply</a>          speedyapply, vanshb03
//   [apply](https://…)                     sndsh404
//   [![Apply](badge.svg)](https://…)       negarprh — an image *inside* a link
//
// Cheerio sees no anchor in the last two, so a naive `a[href]` lookup returns ''
// and every row is silently dropped at the caller's `!url` guard. Falling back to
// markdown link syntax fixes that; the badge filter is what keeps the third form
// from yielding the shields.io image URL instead of the job.
function cellLink(html) {
  const anchor = cheerio.load(html)('a[href]').first().attr('href');
  if (anchor) return anchor;

  const links = [...String(html).matchAll(/\]\(\s*(https?:\/\/[^\s)]+)\s*\)/g)]
    .map((m) => m[1])
    .filter((url) => !BADGE_ASSET.test(url));
  // `[![alt](badge)](real)` nests the real link outermost, so it matches last.
  return links.at(-1) || '';
}

// Markdown boards have no sponsorship column, but several flag it with an emoji in
// the role title. Reading it saves rendering the posting to reach the same verdict.
function markerSponsorship(title) {
  return SPONSORSHIP_MARKERS.find((m) => m.re.test(title))?.value || null;
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
      sponsorship: markerSponsorship(title),
      term: termForSource(typeof source === 'string' ? null : source, title),
    });
  }
  return jobs;
}

// ---- driver --------------------------------------------------------------

// Badge images and repo links outnumber real apply URLs in these READMEs.
const NOT_AN_APPLY_URL = /img\.shields\.io|badgen\.net|\.(?:png|svg|gif|jpe?g)(?:$|\?)|github\.com|githubusercontent\.com/i;

// A harvest-only markdown board is read for apply URLs alone, so we never parse its
// table. That matters: the Canadian boards write links as markdown `[Apply](url)`
// rather than `<a href>`, which parseBoard's cellLink can't see — but a plain URL
// sweep doesn't care how the link was written.
function harvestMarkdownUrls(markdown) {
  return [...markdown.matchAll(/https?:\/\/[^\s)"'<>\]]+/g)]
    .map((m) => m[0])
    .filter((url) => !NOT_AN_APPLY_URL.test(url));
}

async function scrapeSource(source) {
  const res = await fetch(source.url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {}); // an unread body wedges undici's parser
    throw new Error(`HTTP ${res.status}`);
  }

  let jobs;
  let postings;
  if (source.type === 'listings') {
    const raw = await res.json();
    // Some feeds aren't the SimplifyJobs array shape — zshah101 keys its jobs by id
    // and calls the fields `company`/`location`/`is_open`. A source's optional `map`
    // normalizes its payload into the { url, company_name, title, locations, ... }
    // shape parseListings and the harvester below both expect.
    const listings = source.map ? source.map(raw) : raw;
    // Every posting on the board, not just the ones we want — an apply URL for a
    // Seattle PM role still tells us that company's Greenhouse board token, and
    // its company_name is how we learn that token's real display name.
    postings = listings.filter((l) => l?.url).map((l) => ({ url: l.url, company: l.company_name || '' }));
    jobs = source.harvestOnly ? [] : parseListings(listings, source);
  } else {
    const markdown = await res.text();
    if (source.harvestOnly) {
      jobs = [];
      postings = harvestMarkdownUrls(markdown).map((url) => ({ url, company: '' }));
    } else {
      jobs = parseBoard(markdown, source);
      postings = jobs.map((j) => ({ url: j.url, company: j.company }));
    }
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
