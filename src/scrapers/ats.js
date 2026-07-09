import { ATS_CONCURRENCY } from '../config.js';
import { isDevRole, matchCity } from './github.js';
import { classifyPosting } from '../term.js';
import { mapLimit, getJson, htmlToText } from './http.js';

// Enumerates company job boards directly through the public ATS APIs.
//
// The GitHub boards are hand-curated slices of these same boards, so they lag by
// days and omit plenty. But their apply URLs hand us the board tokens for free:
// `job-boards.greenhouse.io/figureai/jobs/123` means Figure AI's Greenhouse board
// is `figureai`, and `boards-api.greenhouse.io/v1/boards/figureai/jobs` lists
// everything on it. All three APIs are public and need no key.
//
// Greenhouse is fetched in two passes — the board listing has no descriptions and
// asking for them (`?content=true`) returns megabytes per board. Lever and Ashby
// include the description in the board response, so one pass suffices.

const ATS = {
  greenhouse: {
    host: /(^|\.)(greenhouse\.io|grnh\.se)$/i,
    board: (t) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(t)}/jobs`,
    meta: (t) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(t)}`,
  },
  ashby: {
    host: /(^|\.)ashbyhq\.com$/i,
    board: (t) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(t)}?includeCompensation=true`,
  },
  lever: {
    host: /(^|\.)lever\.co$/i,
    board: (t) => `https://api.lever.co/v0/postings/${encodeURIComponent(t)}?mode=json`,
  },
};

// Vendor demo boards carry fake postings ("leverdemo" lists an "Engineering Intern").
// Anchored rather than substring-matched, so real companies whose names merely
// contain these words survive: Demodesk, demandbase, testudo.
const DEMO_BOARD =
  /^(?:lever|greenhouse|ashby)?(?:demo|test|sandbox|example|staging)$|(^|[-_])(?:demo|test|sandbox|example|staging)([-_]|$)/i;

// The board token usually sits in the first path segment, but not always:
//
//   job-boards.greenhouse.io/haizelabs/jobs/123   → "haizelabs"
//   job-boards.greenhouse.io/embed/job_app?for=point72 → "point72"  (query, not path)
//   grnh.se/a1b2c3                                → none; that's a link hash, and
//                                                   treating it as a board token
//                                                   just 404s a request per link
//
// Boards named after the company may be percent-encoded ("Citizen%20Health").
function boardToken(u, ats) {
  const seg = u.pathname.split('/').filter(Boolean)[0];
  if (ats === 'greenhouse') {
    if (/(^|\.)grnh\.se$/i.test(u.hostname)) return null; // shortlink, not a board
    if (seg === 'embed') return u.searchParams.get('for'); // embedded board/app form
  }
  if (!seg) return null;
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

// Maps each ATS board token to the employer's display name.
//
// Neither the Ashby nor the Lever board API returns a company name, so a job
// scraped straight off a board would otherwise be filed under its raw token —
// "ellipsislabs", "rivianvw.tech", "ctgt". Those names reach Slack and the
// dashboard, and they don't match the "Ellipsis Labs" the GitHub feeds use, which
// weakens identity dedup. The feeds pair every apply URL with a proper
// `company_name`, so the token→name mapping is already sitting in the input.
//
// Accepts `{url, company}` postings, or bare URL strings when no name is known.
export function harvestBoardTokens(postings) {
  const tokens = { greenhouse: new Map(), ashby: new Map(), lever: new Map() };
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

    const entry = Object.entries(ATS).find(([, spec]) => spec.host.test(u.hostname));
    if (!entry) continue;
    const [name] = entry;

    const token = boardToken(u, name);
    if (!token || DEMO_BOARD.test(token)) continue;

    // First non-empty name wins; a later URL without one must not erase it.
    if (!tokens[name].get(token)) tokens[name].set(token, company);
  }
  return tokens;
}

function candidate(company, title, location, url, ats, description, compensation = '') {
  if (!url || !title) return null;
  if (!isDevRole(title, 'internship')) return null;
  const city = matchCity(location);
  if (!city) return null;
  return {
    id: url,
    title,
    company,
    location: String(location || ''),
    city: city.key,
    country: city.country,
    url,
    source: `ats:${ats}`,
    sponsorship: null, // company boards don't carry a curated field
    description: description || '',
    // Ashby states pay in a structured field; the others bury it in the prose,
    // where the scorer's pay regex has to find it.
    compensation: compensation || '',
    term: classifyPosting(title, description),
  };
}

