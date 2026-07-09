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

const pageText = (page) => page.evaluate(() => document.body?.innerText || '').catch(() => '');

// Where each ATS keeps the posting body. Scoped on purpose: a whole-page dump
// carries the site nav and, worse, a footer listing the company's *other* open
// roles — "Backend Engineer", "ML Engineer", "Gameplay Programmer" — which is
// exactly the vocabulary résumé routing keys on. A Ruby backend posting on a
// board that also advertises a graphics role should not get the games résumé.
const DESCRIPTION_SELECTORS = {
  greenhouse: ['#content', '.job__description', '#main'],
  lever: ['[data-qa="job-description"]', '.section-wrapper .content', '.posting'],
  ashby: ['[class*="descriptionText"]', 'main'],
};

// Long enough that an empty or placeholder container is rejected, short enough
// that a genuinely terse posting still counts. Falls back to the full page.
const MIN_DESCRIPTION_CHARS = 200;

async function readDescription(page, ats) {
  for (const selector of DESCRIPTION_SELECTORS[ats] || []) {
    const text = await page.$eval(selector, (el) => el.innerText).catch(() => '');
    if (text.trim().length >= MIN_DESCRIPTION_CHARS) return text;
  }
  return pageText(page);
}

/**
 * Navigates to the application form, and — when the posting arrived without one —
 * returns the description text on the way past.
 *
 * The GitHub listings feeds carry a title, a company, and a URL, and nothing
 * else. Without a description, résumé routing sees only the title, and the many
 * postings called "Software Engineer Intern" all land on the base résumé. We are
 * already loading the posting page here, so the text is free.
 */
async function openApplyForm(page, job, ats) {
  const postingUrl = job.applyUrl || job.url;
  const wantsDescription = !String(job.description || '').trim();
  const leverNeedsApplyPath = ats === 'lever' && !/\/apply\/?$/.test(new URL(postingUrl).pathname);

  // Lever's /apply path is the bare form; the description lives on the posting.
  // Land on the posting first when we still need the text, then step to /apply.
  const firstUrl = leverNeedsApplyPath && !wantsDescription ? postingUrl.replace(/\/?$/, '/apply') : postingUrl;

  await page.goto(firstUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);

  const description = wantsDescription ? await readDescription(page, ats) : '';

  if (leverNeedsApplyPath && wantsDescription) {
    await page.goto(postingUrl.replace(/\/?$/, '/apply'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);
  }

  // If there's no file input on screen yet, try an "Apply" button/tab first
  // (greenhouse job-board pages and ashby postings show the form after a click).
  const hasFileInput = await page.$('input[type="file"]');
  if (!hasFileInput) {
    const applyBtn = page.getByRole('button', { name: /^apply/i }).or(page.getByRole('link', { name: /^apply/i })).first();
    await applyBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(3000);
  }
  return { fileInput: await page.$('input[type="file"]'), description };
}

export async function applyToJob(context, job) {
  const ats = supportedAts(job.applyUrl || job.url);
  if (!ats) return { status: 'manual_review', details: 'unsupported application platform' };

  const page = await context.newPage();
  try {
    const { fileInput, description } = await openApplyForm(page, job, ats);
    if (!fileInput) {
      const body = description || (await pageText(page));
      if (/no longer open|no longer accepting|position has been filled|job not found|posting.{0,20}(closed|expired)/i.test(body)) {
        return { status: 'skipped_closed', details: 'posting is closed' };
      }
      return { status: 'manual_review', details: `no application form found on ${ats} page` };
    }

    // Route the résumé against the richest text we have. A description from the
    // scraper wins — it is the posting body, not a page dump with nav chrome.
    const routed = String(job.description || '').trim() ? job : { ...job, description };
    const fill = await fillForm(page, routed);
    if (!fill.resumeAttached) {
      return { status: 'manual_review', details: 'could not attach resume' };
    }
    if (fill.unknownRequired.length > 0) {
      return {
        status: 'skipped_unknown_required',
        details: `unknown required field(s): ${fill.unknownRequired.join('; ')}`,
      };
    }

    // Which résumé went out, carried on every post-attach result so it reaches
    // the ledger and Slack. Without it there is no way to tell, months later,
    // which version of yourself an employer actually saw.
    const withResume = (r) => ({ ...r, resume: fill.resumeVariant, resumeReason: fill.resumeReason });

    const result = await submitForm(page);
    if (result.dryRun) {
      return withResume({ status: 'applied', details: 'DRY RUN — form filled, not submitted', dryRun: true });
    }
    if (!result.submitted) return withResume({ status: 'manual_review', details: result.reason || 'submit failed' });
    return withResume(
      result.confirmed
        ? { status: 'applied', details: 'confirmation detected' }
        : { status: 'submitted_unconfirmed', details: 'submitted, no confirmation text detected' }
    );
  } catch (err) {
    return { status: 'manual_review', details: `error: ${err.message}` };
  } finally {
    await page.close();
  }
}
