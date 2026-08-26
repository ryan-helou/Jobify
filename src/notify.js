import {
  SLACK_WEBHOOK_URL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  NOTIFY_MIN_CHANCE,
  NOTIFY_MAX_ITEMS,
  DASHBOARD_URL,
} from './config.js';

// The board pings you when genuinely-new postings land. Two channels are supported;
// use whichever you like, or both, or neither (then pings just log). A channel that
// isn't configured is silently skipped — a job board must never fail a run because a
// webhook is missing.

export async function slack(text) {
  if (!SLACK_WEBHOOK_URL) {
    console.log(`[slack disabled] ${text}`);
    return;
  }
  try {
    const res = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) console.error(`Slack webhook failed: HTTP ${res.status}`);
  } catch (err) {
    console.error(`Slack webhook error: ${err.message}`);
  }
}

// Telegram Bot API sendMessage. HTML parse mode, because job titles carry characters
// Markdown would need escaped; page previews are off so a run of new postings doesn't
// unfurl into a wall of link cards.
export async function telegram(html) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    if (!SLACK_WEBHOOK_URL) console.log('[telegram disabled] (no bot token / chat id)');
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: html,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`Telegram sendMessage failed: HTTP ${res.status} ${detail}`);
    }
  } catch (err) {
    console.error(`Telegram error: ${err.message}`);
  }
}

const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const escSlack = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const CITY_SHORT = { montreal: 'Montreal', remote: 'Remote (Canada)', nyc: 'New York' };
const place = (r) => CITY_SHORT[r.city] || r.city || '';

// The real posting location, not the city bucket — a "canada" row could be Halifax or
// Vancouver, and that's exactly the thing worth knowing. First location only.
const locOf = (r) => ((r.location || '').split(/\s*[;|]\s*/)[0].trim() || place(r));

const TERM_SHORT = { '2027': 'Summer 2027', exempt: '2027 cycle', unstated: 'term not stated' };

// Sponsorship matters where it's needed: a US role for a Canadian. It no longer moves
// any score (see src/score.js), but a New York posting that says outright it won't
// sponsor is still worth knowing before you spend an evening on the form. Canadian
// roles say nothing at all rather than repeating "no visa needed" on every line.
function visaNote(r) {
  if (r.country !== 'US') return null;
  return r.sponsorship === 'offers' ? 'sponsors visa'
    : r.sponsorship === 'denies' ? 'no sponsorship'
    : 'sponsorship not stated';
}

// The per-role second line: location · quality · term · visa. Quality rides here
// rather than next to the headline number because the headline answers "should I
// bother", and quality only matters once the answer is yes.
const metaOf = (r) =>
  [locOf(r), r.quality != null ? `quality ${r.quality}` : null, TERM_SHORT[r.term] || r.term, visaNote(r)]
    .filter(Boolean)
    .join(' · ');

/**
 * Decide what (if anything) to announce. Pure — no network — so it's testable and the
 * "did we spam?" rule lives in one place.
 *
 * Returns null when nothing clears the bar, which is the whole anti-spam mechanism: a
 * run that finds only weak or wrong-cycle postings sends no message at all. `postings`
 * is mergeBoard's `added` list (genuinely new); it need not be pre-sorted.
 *
 * The bar is read against `chance`, which is strictly lower than the `compatibility` it
 * replaced — chance subtracts difficulty from fit and never adds. NOTIFY_MIN_CHANCE was
 * re-tuned when the scores changed; porting the old 65 across would have muted the board.
 */
export function formatNewPostings(postings, { total, minChance = NOTIFY_MIN_CHANCE, limit = NOTIFY_MAX_ITEMS, dashboardUrl = DASHBOARD_URL } = {}) {
  const notable = postings
    .filter((r) => (r.chance ?? 0) >= minChance && r.term !== 'other-cycle')
    .sort((a, b) => (b.chance ?? -1) - (a.chance ?? -1));
  if (!notable.length) return null;

  const shown = notable.slice(0, limit);
  const more = notable.length - shown.length;
  const head = `${notable.length} new role${notable.length === 1 ? '' : 's'} worth a look`;

  const fit = (r) => String(r.chance ?? '—');
  const tgLines = shown.map((r) =>
    `<b>${escHtml(fit(r))}</b> · <a href="${escHtml(r.applyUrl)}">${escHtml(r.title)}</a> — ${escHtml(r.company)}\n   <i>${escHtml(metaOf(r))}</i>`
  );
  const slLines = shown.map((r) =>
    `*${escSlack(fit(r))}* · <${r.applyUrl}|${escSlack(r.title)}> — ${escSlack(r.company)}\n   _${escSlack(metaOf(r))}_`
  );

  const tail = more ? `\n+${more} more` : '';
  const tgLink2 = dashboardUrl ? `\n<a href="${escHtml(dashboardUrl)}">Open board →</a>` : '';
  const slLink2 = dashboardUrl ? `\n<${dashboardUrl}|Open board →>` : '';

  return {
    count: notable.length,
    telegram: `🆕 <b>${escHtml(head)}</b>\n${tgLines.join('\n')}${tail}${tgLink2}`,
    slack: `🆕 *${escSlack(head)}*\n${slLines.join('\n')}${tail}${slLink2}`,
  };
}

/**
 * Announce genuinely-new postings on every configured channel. `postings` is
 * mergeBoard's `added` list. Sends nothing when nothing clears the fit/term bar.
 */
export async function notifyNewPostings(postings, total) {
  const msg = formatNewPostings(postings, { total });
  if (!msg) {
    console.log(`[notify] ${postings.length} new, none above the notify bar — no ping sent`);
    return;
  }
  await slack(msg.slack);
  await telegram(msg.telegram);
}
