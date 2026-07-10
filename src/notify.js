import { SLACK_WEBHOOK_URL } from './config.js';
import { explainScore } from './score.js';

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


