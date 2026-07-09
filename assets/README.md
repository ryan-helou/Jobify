# Assets

Place your application documents here (they are committed to the repo, per design):

- `resume.pdf` — **required.** Attached to every application.
- `cover_letter.pdf` — optional PDF, attached when a form has a cover-letter file upload.
- `cover_letter.txt` — generic cover letter text, pasted into cover-letter textareas. Edit the placeholder that's here.
- `profile.json` — the candidate model used to score how well a posting fits you.

## Résumé validation

The runner **refuses to start** unless `resume.pdf` (and `cover_letter.pdf`, if present) is a real PDF: it must begin with a `%PDF-` header and be at least `MIN_RESUME_BYTES` (default 4096) bytes.

This exists because whatever sits at these paths is uploaded to real employers, the submission cannot be undone, and each one is recorded as `applied` so it is never retried. Checking only that the file *exists* is not enough — an empty file, a setup placeholder, a truncated download, or a Git LFS pointer all pass that check and all produce a ruined application. Do not commit a stub here to "make the run go."
