import { THEMUSE_MAX_PAGES } from '../config.js';
import { getJson, htmlToText } from './http.js';
import { buildJob } from './candidate.js';

// The Muse, via its public jobs API. No key (unauthenticated callers are rate-limited
// but not blocked), one pass — each result carries its full description.
//
//   GET /api/public/jobs?category=Software Engineering&level=Internship&page={n}
//     → { page, page_count, results: [{ name, company:{name}, locations:[{name}],
//                                       contents, refs:{landing_page} }] }
//
// ~750 internships tagged Software Engineering. Its categories are loose (a Walmart
// "Area Manager" shows up under Software Engineering), so isDevRole does the real
// filtering; its locations are US-wide, so matchCity keeps the NYC/SF ones. The
// landing_page is a themuse.com redirect, not an ATS URL, so there's nothing to
// harvest — jobs only.

const API = 'https://www.themuse.com/api/public/jobs';

export async function scrapeTheMuse() {
  const jobs = [];
  let pageCount = 1;
  for (let page = 1; page <= Math.min(pageCount, THEMUSE_MAX_PAGES); page++) {
    let res;
    try {
      res = await getJson(`${API}?category=${encodeURIComponent('Software Engineering')}&level=Internship&page=${page}`);
    } catch (err) {
      // The Muse throttles hard; a 429 mid-paging keeps what we have rather than losing it.
      if (page === 1) console.error(`The Muse feed failed: ${err.message}`);
      break;
    }
    pageCount = res.page_count || 1;
    for (const r of res.results || []) {
      const location = (r.locations || []).map((l) => l.name).filter(Boolean).join(' ; ');
      const job = buildJob({
        company: r.company?.name,
        title: r.name,
        location,
        url: r.refs?.landing_page,
        source: 'themuse',
        description: htmlToText(r.contents),
      });
      if (job) jobs.push(job);
    }
  }

  console.log(`The Muse: ${jobs.length} matching internships`);
  return { jobs, postings: [] };
}
