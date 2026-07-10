import * as cheerio from 'cheerio';
import { JOBBANK_NOC_CODES } from '../config.js';
import { getText } from './http.js';
import { buildJob } from './candidate.js';

// Canada's National Job Bank, via its public Atom search feed. No key, no auth.
//
//   GET /jobsearch/feed/jobSearchRSSfeed?fn21={noc}&fn21={noc}&sort=D&rows=100
//     → <feed><entry>
//         <title>software developer</title>
//         <link href="https://www.jobbank.gc.ca/jobsearch/jobposting/49880946"/>
//         <summary>Job number: … Location: Toronto (ON) Employer: … Salary: …</summary>
//       </entry>...
//
// The government's own posting board — the one source here that reaches employers
// running no ATS Jobify can read (municipalities, smaller Canadian firms). The
// `fn21` params filter by NOC occupation code; without them the feed ignores the
// `term` query and returns every recent posting regardless of field. isDevRole then
// keeps only the intern/co-op titles, so most full-time dev roles fall out — Job
// Bank is low-volume for internships, but every hit is a real Canadian posting.
//
// One pass: the feed has no description, so the term classifies from the title
// alone (usually 'unstated' → a human looks) and location comes from the summary.

const FEED = 'https://www.jobbank.gc.ca/jobsearch/feed/jobSearchRSSfeed';

const feedUrl = () => `${FEED}?${JOBBANK_NOC_CODES.map((c) => `fn21=${c}`).join('&')}&sort=D&rows=100`;

// The summary is a run of `<strong>Label:</strong> value<br/>` pairs.
function summaryField(summary, label) {
  const m = new RegExp(`${label}:</strong>\\s*([^<]+)`, 'i').exec(summary || '');
  return m ? m[1].trim() : '';
}

// Job Bank writes "Toronto (ON)"; matchCity's Canada patterns expect "Toronto, ON",
// so turn the parenthesised province into the comma form the matcher recognises —
// without it every non-hub Canadian city (London, Halifax…) fails the city gate.
const normalizeLocation = (loc) => loc.replace(/\s*\(([A-Za-z]{2})\)\s*$/, ', $1');

// Pure: Atom XML → board jobs. Exported for testing without the network.
export function parseJobBankFeed(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const jobs = [];
  $('entry').each((_, e) => {
    const title = $(e).children('title').text().trim();
    const url = $(e).children('link').attr('href');
    // The summary is escaped HTML (`<strong>Location:</strong> …<br/>`); summaryField
    // reads the raw markup, so don't strip the tags first.
    const summary = $(e).children('summary').text();
    const job = buildJob({
      company: summaryField(summary, 'Employer') || 'Unknown',
      title,
      location: normalizeLocation(summaryField(summary, 'Location')),
      url,
      source: 'jobbank',
    });
    if (job) jobs.push(job);
  });
  return jobs;
}

export async function scrapeJobBank() {
  let xml;
  try {
    xml = await getText(feedUrl(), { headers: { Accept: 'application/atom+xml, application/xml' } });
  } catch (err) {
    console.error(`Job Bank feed failed: ${err.message}`);
    return { jobs: [], postings: [] };
  }

  const jobs = parseJobBankFeed(xml);
  console.log(`Job Bank: ${jobs.length} matching Canadian postings`);
  return { jobs, postings: [] }; // apply URLs are jobbank.gc.ca pages, not ATS boards
}