async function scrapeGreenhouse(token, knownCompany) {
  const { jobs = [] } = await getJson(ATS.greenhouse.board(token));

  // Pass 1: cheap filter on title + location; no descriptions fetched yet.
  const hits = [];
  for (const j of jobs) {
    const c = candidate(knownCompany || token, j.title, j.location?.name || '', j.absolute_url, 'greenhouse', '');
    if (c) hits.push({ candidate: c, id: j.id });
  }
  if (!hits.length) return [];

  // The jobs endpoint never names the employer, so the board token stands in
  // ("skhynixmemorysolutionsamericainc"). That would break identity dedup against
  // the GitHub feeds, which say "SK Hynix". Prefer the name the feed already gave
  // us; only pay for a metadata request when we don't have one.
  const company =
    knownCompany ||
    (await getJson(ATS.greenhouse.meta(token))
      .then((m) => m.name || token)
      .catch(() => token));

  // Pass 2: only the survivors cost a description fetch. A failed description
  // must not lose the job — it just leaves the term unstated, which means a human
  // looks at it rather than it vanishing.
  const enriched = await mapLimit(hits, 4, async ({ candidate: c, id }) => {
    if (!id) return { ...c, company };
    try {
      const full = await getJson(`${ATS.greenhouse.board(token)}/${id}`);
      const description = htmlToText(full.content);
      return { ...c, company, description, term: classifyPosting(c.title, description) };
    } catch {
      return { ...c, company };
    }
  });
  return enriched.filter(Boolean);
}

async function scrapeAshby(token, knownCompany) {
  const { jobs = [] } = await getJson(ATS.ashby.board(token));
  return jobs
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const locations = [j.location, ...(j.secondaryLocations || []).map((s) => s?.location || s)]
        .filter(Boolean)
        .join(' ; ');
      const pay = j.compensation?.compensationTierSummary || j.compensation?.scrapeableCompensationSalarySummary || '';
      return candidate(knownCompany || token, j.title, locations, j.jobUrl || j.applyUrl, 'ashby', j.descriptionPlain, pay);
    })
    .filter(Boolean);
}

async function scrapeLever(token, knownCompany) {
  const jobs = await getJson(ATS.lever.board(token));
  return (Array.isArray(jobs) ? jobs : [])
    .map((j) =>
      candidate(
        knownCompany || token,
        j.text,
        j.categories?.location || '',
        j.hostedUrl,
        'lever',
        `${j.descriptionPlain || ''} ${j.additionalPlain || ''}`
      )
    )
    .filter(Boolean);
}

const SCRAPERS = { greenhouse: scrapeGreenhouse, ashby: scrapeAshby, lever: scrapeLever };

export async function scrapeAtsBoards(postings) {
  const tokens = harvestBoardTokens(postings);
  const work = Object.entries(tokens).flatMap(([ats, map]) =>
    [...map].map(([token, company]) => ({ ats, token, company }))
  );
  if (!work.length) return [];

  console.log(
    `ATS: enumerating ${work.length} company boards ` +
      `(${tokens.greenhouse.size} greenhouse, ${tokens.ashby.size} ashby, ${tokens.lever.size} lever)`
  );

  const results = await mapLimit(work, ATS_CONCURRENCY, ({ ats, token, company }) => SCRAPERS[ats](token, company));
  const reachable = results.filter((r) => r !== null).length;

  const seen = new Set();
  const jobs = [];
  for (const list of results) {
    for (const job of list || []) {
      if (seen.has(job.url)) continue;
      seen.add(job.url);
      jobs.push(job);
    }
  }

  const byTerm = jobs.reduce((acc, j) => ({ ...acc, [j.term]: (acc[j.term] || 0) + 1 }), {});
  console.log(`ATS: ${reachable}/${work.length} boards reachable, ${jobs.length} matching jobs ${JSON.stringify(byTerm)}`);
  return jobs;
}
