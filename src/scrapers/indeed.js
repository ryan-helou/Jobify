import { CITIES, SEARCH_QUERY } from '../config.js';
import { isDevRole } from './github.js';

// Scrapes Indeed search results per target city with Playwright.
// Indeed sits behind Cloudflare; when a run gets challenged we log it and move
// on rather than fighting the bot wall — the GitHub boards still provide jobs.

function blocked(title, body) {
  return /just a moment|verify you are human|additional verification/i.test(title + ' ' + body.slice(0, 2000));
}

async function scrapeCity(context, city) {
  const page = await context.newPage();
  const jobs = [];
  try {
    const url =
      `https://${city.indeedDomain}/jobs?q=${encodeURIComponent(SEARCH_QUERY)}` +
      `&l=${encodeURIComponent(city.name)}&sort=date&fromage=7`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);

    const title = await page.title();
    const body = await page.evaluate(() => document.body?.innerText || '');
    if (blocked(title, body)) {
      console.error(`Indeed (${city.name}): blocked by bot protection, skipping city`);
      return [];
    }

    const cards = await page.$$eval('.job_seen_beacon, [data-testid="slider_item"]', (nodes) =>
      nodes.map((n) => {
        const a = n.querySelector('a[data-jk], h2 a');
        return {
          jk: a?.getAttribute('data-jk') || '',
          title: n.querySelector('h2.jobTitle span[title], h2 a span')?.textContent?.trim() || '',
          company: n.querySelector('[data-testid="company-name"]')?.textContent?.trim() || '',
          location: n.querySelector('[data-testid="text-location"]')?.textContent?.trim() || '',
        };
      })
    );

    for (const c of cards) {
      if (!c.jk || !c.title) continue;
      if (!isDevRole(c.title)) continue;
      jobs.push({
        id: `indeed:${c.jk}`,
        jk: c.jk,
        title: c.title,
        company: c.company || 'Unknown',
        location: c.location || city.name,
        city: city.key,
        country: city.country,
        url: `https://${city.indeedDomain}/viewjob?jk=${c.jk}`,
        source: 'indeed',
      });
    }
    console.log(`Indeed (${city.name}): ${jobs.length} jobs from search results`);
  } catch (err) {
    console.error(`Indeed (${city.name}) failed: ${err.message}`);
  } finally {
    await page.close();
  }
  return jobs;
}

// Loads an Indeed job page to get the description (for the US visa filter) and
// the external "apply on company site" URL when one exists.
export async function fetchIndeedJobDetails(context, job) {
  const page = await context.newPage();
  try {
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);
    const title = await page.title();
    const body = await page.evaluate(() => document.body?.innerText || '');
    if (blocked(title, body)) return { description: '', externalApplyUrl: '', blocked: true };

    const description = (await page.$eval('#jobDescriptionText', (el) => el.innerText).catch(() => '')) || body;
    const externalApplyUrl =
      (await page
        .$eval('#viewJobButtonLinkContainer a[href], #applyButtonLinkContainer a[href]', (el) => el.href)
        .catch(() => '')) || '';
    return { description, externalApplyUrl, blocked: false };
  } catch (err) {
    console.error(`Indeed job details failed for ${job.url}: ${err.message}`);
    return { description: '', externalApplyUrl: '', blocked: false };
  } finally {
    await page.close();
  }
}

export async function scrapeIndeed(context) {
  const jobs = [];
  for (const city of CITIES) {
    jobs.push(...(await scrapeCity(context, city)));
  }
  return jobs;
}
