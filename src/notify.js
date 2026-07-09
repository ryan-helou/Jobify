import { SLACK_WEBHOOK_URL } from './config.js';

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

export async function notifyApplied(job) {
  await slack(
    `:white_check_mark: Applied to *${job.title}* at *${job.company}* (${job.location})\n` +
      `<${job.url}|Job posting> — ${new Date().toISOString()}`
  );
}

export async function notifySummary({ found, applied, manual, skipped, dryRun }) {
  const prefix = dryRun ? ':test_tube: [DRY RUN] ' : '';
  if (found === 0) {
    await slack(`${prefix}:mag: Jobify run finished — no new matching jobs found this run.`);
    return;
  }
  await slack(
    `${prefix}:clipboard: Jobify run finished — ${found} new job(s) found, ${applied} applied, ` +
      `${manual} need manual review, ${skipped} skipped.`
  );
}
