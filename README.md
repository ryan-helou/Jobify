# Jobify — Job Auto-Apply Tool

Scrapes job boards for **Summer 2027** software internships / entry-level developer roles, auto-applies with a stored resume + generic cover letter, tracks applications to avoid duplicates, and notifies via Slack.

**Target cities** (priority order): Montreal → Toronto → San Francisco → New York.

## Sources

Each board is read from its **structured `listings.json` feed** where one exists, rather than by parsing the README markdown table. The feed carries authoritative `active`, `season`, `sponsorship`, and `locations` fields, so dead postings, off-season internships, and no-sponsorship US roles are filtered out before a browser ever opens.

| Source | Feed | Provides |
|---|---|---|
| [vanshb03/Summer2027-Internships](https://github.com/vanshb03/Summer2027-Internships) | `listings.json` | Summer 2027 internships |
| [SimplifyJobs/New-Grad-Positions](https://github.com/SimplifyJobs/New-Grad-Positions) | `listings.json` | Entry-level / new-grad roles — **the main source of Canadian jobs, including Montreal** |
| [speedyapply/2027-SWE-College-Jobs](https://github.com/speedyapply/2027-SWE-College-Jobs) | README markdown | Additional internships |
| Indeed | Playwright | Per-city search (opt-in, see limitations) |

## How it works

Every scheduled run (GitHub Actions, 6× daily):

1. **Scrape** — all sources in parallel (see table above). Dead (`active: false`) and hidden postings are dropped immediately. Internship boards are filtered to the **Summer** season; the new-grad board is filtered to developer categories.
2. **Filter to real dev roles** — a title must carry a software signal (SWE, developer, full-stack, ML…) and not match a non-dev track (research scientist, GTM, analyst, consultant, hardware, sales, PM). On internship boards the title must say intern/co-op; on the new-grad board — which is entry-level by construction — senior and levelled titles (`Senior`, `Staff`, `Software Developer 2`) are rejected instead.
3. **Dedup** — against `applied_jobs.json` by canonical URL **and** by job identity (company + title + city, accent- and punctuation-insensitive), so the same posting listed on two boards under different links is never applied to twice. Survivors are sorted Montreal-first and capped at `MAX_APPLICATIONS_PER_RUN` (default 10).
4. **US visa filter** — SF/NYC postings must explicitly offer sponsorship. The feed's curated `sponsorship` field decides it when definitive (`Offers Sponsorship` → proceed; `Does Not Offer Sponsorship` / `U.S. Citizenship is Required` → skip, no page load). When the feed says nothing, the posting is **rendered with Playwright** (not just fetched), so JS-heavy boards like Work-at-a-Startup, Ashby, and Workday are read accurately. Negation phrases ("unable to provide sponsorship") force a skip even if a sponsorship keyword also appears.
5. **Apply** — for postings on supported ATS platforms (**Greenhouse, Lever, Ashby**), Playwright fills the form:
   - required fields it recognizes (name, email, phone, resume) are filled;
   - optional fields are filled only when confidently recognized (LinkedIn, GitHub, location, cover letter);
   - an **unrecognized required field aborts** the application — nothing is ever guessed;
   - resume PDF is attached to every application; the cover letter is attached/pasted when the form accepts one.
6. **Flag** — postings on unsupported platforms (Workday, Taleo, Indeed-hosted apply behind login, custom portals) are sent to Slack as *manual review* with the link, and recorded so they're only surfaced once. Already-closed postings are detected and recorded as `skipped_closed`.
7. **Persist + notify** — `applied_jobs.json` is committed back to the repo; Slack gets a message per application and a run summary (including the "0 jobs found" case).

## Dashboard

A zero-dependency web dashboard ([`docs/index.html`](docs/index.html)) shows every tracked job with per-status stat cards, search, filters by status / city / source, a "Why" column explaining every skip, and sorting on any column.

- **Hosted (auto-updating):** enable GitHub Pages for the repo (Settings → Pages → Source: *GitHub Actions*). The [Deploy Dashboard workflow](.github/workflows/pages.yml) republishes it on every push that changes `applied_jobs.json`, so it refreshes after each run. Your URL will be `https://ryan-helou.github.io/Jobify/`.
- **Locally:** `npm run dashboard`, then open <http://localhost:8080/docs/>.

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
| `skipped_closed` | posting was already closed/filled |

Every status blocks re-processing on later runs. Delete a record from the JSON to let the bot retry that job.

## Run budgets

Two separate limits, because they bound different things:

- `MAX_APPLICATIONS_PER_RUN` (default 10) — applications actually attempted.
- `MAX_JOBS_EXAMINED_PER_RUN` (default 60) — jobs looked at while trying to fill that quota.

A job can be examined and then skipped (no sponsorship) or handed to a human (unsupported ATS) without ever costing an application. Keeping the budgets separate is what stops a queue that happens to start with a run of no-sponsorship postings from consuming the whole quota and submitting nothing.

## Tests

`npm test` runs the suite (`node --test`) covering role filtering, seniority/season/category rules, city priority, both parsers, sponsorship logic (including negations), and the dedup keys. The auto-apply workflow runs it before every scheduled run — the filter rules decide what gets applied to, so they never run unverified.

## Known limitations (honest MVP notes)

- **Montreal roles are mostly on Workday.** Adding the new-grad board took Montreal coverage from 0 to ~5 active roles, but most (Expedia, Zebra, Manulife) post on Workday, which requires account creation and is not auto-applied — they arrive in Slack as manual review. The Greenhouse/Lever/Ashby ones do auto-apply. Realistically the bot applies to more US roles than Canadian ones; that's a property of where Canadian employers post, not of the filter.

- **Indeed bot protection**: Indeed sits behind Cloudflare, which reliably blocks datacenter IPs like GitHub Actions runners, so Indeed scraping is **off by default** (`ENABLE_INDEED=false`). The GitHub boards are the productive source. Set `ENABLE_INDEED=true` to attempt it — best on a residential IP or with a scraping proxy. Blocked cities are logged and skipped gracefully.
- **Indeed-hosted "Easy Apply"** requires an Indeed login and triggers CAPTCHAs under automation; those jobs are routed to Slack for manual review rather than risking a garbage submission. Indeed jobs with an external "apply on company site" link *are* auto-applied when the site is Greenhouse/Lever/Ashby.
- **Confirmation detection is heuristic** — `submitted_unconfirmed` entries are usually fine but worth spot-checking.
- Respect the terms of service of the sites involved; keep `MAX_APPLICATIONS_PER_RUN` modest.
