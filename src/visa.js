import * as cheerio from 'cheerio';
import { VISA_KEYWORDS, VISA_NEGATIONS, SPONSORSHIP_VERDICT } from './config.js';

// The listings feeds state sponsorship explicitly for some jobs. Trust that when
// present — it's curated, and it saves rendering the posting entirely.
// Returns 'offers' | 'denies' | 'unknown'.
export function feedSponsorshipVerdict(job) {
  return SPONSORSHIP_VERDICT[job?.sponsorship] || 'unknown';
}

// Returns true only when the text explicitly offers sponsorship AND doesn't also
// state it won't sponsor. A negation ("unable to provide sponsorship") wins,
// because those pages often list H-1B in a "we do not offer" sentence.
export function mentionsSponsorship(text) {
  const lower = (text || '').toLowerCase();
  if (!VISA_KEYWORDS.some((kw) => lower.includes(kw))) return false;
  if (VISA_NEGATIONS.some((neg) => lower.includes(neg))) return false;
  return true;
}

// Renders a posting with Playwright (many boards — workatastartup, Ashby, Workday —
// are JS-rendered, so a plain fetch returns an empty shell). Falls back to a raw
// fetch if the render fails.
export async function fetchPostingText(context, url) {
  let page;
  try {
    page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => document.body?.innerText || '');
    if (text && text.trim().length > 200) return text;
  } catch {
    /* fall through to raw fetch */
  } finally {
    if (page) await page.close().catch(() => {});
  }

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {}); // an unread body wedges undici's parser
      return '';
    }
    const $ = cheerio.load(await res.text());
    $('script, style, noscript').remove();
    return $('body').text();
  } catch {
    return '';
  }
}
