import fs from 'node:fs';
import {
  APPLICANT,
  RESUME_PATH,
  COVER_LETTER_PDF_PATH,
  DRY_RUN,
  coverLetterText,
} from '../config.js';

// Generic application form filler. Rules (per spec):
//   - fill required fields we recognize (name, email, phone, resume)
//   - fill optional fields only when we're confident what they are
//   - never guess: an unrecognized *required* field aborts the application
//   - attach resume + generic cover letter wherever the form accepts them

const FIELD_PATTERNS = [
  { key: 'firstName', re: /first[\s_-]*name|given[\s_-]*name/i },
  { key: 'lastName', re: /last[\s_-]*name|family[\s_-]*name|surname/i },
  { key: 'fullName', re: /full[\s_-]*name|^\s*name\s*\*?\s*$|your[\s_-]*name/i },
  { key: 'email', re: /e-?mail/i },
  { key: 'phone', re: /phone|mobile|\btel\b/i },
  { key: 'resume', re: /resume|résumé|\bcv\b/i },
  { key: 'coverLetter', re: /cover[\s_-]*letter/i },
  { key: 'location', re: /location|current[\s_-]*city|^\s*city\s*\*?\s*$/i },
  { key: 'linkedin', re: /linkedin/i },
  { key: 'github', re: /github/i },
  { key: 'website', re: /website|portfolio|personal[\s_-]*site/i },
  { key: 'consent', re: /agree|consent|privacy|terms|acknowledge/i },
];

async function describeField(el) {
  return el.evaluate((node) => {
    const parts = [node.name, node.id, node.placeholder, node.getAttribute('aria-label'), node.getAttribute('autocomplete')];
    if (node.id) {
      const label = document.querySelector(`label[for="${CSS.escape(node.id)}"]`);
      if (label) parts.push(label.textContent);
    }
    const wrapping = node.closest('label');
    if (wrapping) parts.push(wrapping.textContent);
    const required =
      node.required ||
      node.getAttribute('aria-required') === 'true' ||
      /[*✱]/.test(wrapping?.textContent || '') ||
      /[*✱]/.test((node.id && document.querySelector(`label[for="${CSS.escape(node.id)}"]`)?.textContent) || '');
    return {
      parts: parts.filter(Boolean).map((p) => p.replace(/[*✱]/g, '').trim()),
      text: parts.filter(Boolean).join(' | '),
      type: node.type || node.tagName.toLowerCase(),
      tag: node.tagName.toLowerCase(),
      required,
      visible: !!(node.offsetParent || node.type === 'file' || node.type === 'hidden'),
      hidden: node.type === 'hidden',
    };
  });
}

function labelFor(desc) {
  // The most human-readable descriptor part — usually the <label> text, which
  // comes last — beats internal names like "question_23321912002".
  const human = desc.parts.filter((p) => !/^[\w-]+$/.test(p) || p.length < 30);
  return (human[human.length - 1] || desc.parts[0] || 'unlabeled field').slice(0, 100);
}

function classify(desc) {
  // Match each descriptor part (name attr, label text, placeholder…) individually
  // so anchored patterns like /^name$/ work against short labels.
  for (const { key, re } of FIELD_PATTERNS) {
    if (desc.parts.some((p) => re.test(p))) return key;
  }
  return null;
}

function valueFor(key, job) {
  const [firstName, ...rest] = APPLICANT.name.split(/\s+/);
  switch (key) {
    case 'firstName': return firstName;
    case 'lastName': return rest.join(' ') || firstName;
    case 'fullName': return APPLICANT.name;
    case 'email': return APPLICANT.email;
    case 'phone': return APPLICANT.phone;
    case 'location': return job.location || '';
    case 'linkedin': return APPLICANT.linkedin;
    case 'github': return APPLICANT.github;
    case 'website': return APPLICANT.website || APPLICANT.github;
    default: return '';
  }
}

export async function fillForm(page, job) {
  const elements = await page.$$('input, textarea, select');
  const unknownRequired = [];
  let resumeAttached = false;
  let coverAttached = false;
  let filled = 0;

  for (const el of elements) {
    const desc = await describeField(el);
    if (desc.hidden || !desc.visible) continue;
    if (['submit', 'button', 'reset', 'image'].includes(desc.type)) continue;

    const key = classify(desc);

    if (desc.type === 'file') {
      const files = [];
      if (key === 'coverLetter' && fs.existsSync(COVER_LETTER_PDF_PATH)) {
        files.push(COVER_LETTER_PDF_PATH);
        coverAttached = true;
      } else if (fs.existsSync(RESUME_PATH)) {
        // Default any other file input to the resume — it's what apply forms want.
        files.push(RESUME_PATH);
        resumeAttached = true;
      }
      if (files.length) await el.setInputFiles(files).catch(() => {});
      continue;
    }

    if (desc.type === 'checkbox') {
      if (key === 'consent') {
        await el.check().catch(() => {});
        filled++;
      } else if (desc.required) {
        unknownRequired.push(labelFor(desc));
      }
      continue;
    }

    if (desc.tag === 'select' || desc.type === 'radio') {
      // Dropdowns/radios are custom questions we can't answer confidently.
      if (desc.required) unknownRequired.push(labelFor(desc));
      continue;
    }

    if (key === 'coverLetter' && desc.tag === 'textarea') {
      const text = coverLetterText();
      if (text) {
        await el.fill(text).catch(() => {});
        coverAttached = true;
        filled++;
      }
      continue;
    }

    const value = key ? valueFor(key, job) : '';
    if (value) {
      await el.fill(value).catch(() => {});
      filled++;
    } else if (desc.required) {
      unknownRequired.push(labelFor(desc));
    }
  }

  return { unknownRequired, resumeAttached, coverAttached, filled };
}

export async function submitForm(page) {
  if (DRY_RUN) return { submitted: false, confirmed: false, dryRun: true };

  let button = await page.$('button[type="submit"], input[type="submit"]');
  if (!button) {
    button = await page
      .getByRole('button', { name: /submit|apply/i })
      .first()
      .elementHandle({ timeout: 5000 })
      .catch(() => null);
  }
  if (!button) return { submitted: false, confirmed: false, reason: 'no submit button found' };

  await button.click().catch(() => {});
  await page.waitForTimeout(6000);

  const body = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  const confirmed = /thank you|application (was )?(received|submitted|sent)|we('|’)ve received|successfully (applied|submitted)/i.test(body);
  return { submitted: true, confirmed };
}
