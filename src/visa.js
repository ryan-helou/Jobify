import * as cheerio from 'cheerio';
import { VISA_KEYWORDS } from './config.js';

export function mentionsSponsorship(text) {
  const lower = (text || '').toLowerCase();
  return VISA_KEYWORDS.some((kw) => lower.includes(kw));
}

// For US jobs sourced from GitHub boards, fetch the posting page and scan its
// text for explicit sponsorship language. No mention → the job is skipped.
export async function fetchPostingText(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return '';
    const $ = cheerio.load(await res.text());
    $('script, style').remove();
    return $('body').text();
  } catch {
    return '';
  }
}
