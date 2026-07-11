import {
  SLACK_WEBHOOK_URL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  NOTIFY_MIN_FIT,
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

const CITY_SHORT = {
  montreal: 'Montreal', toronto: 'Toronto', vancouver: 'Vancouver', ottawa: 'Ottawa',
  calgary: 'Calgary', canada: 'Canada', nyc: 'NYC', sf: 'SF',
};
const place = (r) => CITY_SHORT[r.city] || r.city || '';

/**
 * Decide what (if anything) to announce. Pure — no network — so it's testable and the
 * "did we spam?" rule lives in one place.
 *
 * Returns null when nothing clears the bar, which is the whole anti-spam mechanism: a
 * run that finds only weak or wrong-cycle postings sends no message at all. `postings`
 * is mergeBoard's `added` list (genuinely new); it need not be pre-sorted.
 */
export function formatNewPostings(postings, { total, minFit = NOTIFY_MIN_FIT, limit = NOTIFY_MAX_ITEMS, dashboardUrl = DASHBOARD_URL } = {}) {
  const notable = postings
    .filter((r) => (r.compatibility ?? 0) >= minFit && r.term !== 'other-cycle')
    .sort((a, b) => (b.compatibility ?? -1) - (a.compatibility ?? -1));
  if (!notable.length) return null;

  const shown = notable.slice(0, limit);
  const more = notable.length - shown.length;
  const head = `${notable.length} new role${notable.length === 1 ? '' : 's'} worth a look`;

  const tgLines = shown.map((r) => `<b>${escHtml(String(r.compatibility ?? '—'))}</b> · <a href="${escHtml(r.applyUrl)}">${escHtml(r.title)}</a> — ${escHtml(r.company)}${place(r) ? ` · ${escHtml(place(r))}` : ''}`);
  const slLines = shown.map((r) => `*${escSlack(String(r.compatibility ?? '—'))}* · <${r.applyUrl}|${escSlack(r.title)}> — ${escSlack(r.company)}${place(r) ? ` · ${escSlack(place(r))}` : ''}`);

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
