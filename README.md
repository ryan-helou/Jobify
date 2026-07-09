# 🎯 Jobify

*A bot that hunts for Summer 2027 software internships across four cities, scores each posting, and auto-applies to the ones it can fill.*

![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white) ![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat-square&logo=playwright&logoColor=white) ![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-2088FF?style=flat-square&logo=githubactions&logoColor=white) ![Slack](https://img.shields.io/badge/Slack-4A154B?style=flat-square&logo=slack&logoColor=white)

Jobify looks for internship and entry-level developer roles — intern, co-op, and new-grad — in Montreal, Toronto, New York, and San Francisco, in that priority order. The order is load-bearing: it sorts the apply queue and it resolves multi-city postings, so a "New York / SF" role is treated as New York, and a mediocre Montreal role is preferred over a perfect SF one because SF costs a visa and a move. A GitHub Action runs it six times a day on Eastern hours and commits `applied_jobs.json`, the dedup ledger, back to the repo so nothing is ever touched twice.

It pulls postings from four kinds of source. Curated GitHub boards (the vanshb03, speedyapply, and sndsh404 2027 repos) supply jobs directly; several other boards — including SimplifyJobs and three Canadian repos — are read only to mine the company ATS board tokens hidden in their apply URLs. Those tokens are then enumerated against the public, unauthenticated JSON APIs of Greenhouse, Lever, Ashby, SmartRecruiters, Oracle Fusion, and Workday, which surfaces roles days before a volunteer copies them into a README. Workday alone is 28% of Canadian postings and 22% of US ones — more than Greenhouse, Ashby, and Lever combined — and Oracle is what Canadian banks and telcos run campus hiring on. Indeed is supported but off by default, since it sits behind Cloudflare and is almost always blocked from CI.

Enumerating only the boards that a job board already named is circular: an employer absent from those feeds is never queried, which is why just 7 of 44 major Canadian tech firms were ever reachable. So `assets/employers.json` names employers directly and their board slugs are guessed and probed — a miss costs one 404, a hit adds that employer for good. It cannot reach Workday or Oracle tenants, whose IDs aren't derivable from a company name.

## 🔁 The ledger

`applied_jobs.json` records every posting the runner has decided about, and that decision blocks the job from being processed again. Only a submission is permanent. Every other verdict is a snapshot of how a posting read on one particular day, and postings change — a description gains "Summer 2027", a company adds sponsorship language, a form we couldn't parse gets rebuilt. So non-terminal verdicts expire: `manual_review` after 14 days, `skipped_no_sponsorship` after 30, `skipped_wrong_term` after 90 (see `STATUS_RETRY_DAYS`). A posting flagged once for a human comes back if nobody acted on it, rather than vanishing forever.

The repo is **private**, and should stay that way: it holds your résumé and a timestamped log of every job you have applied to. For the same reason the GitHub Pages deploy is manual-only — a Pages site is served publicly even from a private repo. Read the dashboard locally with `npm run dashboard`.

## 📊 Scoring

Every posting gets three numbers, computed in `src/score.js` from an editable lexicon of skills, company tiers, and pay curves in `src/config.js`.

- **compatibility** (0–100) is how well *this* candidate fits *this* posting: 60% skill overlap against a declared skill list, 40% role-family match, all multiplied by an eligibility factor for hiring term and work authorization. A posting naming few technologies is shrunk toward a neutral prior of 55 rather than scored zero for being terse; a US role that refuses sponsorship or names the wrong season has its score collapsed, not merely docked. City is deliberately absent — that belongs to the apply queue, not to fit.
- **quality** (0–100) is candidate-independent: 35% pay (an hourly curve anchored at ~$20/hr low, ~$50/hr strong, ~$80/hr big-tech), 30% program signals (return offers, mentorship, cohort), 20% real-work substance, 15% company prestige. An unpaid or credit-only internship is capped at 25 no matter how well the rest reads.
- **interviewOdds** (1–60%) is a heuristic prior, not a calibrated probability — nothing here records whether an application led to an interview. It starts from a 6% base rate and swings on prestige (a top-tier name sinks the odds, because everyone applied there too), fit, and how early in a posting's life it was reached. Treat it as a tie-breaker between two roles, never a forecast.

The apply queue sorts by city first, then by compatibility. All three scores ride along into the ledger and the dashboard, and into a one-line Slack explanation of the evidence behind them.

## 📮 Applying

Filling a form only happens on Greenhouse, Lever, and Ashby, whose public apply pages the generic Playwright filler understands. It fills the fields it recognizes — name, email, phone, résumé, a few links — and refuses to guess: an unrecognized *required* field aborts that one application rather than submitting something wrong. Everything else, Workday included, is routed to Slack for a human to finish by hand; Workday is scraped and surfaced but never auto-applied to. US postings are skipped unless they explicitly offer sponsorship.

Because a submission is irreversible and gets recorded as applied, the runner refuses to start unless the applicant's name, email, and phone are set and `assets/resume.pdf` is a real PDF of at least 4 KB — an empty file, a stub, or a Git LFS pointer is a fatal error, not a warning. Dry-run mode is on by default: it fills forms and never clicks submit.
