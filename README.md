# Jobify — Job Auto-Apply Tool

Scrapes job boards for **Summer 2027** software internships / entry-level developer roles, auto-applies with a stored resume + generic cover letter, tracks applications to avoid duplicates, and notifies via Slack.

**Target cities** (priority order): Montreal → Toronto → San Francisco → New York.

## How it works

Every scheduled run (GitHub Actions, 6× daily):

1. **Scrape** — Indeed search results per city (Playwright) + GitHub internship boards ([vanshb03/Summer2027-Internships](https://github.com/vanshb03/Summer2027-Internships), [speedyapply/2027-SWE-College-Jobs](https://github.com/speedyapply/2027-SWE-College-Jobs)), parsed with cheerio.
2. **Dedup** — anything already in `applied_jobs.json` is skipped. New jobs are sorted Montreal-first and capped at `MAX_APPLICATIONS_PER_RUN` (default 10) per run.
3. **US visa filter** — SF/NYC postings must explicitly mention visa sponsorship / H-1B willingness in the posting text, otherwise they're skipped and recorded.
4. **Apply** — for postings on supported ATS platforms (**Greenhouse, Lever, Ashby**), Playwright fills the form:
   - required fields it recognizes (name, email, phone, resume) are filled;
   - optional fields are filled only when confidently recognized (LinkedIn, GitHub, location, cover letter);
   - an **unrecognized required field aborts** the application — nothing is ever guessed;
   - resume PDF is attached to every application; the cover letter is attached/pasted when the form accepts one.
5. **Flag** — postings on unsupported platforms (Workday, Taleo, Indeed-hosted apply behind login, custom portals) are sent to Slack as *manual review* with the link, and recorded so they're only surfaced once.
6. **Persist + notify** — `applied_jobs.json` is committed back to the repo; Slack gets a message per application and a run summary (including the "0 jobs found" case).

## Setup

1. **Add your documents** to `assets/`: `resume.pdf` (required), and edit `cover_letter.txt` / add `cover_letter.pdf`.
2. **Create a Slack incoming webhook** (Slack → Apps → Incoming Webhooks) for the channel you want notifications in.
3. **Add GitHub Actions secrets** (repo → Settings → Secrets and variables → Actions):
   - `APPLICANT_NAME`, `APPLICANT_EMAIL`, `APPLICANT_PHONE` — required
   - `SLACK_WEBHOOK_URL` — required for notifications
   - `APPLICANT_LINKEDIN`, `APPLICANT_GITHUB` — optional, filled into forms when asked
4. **Test it**: Actions → *Auto Apply* → *Run workflow* with `dry_run` checked. Forms get filled but never submitted; Slack messages are prefixed `[DRY RUN]`.
5. When satisfied, run it un-checked or wait for the schedule.

### Run locally

```bash
npm install
npx playwright install chromium
cp .env.example .env   # fill in your values
npm run dry-run        # fills forms, never submits
DRY_RUN=false npm start
```

## Schedule

`.github/workflows/auto-apply.yml` runs at **6AM, 9AM, 12PM, 3PM, 6PM, 9PM Eastern**, 7 days/week (cron is UTC and set for EDT; winter runs land an hour early). A concurrency group prevents overlapping runs.

## State

`applied_jobs.json` records every job ever touched with a status:

| status | meaning |
|---|---|
| `applied` | form submitted, confirmation page detected |
| `submitted_unconfirmed` | submitted, but no confirmation text found — verify in your inbox |
| `manual_review` | unsupported platform or attach failure — Slack has the link |
| `skipped_unknown_required` | form had a required field the bot couldn't identify |
| `skipped_no_sponsorship` | US posting without explicit sponsorship mention |

Every status blocks re-processing on later runs. Delete a record from the JSON to let the bot retry that job.

## Known limitations (honest MVP notes)

- **Indeed bot protection**: Indeed sits behind Cloudflare, which frequently blocks datacenter IPs like GitHub Actions runners. Blocked cities are logged and skipped gracefully — the GitHub boards remain a reliable source. If Indeed coverage matters, run locally/on a residential IP or add a scraping proxy.
- **Indeed-hosted "Easy Apply"** requires an Indeed login and triggers CAPTCHAs under automation; those jobs are routed to Slack for manual review rather than risking a garbage submission. Indeed jobs with an external "apply on company site" link *are* auto-applied when the site is Greenhouse/Lever/Ashby.
- **Confirmation detection is heuristic** — `submitted_unconfirmed` entries are usually fine but worth spot-checking.
- Respect the terms of service of the sites involved; keep `MAX_APPLICATIONS_PER_RUN` modest.
