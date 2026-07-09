import fs from 'node:fs';
import {
  APPLICANT,
  COVER_LETTER_PDF_PATH,
  DRY_RUN,
  EDUCATION,
  WORK_AUTH,
  coverLetterText,
} from '../config.js';
import { resolveResume } from '../resume.js';

// Generic application form filler. Rules (per spec):
//   - fill required fields we recognize (name, email, phone, resume, education)
//   - answer work-authorization questions from assets/profile.json, never inferred
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
  // Graduation patterns precede the generic school/degree ones: "Expected
  // graduation year" contains neither, but "Degree year" would match both.
  { key: 'graduationYear', re: /grad(?:uation)?[\s_-]*year|year[\s_-]*of[\s_-]*grad/i },
  { key: 'graduationMonth', re: /grad(?:uation)?[\s_-]*month/i },
  { key: 'graduationDate', re: /grad(?:uation)?[\s_-]*date|expected[\s_-]*grad|anticipated[\s_-]*grad/i },
  { key: 'school', re: /school|university|college|institution/i },
  { key: 'degree', re: /degree|level[\s_-]*of[\s_-]*(?:study|education)/i },
  { key: 'major', re: /major|discipline|field[\s_-]*of[\s_-]*study/i },
  { key: 'location', re: /location|current[\s_-]*city|^\s*city\s*\*?\s*$/i },
  { key: 'linkedin', re: /linkedin/i },
  { key: 'github', re: /github/i },
  { key: 'website', re: /website|portfolio|personal[\s_-]*site/i },
  { key: 'consent', re: /agree|consent|privacy|terms|acknowledge/i },
];

// Work-authorization questions. These are legal statements, so the phrasings are
// matched narrowly and the answer comes from assets/profile.json — never inferred
// from the posting, the résumé, or anything else.
//
// AUTHORIZED is tested before SPONSORSHIP, and the order is load-bearing. A form
// asking "authorized to work in the US *without sponsorship*?" mentions both, and
// it is an authorization question: the honest answer is whatever `authorized` says.
// Testing SPONSORSHIP first would answer "yes, I need sponsorship" to a question
// that asked the opposite, and submit it.
const AUTHORIZED_Q = /legally[\s_-]*authoriz|authoriz(?:ed|ation)[\s_-]*to[\s_-]*work|work[\s_-]*authoriz|eligible[\s_-]*to[\s_-]*work|right[\s_-]*to[\s_-]*work/i;
const SPONSORSHIP_Q = /sponsorship|sponsor[\s_-]*(?:you|a|an|your)?[\s_-]*(?:work[\s_-]*)?visa|visa[\s_-]*status/i;

// Which country a question is about. A US employer hiring in Toronto still asks
// about US authorization, so the question's own text wins over the posting's country.
function questionCountry(label, job) {
  if (/\bh-?1-?b\b|united[\s_-]*states|\bu\.?s\.?a?\.?\b|\bamerica/i.test(label)) return 'US';
  if (/\bcanad(?:a|ian)\b/i.test(label)) return 'CA';
  return job?.country || null;
}

/**
 * 'yes' | 'no' for a recognized work-authorization question, else null.
 * Returns null whenever the country is unknown or profile.json has no entry for
 * it — the caller then treats the field as unanswerable and aborts.
 */
export function answerForQuestion(label, job) {
  const text = String(label || '');
  const auth = WORK_AUTH[questionCountry(text, job)];
  if (!auth) return null;
  if (AUTHORIZED_Q.test(text)) return auth.authorized ? 'yes' : 'no';
  if (SPONSORSHIP_Q.test(text)) return auth.requiresSponsorship ? 'yes' : 'no';
  return null;
}

// Picks the option whose visible text matches `want`. Exact match first: a "Yes"
// answer must never land on "Yes, with sponsorship" just because it appears first.
async function selectOption(el, want) {
  const options = await el.$$eval('option', (os) => os.map((o) => ({ value: o.value, text: (o.textContent || '').trim() })));
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(want);
  const hit =
    options.find((o) => norm(o.text) === target) ||
    options.find((o) => o.value && norm(o.text).startsWith(target) && target.length > 2);
  if (!hit) return false;
  await el.selectOption({ value: hit.value }).catch(() => {});
  return true;
}

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

export function valueFor(key, job) {
  const [firstName, ...rest] = APPLICANT.name.split(/\s+/);
  const { graduationMonth, graduationYear } = EDUCATION;
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
    case 'school': return EDUCATION.school;
    case 'degree': return EDUCATION.degree;
    case 'major': return EDUCATION.major;
    case 'graduationMonth': return graduationMonth;
    case 'graduationYear': return graduationYear;
    // A single free-text graduation field wants both halves; a form that splits
    // them into month and year fields hits the two cases above instead.
    case 'graduationDate': return [graduationMonth, graduationYear].filter(Boolean).join(' ');
    default: return '';
  }
}

export async function fillForm(page, job) {
  const elements = await page.$$('input, textarea, select');
  const unknownRequired = [];
  let resumeAttached = false;
  let coverAttached = false;
  let filled = 0;

  // Resolved once per posting, not per file input: a form with two upload
  // fields must not attach two different résumés.
  const resume = resolveResume(job);

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
      } else if (fs.existsSync(resume.path)) {
        // Default any other file input to the resume — it's what apply forms want.
        files.push(resume.path);
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

    if (desc.tag === 'select') {
      // A dropdown we can answer: work-authorization questions, and the education
      // fields whose value happens to be one of the options ("Bachelor's Degree").
      const label = labelFor(desc);
      const answer = answerForQuestion(label, job) || valueFor(key, job);
      if (answer && (await selectOption(el, answer))) {
        filled++;
        continue;
      }
      if (desc.required) unknownRequired.push(label);
      continue;
    }

    if (desc.type === 'radio') {
      // A radio's own label is its option text ("Yes"), not the question, and the
      // question usually lives in an ancestor we don't read. Answering would mean
      // guessing which group this button belongs to, so it still aborts.
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

  return {
    unknownRequired,
    resumeAttached,
    coverAttached,
    filled,
    resumeVariant: resume.variant,
    resumeReason: resume.reason,
  };
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
