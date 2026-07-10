import * as cheerio from 'cheerio';
import { ATS_CONCURRENCY } from '../config.js';
import { mapLimit, getText, htmlToText, dedupeByUrl, termTally } from './http.js';
import { buildJob } from './candidate.js';

// Personio, via its public XML job feed. No key, no auth, one pass — the feed
// carries the full description inline.
//
//   GET https://{tenant}.jobs.personio.de/xml   (also .com)
//     → <workzag-jobs><position>
//         <id/><office/><additionalOffices><office/></additionalOffices>
//         <name/><jobDescriptions><jobDescription><value/></jobDescription></jobDescriptions>
//       </position>...
//
// Zero postings across the current feeds — Personio is European-first — so in
// practice this only fires on employers turned up by discovery. Included because it
// was on the target list and the feed is trivial; NA-office roles will match our
// cities, EU-only ones fall out at the city gate, which is correct.

const NOT_A_TENANT = /^(?:www|api|help|support|status|blog|jobs)$/i;

// Personio hosts are {tenant}.jobs.personio.{de,com}; the tenant is the first label.
export function harvestPersonioTenants(postings) {
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
    const m = /^([^.]+)\.jobs\.personio\.(?:de|com)$/i.exec(u.hostname);
    if (!m || NOT_A_TENANT.test(m[1])) continue;
    const token = m[1].toLowerCase();
    const tld = u.hostname.toLowerCase().endsWith('.com') ? 'com' : 'de';
    if (!tenants.get(token)) tenants.set(token, { company, tld });
  }
  return tenants;
}

function positionLocation($, pos) {
  const offices = [$(pos).children('office').text().trim()];
  $(pos)
    .children('additionalOffices')
    .children('office')
    .each((_, o) => offices.push($(o).text().trim()));
  return [...new Set(offices.filter(Boolean))].join(' ; ');
}

async function scrapeTenant(token, company, tld) {
  const host = `${token}.jobs.personio.${tld}`;
  const xml = await getText(`https://${host}/xml`, { headers: { Accept: 'application/xml, text/xml' } });
  const $ = cheerio.load(xml, { xmlMode: true });

  const jobs = [];
  $('position').each((_, pos) => {
    const id = $(pos).children('id').text().trim();
    const title = $(pos).children('name').text().trim();
    if (!id || !title) return;
    const description = htmlToText(
      $(pos)
        .find('jobDescriptions value, jobDescriptions jobDescription value')
        .map((__, v) => $(v).text())
        .get()
        .join(' ')
    );
    const job = buildJob({
      company,
      title,
      location: positionLocation($, pos),
      url: `https://${host}/job/${encodeURIComponent(id)}`,
      source: `personio:${token}`,
      description,
    });
    if (job) jobs.push(job);
  });
  return jobs;
}

export async function scrapePersonio(postings) {
  const tenants = harvestPersonioTenants(postings);
  if (!tenants.size) return [];

  console.log(`Personio: enumerating ${tenants.size} tenant feeds`);
  const work = [...tenants].map(([token, { company, tld }]) => ({ token, company, tld }));
  const results = await mapLimit(work, ATS_CONCURRENCY, ({ token, company, tld }) => scrapeTenant(token, company, tld));
  const reachable = results.filter((r) => r !== null).length;

  const jobs = dedupeByUrl(results);
  console.log(`Personio: ${reachable}/${work.length} feeds reachable, ${jobs.length} matching jobs ${JSON.stringify(termTally(jobs))}`);
  return jobs;
}
