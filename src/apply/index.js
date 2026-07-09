import { fillForm, submitForm } from './formFiller.js';

// ATS platforms whose public apply forms the generic filler handles.
// Anything else (Workday, Taleo, Indeed-hosted apply behind login, custom
// career portals) is flagged for manual review instead of guessing.
const SUPPORTED_ATS = [
  { name: 'greenhouse', re: /greenhouse\.io/i },
  { name: 'lever', re: /jobs\.lever\.co/i },
  { name: 'ashby', re: /jobs\.ashbyhq\.com/i },
];

export function supportedAts(url) {
  return SUPPORTED_ATS.find((a) => a.re.test(url))?.name || null;
}

async function openApplyForm(page, job, ats) {
  let url = job.applyUrl || job.url;
  if (ats === 'lever' && !/\/apply\/?$/.test(new URL(url).pathname)) {
    url = url.replace(/\/?$/, '/apply');
  }
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);

  // If there's no file input on screen yet, try an "Apply" button/tab first
  // (greenhouse job-board pages and ashby postings show the form after a click).
  const hasFileInput = await page.$('input[type="file"]');
  if (!hasFileInput) {
    const applyBtn = page.getByRole('button', { name: /^apply/i }).or(page.getByRole('link', { name: /^apply/i })).first();
    await applyBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(3000);
  }
  return page.$('input[type="file"]');
}

export async function applyToJob(context, job) {
  const ats = supportedAts(job.applyUrl || job.url);
  if (!ats) return { status: 'manual_review', details: 'unsupported application platform' };

  const page = await context.newPage();
  try {
    const formReady = await openApplyForm(page, job, ats);
    if (!formReady) {
      const body = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
      if (/no longer open|no longer accepting|position has been filled|job not found|posting.{0,20}(closed|expired)/i.test(body)) {
        return { status: 'skipped_closed', details: 'posting is closed' };
      }
      return { status: 'manual_review', details: `no application form found on ${ats} page` };
    }

    const fill = await fillForm(page, job);
    if (!fill.resumeAttached) {
      return { status: 'manual_review', details: 'could not attach resume' };
    }
    if (fill.unknownRequired.length > 0) {
      return {
        status: 'skipped_unknown_required',
        details: `unknown required field(s): ${fill.unknownRequired.join('; ')}`,
      };
    }

    const result = await submitForm(page);
    if (result.dryRun) return { status: 'applied', details: 'DRY RUN — form filled, not submitted', dryRun: true };
    if (!result.submitted) return { status: 'manual_review', details: result.reason || 'submit failed' };
    return result.confirmed
      ? { status: 'applied', details: 'confirmation detected' }
      : { status: 'submitted_unconfirmed', details: 'submitted, no confirmation text detected' };
  } catch (err) {
    return { status: 'manual_review', details: `error: ${err.message}` };
  } finally {
    await page.close();
  }
}
