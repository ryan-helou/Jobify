# Assets

Place your application documents here (they are committed to the repo, per design):

- `resume-base.pdf` — **required.** The fallback, attached to any posting that doesn't route elsewhere.
- `resume-backend.pdf` — optional. Backend / infrastructure postings.
- `resume-frontend.pdf` — optional. Frontend / mobile postings.
- `resume-ai.pdf` — optional. ML / AI / data postings.
- `resume-game.pdf` — optional. Game development postings.
- `cover_letter.pdf` — optional PDF, attached when a form has a cover-letter file upload.
- `cover_letter.txt` — generic cover letter text, pasted into cover-letter textareas. Edit the placeholder that's here.
- `profile.json` — the candidate model used to score how well a posting fits you.

## Which résumé gets attached

`src/resume.js` picks one per posting, from three sources, in descending authority:

1. **The title**, via the role family (`ROLE_FAMILIES`). A posting names its role on purpose.
2. **The description**, via `RESUME_SIGNALS`. Noisier — a company mentions Docker because it uses Docker, not because you'll write Dockerfiles — so the body only overrides an explicit title when it wins by `RESUME_MIN_MARGIN`.
3. **The company**, via `RESUME_COMPANY_HINTS`. Weight 1, and deliberately unable to decide anything alone: a games studio also hires backend and IT engineers.

A body-only decision additionally needs `RESUME_MIN_SUPPORT` independent pieces of evidence. Margin alone is not enough, because one keyword clears it: *"you will write Go services, familiarity with HTML/CSS a plus"* would otherwise attach the frontend résumé to a backend job. Title evidence is exempt — a title that names the role has corroborated itself.

The GitHub listings feeds carry no description, so `src/apply/index.js` reads the posting page on the way to the application form and routes on that. This costs nothing — we were loading the page anyway. It reads the ATS's description container rather than the whole page, because a careers-page footer lists the company's *other* open roles, and those titles are precisely the vocabulary this router keys on.

A generic title with no useful description gets `resume-base.pdf`. That is the intended outcome, not a failure.

To see a decision without applying to anything:

```
npm run explain-resume                       # a matrix of representative postings
node scripts/explain-resume.js "Software Engineer Intern" \
  --company Ubisoft --description "Gameplay systems in Unity."
```

Only `resume-base.pdf` is required. A missing variant degrades to base with a warning at startup, so you can add them one at a time. The chosen variant is written into `applied_jobs.json` and into the Slack notification, so you can always tell which résumé an employer actually received.

## Résumé validation

The runner **refuses to start** unless `resume-base.pdf` (and `cover_letter.pdf` or any variant résumé, if present) is a real PDF: it must begin with a `%PDF-` header and be at least `MIN_RESUME_BYTES` (default 4096) bytes. A *missing* variant is only a warning; a *broken* one is fatal, because that file would be uploaded the moment a matching posting arrives.

This exists because whatever sits at these paths is uploaded to real employers, the submission cannot be undone, and each one is recorded as `applied` so it is never retried. Checking only that the file *exists* is not enough — an empty file, a setup placeholder, a truncated download, or a Git LFS pointer all pass that check and all produce a ruined application. Do not commit a stub here to "make the run go."
