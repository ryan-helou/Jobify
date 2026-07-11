# 🎯 Jobify

*Builds a board of Summer 2027 software internships across the target cities, scores every posting, and hands you a dashboard to work from. It does not apply to anything — you do.*

![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white) ![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-2088FF?style=flat-square&logo=githubactions&logoColor=white) ![Slack](https://img.shields.io/badge/Slack-4A154B?style=flat-square&logo=slack&logoColor=white)

Jobify looks for internship and entry-level developer roles — intern, co-op, and new-grad — in Montreal, Toronto, Vancouver, Ottawa, Calgary, New York, and San Francisco, in that priority order, plus anywhere else in Canada. The order is load-bearing: it resolves multi-city postings, so a "New York / SF" role is filed under New York, and a Canadian office is preferred over a US one because a US role costs a visa and a move. It scrapes every source it knows, scores each posting against `assets/profile.json`, and writes the lot to `board.json`. A GitHub Action runs it every two hours and commits `board.json` back to the repo.

It **used to** auto-apply, and the applier reached 8 of 239 postings — the eight easiest forms, never the Workday roles worth having — while reporting nine submissions no employer ever received. That half is retired. The scrape, the dedup, the hiring-term classifier, and the scoring were always the valuable part; every gate the applier needed (term, sponsorship, platform) is now a column you filter on. Nothing here is irreversible: no résumé is uploaded anywhere, and a crashed run costs nothing but a stale board.

## 🔌 The sources

Postings come from three kinds of source, all public and unauthenticated.

**Curated GitHub boards** supply jobs directly — the vanshb03, speedyapply, sndsh404, `zapplyjobs/Canada-Internships-2027`, and resumax 2027 repos. Several other boards — SimplifyJobs, three Canadian repos, and a few more — are read *only* to mine the company ATS board tokens hidden in their apply URLs.

**Company ATS APIs** are then enumerated directly from those tokens, which surfaces roles days before a volunteer copies them into a README and hands us the description for free. Greenhouse, Lever, Ashby, SmartRecruiters, Oracle Fusion, Workday, Workable, Recruitee, BambooHR, iCIMS, Eightfold, Personio, and Phenom — thirteen platforms. Workday alone is 28% of Canadian postings; Oracle is what Canadian banks and telcos run campus hiring on; iCIMS was the single biggest gap before it was added. Indeed is supported but off by default, since it sits behind Cloudflare and is almost always blocked from CI.

**Standalone feeds** add their own jobs (Canada's National Job Bank, The Muse, and Adzuna) and their own token mines (levels.fyi's ~14k intern rows and the Hacker News "Who is hiring?" thread, both read for the ATS apply URLs in them). Adzuna needs a free `app_id`/`app_key`; without them it quietly no-ops.

Enumerating only the boards some feed already named is circular: an employer absent from every feed is never queried, which is why just 7 of 44 major Canadian tech firms were once reachable. So `assets/employers.json` names employers directly and their board slugs are guessed and probed — a miss costs one 404, a hit adds that employer for good. Phenom's employers use vanity domains nothing points at, so they're listed in `assets/phenom-sites.json` instead.

Every source is toggled by an `ENABLE_*` env var and can be turned off independently.

## 🗂 The board

`board.json` is a catalogue of every posting ever seen, scored, and deduped — not a log of what was applied to. Each row carries the attributes the pipeline used to reason about it as fields you can filter on: `city`, `country`, `platform`, `source`, `term`, `sponsorship`, `pay`, the three scores, a bounded excerpt of the description, and `firstSeenAt` / `lastSeenAt`. `firstSeenAt` is the one signal a re-scrape can't reconstruct — it's how you know a role has been open for three weeks — so it's preserved across runs while the scores are recomputed every time.

## 🗓 Hiring term

The one field worth understanding, because most postings land in the middle bucket. Each posting is classified `2027`, `other-cycle`, or `unstated`:

- **`2027`** — the description names *Summer 2027* explicitly. Apply with confidence.
- **`other-cycle`** — it names a different season/year (a Fall 2026 co-op). Skip.
- **`unstated`** — no season+year phrase at all, which is *most* live postings ("Software Engineer Intern" with no date). This is **not** "not 2027" — it's "we can't prove it either way, so a human should glance." A bare year is deliberately not trusted: Summer 2026 listings routinely say "graduating by 2027," and rejecting or accepting on that would readmit exactly the stale roles the filter exists to remove. Canadian co-ops in particular almost never write "Summer 2027," so many genuine roles sit here early in the cycle.

Read the board as three tiers: `2027` is your confident queue, `unstated` is worth a skim, `other-cycle` is the discard pile.

## 🖥 The dashboard

`docs/index.html` is one self-contained file — no build step, no dependencies. Read it locally with `npm run dashboard`. It renders `board.json` with filters on city, platform, source, sponsorship, and hiring term, sorted by compatibility. Filters live in the URL, so any view can be linked or bookmarked.

Two rules hold the interface together. The accent colour means *a human should look here* and is spent nowhere else. And facts the machine wrote — scores, timestamps, statuses, board names — are set in mono, while words a person wrote are set in sans; you can tell them apart without reading them.

Because the page cannot import from `src/`, it carries its own copy of the term and status vocabularies as embedded JSON. `test/dashboard.test.js` parses that block and fails the moment it disagrees with `src/config.js`.

The repo is **private** and should stay that way; the GitHub Pages deploy is manual-only, since a Pages site is served publicly even from a private repo.

## 📊 Scoring

Every posting gets three numbers, computed in `src/score.js` from an editable lexicon of skills, company tiers, and pay curves in `src/config.js`.

- **compatibility** (0–100) is how well *this* candidate fits *this* posting: 60% skill overlap against your declared skill list, 40% role-family match, all multiplied by an eligibility factor for hiring term and work authorization. A posting naming few technologies is shrunk toward a neutral prior of 55 rather than scored zero for being terse; a US role that refuses sponsorship or names the wrong season has its score collapsed, not merely docked. City is deliberately absent — that's a filter, not part of fit.
- **quality** (0–100) is candidate-independent: 35% pay (an hourly curve anchored at ~$20/hr low, ~$50/hr strong, ~$80/hr big-tech), 30% program signals (return offers, mentorship, cohort), 20% real-work substance, 15% company prestige. An unpaid or credit-only internship is capped at 25 no matter how well the rest reads.
- **interviewOdds** (1–60%) is a heuristic prior, not a calibrated probability — nothing here records whether an application led to an interview. It starts from a 6% base rate and swings on prestige (a top-tier name sinks the odds, because everyone applied there too), fit, and how early in a posting's life it was reached. Treat it as a tie-breaker between two roles, never a forecast.

The board sorts by compatibility, and all three scores ride along into the dashboard and into a one-line Slack explanation of the evidence behind them.

## 🚀 Running it

```sh
npm install
npm start          # scrape every source, score, write board.json
npm run dashboard   # read board.json in the browser
npm test           # the full suite
```

`npm start` works with no setup — it builds the board and asks nothing of you. To make the scores yours, edit `assets/profile.json` (your skills and preferred role families). Optional env vars go in a `.env` file: `SLACK_WEBHOOK_URL` for notifications, `ADZUNA_APP_ID`/`ADZUNA_APP_KEY` for the Adzuna feed, and any `ENABLE_*` toggle or `*_MAX_PAGES` cap you want to change (all defined, with their defaults, in `src/config.js`).
