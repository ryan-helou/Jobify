import * as cheerio from 'cheerio';
import { CITIES, GITHUB_SOURCES, ROLE_INCLUDE, ROLE_EXCLUDE, DEV_INCLUDE, NON_DEV_EXCLUDE } from '../config.js';

// True when a role title looks like a software/developer internship we want.
export function isDevRole(title) {
  if (!ROLE_INCLUDE.test(title)) return false; // must be intern/new-grad/entry-level
  if (ROLE_EXCLUDE.test(title)) return false; // explicit past/other-year season
  if (NON_DEV_EXCLUDE.test(title)) return false; // clearly non-developer track
  return DEV_INCLUDE.test(title); // must carry a software signal
}

// Parses markdown job tables from GitHub internship boards. Column layouts differ
// between repos (Role vs Position, Application/Link vs Posting), so the parser
// maps columns from the header row instead of assuming positions.

function cellText(html) {
  return cheerio.load(html)('body').text().replace(/\s+/g, ' ').trim();
}

function cellLink(html) {
  const $ = cheerio.load(html);
  return $('a[href]').first().attr('href') || '';
}

function matchCity(location) {
  return CITIES.find((c) => c.match.test(location)) || null;
}

export function parseBoard(markdown, sourceName) {
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
    if (!isDevRole(title)) continue;

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
    });
  }
  return jobs;
}

export async function scrapeGithubBoards() {
  const jobs = [];
  for (const source of GITHUB_SOURCES) {
    try {
      const res = await fetch(source.url);
      if (!res.ok) {
        console.error(`GitHub board ${source.name}: HTTP ${res.status}, skipping`);
        continue;
      }
      const found = parseBoard(await res.text(), source.name);
      console.log(`GitHub board ${source.name}: ${found.length} matching jobs`);
      jobs.push(...found);
    } catch (err) {
      console.error(`GitHub board ${source.name} failed: ${err.message}`);
    }
  }
  return jobs;
}
