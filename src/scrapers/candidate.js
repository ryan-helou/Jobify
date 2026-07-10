import { isDevRole, matchCity } from './github.js';
import { classifyPosting } from '../term.js';

// The gate every direct-ATS scraper applies to a raw posting, and the board row it
// produces on success. Factored out because the Tier-1 scrapers (Workable, Recruitee,
// iCIMS, Eightfold, Personio, BambooHR, Phenom) all want exactly this shape, and a
// per-scraper copy is how a field drifts. ats.js/workday.js/smartrecruiters.js
// predate this and keep their own inline `candidate()` — identical in effect.
//
// Returns null when the title isn't a dev internship or the location isn't one of
// our cities, so callers can `.filter(Boolean)`. `kind` is passed through to
// isDevRole: 'internship' for a normal board (title must say intern/co-op),
// 'campus' for a student-only site where every posting is an internship already.
export function buildJob({ company, title, location, url, source, description = '', compensation = '', kind = 'internship' }) {
  if (!url || !title) return null;
  if (!isDevRole(title, kind)) return null;
  const city = matchCity(location);
  if (!city) return null;
  return {
    id: url,
    title,
    company: company || '',
    location: String(location || ''),
    city: city.key,
    country: city.country,
    url,
    source,
    sponsorship: null, // company boards carry no curated sponsorship field
    description: description || '',
    compensation: compensation || '',
    term: classifyPosting(title, description),
  };
}
