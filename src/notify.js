import { SLACK_WEBHOOK_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from './config.js';

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
      // Telegram returns a JSON body explaining the refusal (bad token, wrong chat
      // id), which is far more useful than the status alone when first wiring this up.
      const detail = await res.text().catch(() => '');
      console.error(`Telegram sendMessage failed: HTTP ${res.status} ${detail}`);
    }
  } catch (err) {
    console.error(`Telegram error: ${err.message}`);
  }
}

const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const escSlack = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/**
 * Announce genuinely-new postings on every configured channel. `postings` is the
 * `added` list from mergeBoard, already sorted best-first; `total` is the board size.
 * At most `limit` are listed so a big catch-up run doesn't send a novella.
 */
export async function notifyNewPostings(postings, total, limit = 8) {
  const n = postings.length;
  const shown = postings.slice(0, limit);
  const more = n > limit ? `\n…and ${n - limit} more on the board.` : '';
  const headline = `${n} new posting${n === 1 ? '' : 's'} on the board — ${total} total`;
  const loc = (r) => r.location || r.city || '';

  const slackBody = shown
    .map((r) => `• <${r.applyUrl}|${escSlack(r.title)}> — *${escSlack(r.company)}* (${escSlack(loc(r))}) _fit ${r.compatibility ?? '—'}_`)
    .join('\n');
  await slack(`:sparkles: ${headline}\n${slackBody}${more}`);

  const tgBody = shown
    .map((r) => `• <a href="${escHtml(r.applyUrl)}">${escHtml(r.title)}</a> — <b>${escHtml(r.company)}</b> · ${escHtml(loc(r))} · fit ${r.compatibility ?? '—'}`)
    .join('\n');
  await telegram(`✨ <b>${escHtml(headline)}</b>\n${tgBody}${escHtml(more)}`);
}
