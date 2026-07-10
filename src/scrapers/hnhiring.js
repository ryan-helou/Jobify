import * as cheerio from 'cheerio';
import { getJson } from './http.js';

// Hacker News "Ask HN: Who is hiring?" — the monthly thread, via the free Algolia
// HN Search API. No key, no auth.
//
//   GET /api/v1/search_by_date?tags=story,author_whoishiring&query=hiring
//     → newest first; pick the "Who is hiring?" story (not the freelancer/seeking ones)
//   GET /api/v1/items/{objectID}
//     → { children: [{ text, ... }] }   one top-level comment per hiring company
//
// Harvest-only. Each comment is free text ("Company | Role | Location | REMOTE | url"),
// too irregular to parse into structured jobs reliably — but the apply URL in it is
// unambiguous, and it very often points at an ATS board (Greenhouse, Lever, Ashby,
// Workable…). So we mine the URLs and let the ATS scrapers enumerate them; a comment
// with no link contributes nothing, which is fine.

const SEARCH = 'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=hiring&hitsPerPage=10';
const item = (id) => `https://hn.algolia.com/api/v1/items/${id}`;

// Hosts that are never a job's apply URL: HN itself and the badge/image CDNs.
const BLOCK_HOST = /(^|\.)(news\.ycombinator\.com|ycombinator\.com|algolia\.com|img\.shields\.io|badgen\.net)$/i;
const IMAGE_URL = /\.(?:png|svg|gif|jpe?g)(?:$|\?)/i;

// Algolia hands the comment back as HTML with the URLs entity-encoded — `/` as
// `&#x2F;`, `&` as `&amp;` — so a plain https:// regex never matches. cheerio parses
// the markup and hands back decoded href attributes; we then filter on the parsed
// hostname (matching the raw URL string would trip on a blocked domain in a path).
export function urlsIn(html) {
  const $ = cheerio.load(String(html || ''));
  const urls = [];
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    if (!href || !/^https?:\/\//i.test(href) || IMAGE_URL.test(href)) return;
    let host;
    try {
      host = new URL(href).hostname;
    } catch {
      return;
    }
    if (!BLOCK_HOST.test(host)) urls.push(href);
  });
  return urls;
}

export async function scrapeHnHiring() {
  let story;
  try {
    const search = await getJson(SEARCH);
    story = (search.hits || []).find((h) => /who is hiring/i.test(h.title || ''));
  } catch (err) {
    console.error(`HN search failed: ${err.message}`);
    return { jobs: [], postings: [] };
  }
  if (!story) return { jobs: [], postings: [] };

  let tree;
  try {
    tree = await getJson(item(story.objectID));
  } catch (err) {
    console.error(`HN thread ${story.objectID} failed: ${err.message}`);
    return { jobs: [], postings: [] };
  }

  const seen = new Set();
  const postings = [];
  for (const child of tree.children || []) {
    for (const url of urlsIn(child.text)) {
      if (seen.has(url)) continue;
      seen.add(url);
      postings.push({ url, company: '' }); // name isn't reliably parseable from the prose
    }
  }

  console.log(`HN "${story.title}": token mine only, ${postings.length} apply URLs from ${(tree.children || []).length} comments`);
  return { jobs: [], postings };
}
