import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Minimal .env loader (no dependency) — real env vars always win.
try {
  const envFile = fs.readFileSync('.env', 'utf8');
  for (const line of envFile.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {
  /* no .env file — fine */
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Ordered by priority: Montreal, Toronto, New York, San Francisco. The order is
// load-bearing twice over — it sorts the apply queue, and matchCity resolves a
// multi-city posting to the first entry it names, so a "New York / SF" role is
// treated as New York.
// `match` covers the whole commutable metro, not just the city proper: postings
// say "San Jose" or "Sunnyvale" for what is the same Bay Area office market, and
// matching only "San Francisco" silently discarded a third of the Summer 2027
// listings. Suburb names are qualified with a province/state where the bare name
// is ambiguous ("Laval" is also in France, "Waterloo" also in Ontario vs Iowa).
export const CITIES = [
  {
    key: 'montreal',
    name: 'Montreal, QC',
    country: 'CA',
    indeedDomain: 'ca.indeed.com',
    match: /montr[eé]al|laval, ?qc|longueuil/i,
  },
  {
    key: 'toronto',
    name: 'Toronto, ON',
    country: 'CA',
    indeedDomain: 'ca.indeed.com',
    match: /toronto|mississauga|markham|north york|etobicoke|vaughan|waterloo, ?on/i,
  },
  {
    key: 'vancouver',
    name: 'Vancouver, BC',
    country: 'CA',
    indeedDomain: 'ca.indeed.com',
    match: /vancouver|burnaby|richmond, ?bc|victoria, ?bc/i,
  },
  {
    key: 'ottawa',
    name: 'Ottawa, ON',
    country: 'CA',
    indeedDomain: 'ca.indeed.com',
    match: /ottawa|gatineau|kanata/i,
  },
  {
    key: 'calgary',
    name: 'Calgary, AB',
    country: 'CA',
    indeedDomain: 'ca.indeed.com',
    match: /calgary|edmonton/i,
  },
  {
    key: 'nyc',
    name: 'New York, NY',
    country: 'US',
    indeedDomain: 'www.indeed.com',
    match: /new york|\bnyc\b|manhattan|brooklyn|jersey city|hoboken/i,
  },
  {
    key: 'sf',
    name: 'San Francisco, CA',
    country: 'US',
    indeedDomain: 'www.indeed.com',
    match: /san francisco|\bsf\b|bay area|san jose|sunnyvale|palo alto|mountain view|menlo park|santa clara|cupertino|redwood city|south san francisco|foster city/i,
  },
];

// Any Canadian location that CITIES doesn't place to a specific hub still belongs on
// the board — the target is "anywhere in Canada", and a role tagged only "Canada",
// "Remote - Canada" or a smaller city (Waterloo, Halifax, Quebec City) was being
// dropped outright. Cohere, for one, tags its interns just "Canada". This matches a
// province name/abbreviation, the word Canada, or a remote-in-Canada phrasing.
//
// Deliberately narrow so it never claims a US posting: bare "ON"/"QC" must be a
// standalone token, and US-only signals are excluded first by matchCity trying the
// US CITIES entries. "Ontario, CA" (California) is guarded by requiring Canada
// context, not a bare province, when the string also names a US state.
// "Ontario" is also a city in California, so that one province name is guarded
// against a following US-state context; the rest don't collide with US place names.
export const CANADA_ANY =
  /\bcanad(?:a|ian)\b|\bontario\b(?!\s*,?\s*(?:ca\b|calif))|\b(?:quebec|qu[eé]bec|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland|prince edward)\b|,\s*(?:QC|ON|BC|AB|MB|SK|NS|NB|NL|PE)\b|\b(?:QC|ON|BC|AB|MB|SK|NS|NB|NL|PE),?\s*canada\b|\b(?:kitchener|waterloo|halifax|winnipeg|quebec city|qu[eé]bec city|mississauga|hamilton, ?on|london, ?on)\b/i;

// The bucket a Canadian posting lands in when no specific hub matched. Not a member
// of CITIES (nothing searches it; Indeed iterates CITIES), just a resolved label.
export const CANADA_FALLBACK = { key: 'canada', name: 'Canada (other)', country: 'CA' };

export const SEARCH_QUERY = 'software engineering internship summer 2027';

// Role must look like an internship / entry-level dev role, and not be for a past/other season.
// The word boundaries are load-bearing: an unanchored /intern/ also matches
// "Internal", "International" and "Internet", which quietly admitted senior
// full-time roles ("Software Engineer - Internal Platform") to the apply queue.
export const ROLE_INCLUDE = /\b(intern(?:ship|s)?|new grad(?:uate)?s?|entry[\s-]?level|co[\s-]?op)\b/i;
export const ROLE_EXCLUDE = /\b20(2[0-6])\b/; // mentions 2020–2026 explicitly → not summer 2027

// Software/developer signal — at least one must be present so we don't apply to
// unrelated internships (finance, design, ops) that merely contain "intern".
export const DEV_INCLUDE =
  /\b(software|swe|sde|developer|dev|engineer|engineering|full[\s-]?stack|front[\s-]?end|back[\s-]?end|firmware|embedded|infrastructure|platform|systems|web|mobile|ios|android|data engineer|machine learning|ml|ai|devops|sre|security|programming|coding|computer science|cs)\b/i;

// Explicitly non-developer roles that can slip past DEV_INCLUDE (e.g. "GTM Engineer",
// "Research Scientist", hardware/design/sales tracks). Skipped even if they say "engineer".
//
// Note the `engineer(?:ing)?` suffixes: "Mechanical Engineer" and "Mechanical
// Engineering Intern" are the same role, but `\bmechanical engineer\b` only matches
// the first — a word boundary can't sit between "engineer" and "ing".
export const NON_DEV_EXCLUDE =
  /\b(research scientist|quantitative research|quant research|go[\s-]?to[\s-]?market|gtm|sales|marketing|merchandising|recruit(?:ing|er|ment)?|talent|analyst|strategist|consultant|field application|solutions? architect|technical writer|product manage(?:r|ment)|product design|program manager|project manager|ux|ui\/ux|graphic|content|community|(?:mechanical|electrical|hardware|civil|chemical|industrial|aerospace) engineer(?:ing)?|biomedical|manufacturing|supply chain|accounting|legal|hr|green infrastructure|environmental|geotechnical|structural|surveying|traffic)\b/i;

// A title that names a non-summer season is off-cycle no matter which year it
// gives — the target is Summer 2027 specifically. Guarded against "Spring Boot"
// (a framework) and "waterfall" (no word boundary before "fall").
export const OFF_SEASON_TITLE = /\b(fall|autumn|winter)\b|\bspring\b(?!\s*(?:boot|framework))/i;

// US postings must explicitly mention sponsorship, otherwise skipped.
export const VISA_KEYWORDS = [
  'visa sponsorship',
  'sponsorship available',
  'sponsorship is available',
  'able to sponsor',
  'we sponsor',
  'do sponsor',
  'offer sponsorship',
  'provide sponsorship',
  'will sponsor',
  'willing to sponsor',
  'h1b',
  'h-1b',
  'h1-b',
  'sponsor work visa',
  'sponsor a work visa',
  'sponsor a visa',
  'sponsor visas',
  'work authorization sponsorship',
  'immigration sponsorship',
];

// Phrases that mean "we do NOT sponsor" — their presence forces a skip even if a
// stray keyword above also appears (e.g. "we are unable to provide sponsorship").
export const VISA_NEGATIONS = [
  'unable to sponsor',
  'not able to sponsor',
  'cannot sponsor',
  "can't sponsor",
  'do not sponsor',
  "don't sponsor",
  'not sponsor',
  'no sponsorship',
  'without sponsorship',
  'not provide sponsorship',
  'not offer sponsorship',
  // "Visa sponsorship is not available for this role" — a refusal phrased without
  // any of the verbs above, which read as an *offer* on the strength of the keyword.
  'sponsorship is not available',
  'sponsorship not available',
  'not eligible for sponsorship',
  'unable to provide sponsorship',
  'not offer visa sponsorship',
  'not provide visa sponsorship',
  'must be authorized to work',
  'must already be authorized',
  'without the need for sponsorship',
  'do not require sponsorship',
];

// GitHub job boards. Prefer each repo's structured listings.json over its README:
// the JSON carries authoritative `active`, `season`, `sponsorship` and a proper
// locations array, so we filter precisely and skip dead postings before opening
// a browser. Only speedyapply lacks a JSON feed, so it stays on markdown parsing.
//
//   kind: 'internship' → title must say intern/co-op, and season must be Summer
//   kind: 'newgrad'    → the whole board is entry-level, so no intern token is
//                        required; instead reject senior/levelled titles
//
// `term` says how much the source itself guarantees about the hiring cycle. A
// board's *name* is not evidence: SimplifyJobs/Summer2026-Internships is pushed
// daily and looks alive, but its listings are last cycle's, and these repos get
// renamed in place when the cycle turns. Only declare '2027' where the feed
// enforces it (a repo scoped to 2027 whose season field we also filter on).
//
//   term: '2027'   → every posting from this source is Summer 2027 by construction
//   term: 'detect' → unknown; classify each posting from its description
//
// `harvestOnly` sources contribute no jobs at all — we read them purely for the
// company ATS board tokens hidden in their apply URLs. A board can be worthless
// as a job feed (wrong hiring cycle, wrong role type) while still naming hundreds
// of employers whose own Greenhouse/Ashby/Lever boards do carry Summer 2027 roles.
export const GITHUB_SOURCES = [
  {
    name: 'vanshb03/Summer2027-Internships',
    type: 'listings',
    kind: 'internship',
    term: '2027', // repo is 2027-only and we filter season === Summer below
    url: 'https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/dev/.github/scripts/listings.json',
  },
  {
    name: 'speedyapply/2027-SWE-College-Jobs',
    type: 'markdown',
    kind: 'internship',
    term: '2027', // repo is scoped to the 2027 cycle
    url: 'https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/README.md',
  },
  {
    name: 'speedyapply/2027-AI-College-Jobs',
    type: 'markdown',
    kind: 'internship',
    term: '2027',
    url: 'https://raw.githubusercontent.com/speedyapply/2027-AI-College-Jobs/main/README.md',
  },
  {
    // Writes apply links as markdown `[apply](url)` rather than <a href>, so this
    // source only became readable once cellLink learned to fall back to markdown.
    // Like speedyapply, it is 2027-scoped but mixes in off-season terms — the
    // off-season title guard in termForSource is what keeps those out.
    name: 'sndsh404/summer-2027-internships',
    type: 'markdown',
    kind: 'internship',
    term: '2027',
    url: 'https://raw.githubusercontent.com/sndsh404/summer-2027-internships/main/README.md',
  },
  {
    // Full-time new-grad roles, not internships. Mined for board tokens only.
    name: 'SimplifyJobs/New-Grad-Positions',
    type: 'listings',
    harvestOnly: true,
    url: 'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json',
  },
  {
    // Last cycle's internships — never apply to these. But its ~15k postings name
    // the employers who run summer internship programs at all, which is exactly
    // the set of ATS boards worth enumerating for Summer 2027.
    name: 'SimplifyJobs/Summer2026-Internships',
    type: 'listings',
    harvestOnly: true,
    url: 'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json',
  },
  // Canadian boards. Their listings are the 2026 cycle and their tables use markdown
  // links our parser can't read — but that doesn't matter, because we mine them for
  // employer board tokens only. Without these, no Canadian employer is ever queried:
  // only 7 of 44 major Canadian tech firms appear anywhere in the US feeds above.
  // Most of what they name is Workday, which is why these arrived with workday.js.
  {
    name: 'negarprh/Canadian-Tech-Internships',
    type: 'markdown',
    harvestOnly: true,
    url: 'https://raw.githubusercontent.com/negarprh/Canadian-Tech-Internships-2026/main/README.md',
  },
  {
    name: 'hanzili/canada_sde_intern_position',
    type: 'markdown',
    harvestOnly: true,
    url: 'https://raw.githubusercontent.com/hanzili/canada_sde_intern_position/main/README.md',
  },
  {
    name: 'Dannny-Babs/Canadian-Tech-Internships',
    type: 'markdown',
    harvestOnly: true,
    url: 'https://raw.githubusercontent.com/Dannny-Babs/Canadian-Tech-Internships-2025/main/README.md',
  },
];

// ---- hiring-term classification ------------------------------------------
// Only a season+year phrase is trusted to *reject* a posting. A bare year is too
// weak on its own: Summer 2026 listings routinely say "graduating by 2027", so
// treating a stray "2027" as proof would readmit exactly the stale roles we're
// trying to exclude. Anything ambiguous falls through to 'unstated' → a human
// looks at it, rather than being auto-applied or silently dropped.
export const TERM_TARGET = /summer\s*(?:of\s*)?['’]?\s*2027|2027\s+summer/i;
export const TERM_OTHER_SEASON = /(?:summer|fall|autumn|winter|spring)\s*(?:of\s*)?['’]?\s*20(?:1\d|2[0-6])\b/i;
export const YEAR_TARGET = /\b2027\b/;
export const YEAR_PAST = /\b20(?:1\d|2[0-6])\b/;

// Internship boards carry off-cycle seasons too — we only want Summer.
export const WANTED_SEASON = /summer/i;

// New-grad boards mix in levelled and senior roles ("Software Developer 2",
// "Senior Model Validation Analyst"). Those are not entry-level.
export const SENIOR_EXCLUDE =
  /\b(senior|sr\.?|staff|principal|lead|manager|director|head of|vp|vice president|architect|distinguished|fellow)\b|\b(engineer|developer|scientist)\s*(ii|iii|iv|v|[2-9])\b/i;

// Categories on the new-grad board that count as developer work.
export const DEV_CATEGORIES = new Set([
  'Software Engineering',
  'Software',
  'AI/ML/Data',
  'Data Science, AI & Machine Learning',
]);

// Markdown boards encode visa status as emoji in the role title, and their READMEs
// define them: 🛂 "Does NOT offer Sponsorship", 🇺🇸 "Requires U.S. Citizenship".
// Mapping them onto the same vocabulary the JSON feeds use means the visa filter
// can trust a markdown row without rendering the posting.
export const SPONSORSHIP_MARKERS = [
  { re: /\u{1F1FA}\u{1F1F8}/u, value: 'U.S. Citizenship is Required' },
  { re: /\u{1F6C2}/u, value: 'Does Not Offer Sponsorship' },
];

// Authoritative sponsorship values used by the SimplifyJobs-style feeds.
// 'Other' (and anything unknown) means "not stated" → fall back to reading the page.
export const SPONSORSHIP_VERDICT = {
  'Offers Sponsorship': 'offers',
  'Does Not Offer Sponsorship': 'denies',
  'U.S. Citizenship is Required': 'denies',
};

// ---- scoring inputs -------------------------------------------------------
//
// Three scores are attached to every posting (see src/score.js):
//
//   compatibility — how well *this* candidate fits *this* posting
//   quality       — how good the internship is, candidate-independent
//   interviewOdds — a heuristic prior, NOT a calibrated probability
//
// The lexicons below are the evidence those scores are computed from. They are
// meant to be edited: a skill this candidate doesn't have is noise, and a
// company tier list is an opinion, not a fact.

// Canonical skill → the shapes a posting writes it in. The keys are what
// assets/profile.json lists; the regexes are what we look for in the posting.
//
// Deliberately conservative on short names. Bare `go`, `c` and `rest` are
// unmatchable without false positives ("go to market", "C-level executives",
// "the rest of the team"), so they're only matched in unambiguous forms.
export const SKILL_LEXICON = {
  javascript: /\bjavascript\b|\bes6\b/i,
  typescript: /\btypescript\b/i,
  python: /\bpython\b/i,
  java: /\bjava\b/i, // \b after "java" can't match inside "javascript"
  // No trailing \b after `++` / `#`: a word boundary needs a word character on
  // one side, and these are almost always followed by punctuation ("C++.", "C#,").
  // `\bc\+\+\b` matches essentially only "C++11", so it silently never fired.
  'c++': /\bc\+\+|\bcpp\b/i,
  'c#': /\bc#|\b\.net\b|\bdotnet\b/i,
  c: /\bc\/c\+\+\b|\bembedded c\b/i,
  go: /\bgolang\b|\bgo\s+(?:programming|developer|lang)\b/i,
  rust: /\brust\b/i,
  ruby: /\bruby\b|\brails\b/i,
  swift: /\bswift\b|\bswiftui\b/i,
  kotlin: /\bkotlin\b/i,
  react: /\breact\b|\breact\.?js\b|\bnext\.?js\b/i,
  vue: /\bvue\b|\bnuxt\b/i,
  angular: /\bangular\b/i,
  // Bare "Node" is almost always Node.js in a posting, but infrastructure prose
  // says "each compute node". Plurals ("Kubernetes nodes") fail \bnode\b on
  // their own; the lookbehind catches the singular qualifiers.
  node: /\bnode\.?js\b|\bexpress\.?js\b|(?<!\b(?:compute|cluster|worker|leaf|graph|tree|edge|gpu|storage|kubernetes|k8s)\s)\bnode\b/i,
  django: /\bdjango\b|\bflask\b|\bfastapi\b/i,
  spring: /\bspring boot\b|\bspring framework\b/i,
  sql: /\bsql\b|\bpostgres(?:ql)?\b|\bmysql\b|\bsqlite\b/i,
  nosql: /\bnosql\b|\bmongodb\b|\bdynamodb\b|\bredis\b|\bcassandra\b/i,
  aws: /\baws\b|\bamazon web services\b|\bec2\b|\bs3\b|\baws lambda\b/i,
  gcp: /\bgcp\b|\bgoogle cloud\b/i,
  azure: /\bazure\b/i,
  docker: /\bdocker\b|\bcontaineriz(?:ed|ation)\b/i,
  kubernetes: /\bkubernetes\b|\bk8s\b/i,
  terraform: /\bterraform\b|\bpulumi\b/i,
  ci: /\bci\/cd\b|\bcontinuous integration\b|\bgithub actions\b|\bjenkins\b/i,
  git: /\bgit\b|\bgithub\b|\bversion control\b/i,
  linux: /\blinux\b|\bunix\b/i,
  graphql: /\bgraphql\b/i,
  rest: /\brest(?:ful)?\s*apis?\b|\brestful\b/i,
  ml: /\bmachine learning\b|\bdeep learning\b|\bneural network/i,
  pytorch: /\bpytorch\b|\btensorflow\b|\bjax\b/i,
  nlp: /\bnlp\b|\bnatural language\b|\bllms?\b|\blarge language model/i,
  cv: /\bcomputer vision\b|\bopencv\b/i,
  datascience: /\bpandas\b|\bnumpy\b|\bscikit|\bjupyter\b/i,
  spark: /\bspark\b|\bhadoop\b|\bkafka\b|\bairflow\b/i,
  distributed: /\bdistributed systems?\b|\bmicroservices\b/i,
  security: /\bcryptography\b|\bpenetration test|\bappsec\b|\bthreat model/i,
  ios: /\bios\b|\bxcode\b|\buikit\b/i,
  android: /\bandroid\b|\bjetpack\b/i,
  embedded: /\bembedded\b|\bfirmware\b|\brtos\b|\bverilog\b/i,
  algorithms: /\balgorithms?\b|\bdata structures\b/i,
  testing: /\bunit test|\bintegration test|\bjest\b|\bpytest\b/i,
};

// Role families, matched against the title. Order is load-bearing — "Full Stack"
// also contains "stack" adjacent words, and a "Frontend Platform" role should
// resolve as frontend, so the more specific patterns are tested first.
//
// `game` is tested before everything: a games posting names its domain in the
// title and means it, and the alternatives would steal it. "Game AI Programmer"
// contains \bai\b and would otherwise resolve to ml; "Full Stack Game Developer"
// would resolve to fullstack. In both cases the games résumé is the right one.
export const ROLE_FAMILIES = [
  ['game', /\bgames?\b|\bgaming\b|\bgameplay\b|\bunity\b|\bunreal\b|\bgodot\b|game engine|\bgamedev\b|graphics (?:engineer|programmer)/i],
  ['fullstack', /full[\s-]?stack/i],
  ['ml', /machine learning|\bml\b|\bai\b|deep learning|\bnlp\b|computer vision|research engineer/i],
  ['data', /data (?:engineer|scien|analytic)|analytics/i],
  ['security', /security|cryptograph|appsec/i],
  ['mobile', /\bmobile\b|\bios\b|\bandroid\b/i],
  ['embedded', /embedded|firmware/i],
  ['infra', /infrastructure|platform|devops|\bsre\b|cloud|reliability|systems/i],
  ['frontend', /front[\s-]?end|\bui\b|\bweb\b/i],
  ['backend', /back[\s-]?end|server|\bapi\b|distributed/i],
];
export const DEFAULT_ROLE_FAMILY = 'swe';

// What a good internship says about itself. Presence is weak evidence; absence
// is weaker still (plenty of excellent programs write terse postings), which is
// why the quality score never drops far on silence alone.
export const QUALITY_SIGNALS = {
  returnOffer: /\breturn offer\b|full[\s-]?time (?:offer|conversion)|convert(?:ing|ed)? to full[\s-]?time/i,
  mentorship: /\bmentor(?:ship|ed|s)?\b|\bbuddy\b|paired with (?:a|an)? ?(?:senior|engineer)/i,
  cohort: /intern (?:class|cohort|program)|\bcohort\b|summer program|intern events/i,
  relocation: /\brelocation\b|\bhousing\b|\bstipend\b/i,
  ship: /\bship\b|\bproduction\b|real (?:code|projects?|impact)|end[\s-]to[\s-]end|meaningful (?:work|projects?)/i,
  review: /\bcode reviews?\b|design (?:doc|review)|pull requests?|pair programming/i,
};

// Phrases that mean the internship isn't worth the application. Narrow on
// purpose: a bare /unpaid/ also matches "unpaid leave" in a benefits section.
export const QUALITY_RED_FLAGS = {
  unpaid: /\bunpaid (?:internship|position|role)\b|\bthis is an unpaid\b|\bno compensation\b/i,
  creditOnly: /credit[\s-]only|for (?:course|academic|school) credit\b/i,
};

// Compensation, normalized to an hourly equivalent before scoring.
export const HOURS_PER_MONTH = 173.33;
export const HOURS_PER_YEAR = 2080;
// Matches "$45/hr", "$40 - $55 per hour", "$8,000/month", "$120k/year".
// A range takes its midpoint. The `[a-z]{1,3}` before the upper bound's `$` is
// load-bearing: Ashby writes Canadian rates as "CA$40 - CA$50 / hr", and without
// it the range fails to match and the regex latches onto the upper bound alone,
// scoring the posting at the top of its band.
// Currency itself is ignored — CAD and USD go on the same curve, which slightly
// flatters Canadian postings. Accepted: the alternative is an FX feed for a
// heuristic that's ±10 points anyway.
// The leading `[a-z]{1,3}` is only there so the matched text reads "CA$40 - CA$50"
// rather than "$40 - CA$50" when it's echoed back to Slack and the dashboard.
export const PAY_PATTERN =
  /(?:[a-z]{1,3})?\$\s?([\d,]+(?:\.\d+)?)\s*(k\b)?(?:\s*(?:-|–|—|to)\s*(?:[a-z]{1,3})?\$?\s?([\d,]+(?:\.\d+)?)\s*(k\b)?)?\s*(?:\/|\s+per\s+|\s+an?\s+)\s*(hour|hr|month|mo|year|yr|annum)/i;
// Hourly rate → quality points. Anchored on the 2026 US intern market: ~$20/hr
// is the low end of paid, ~$50/hr is strong, big-tech tops out near $80/hr.
export const PAY_CURVE = [
  [15, 10],
  [20, 25],
  [25, 40],
  [30, 50],
  [40, 65],
  [50, 80],
  [65, 92],
  [80, 100],
];
// A posting that never states pay. Most don't, outside CA/NY/CO/WA pay-
// transparency law, so silence is neutral-minus rather than a penalty.
export const PAY_UNSTATED_SCORE = 55;

// Company prestige. Raises `quality` and lowers `interviewOdds` — the same name
// that makes an internship worth having makes it harder to get.
//
// This is an editable opinion, not a ranking. Names are normalized by
// `normalizeCompany` in src/score.js (lowercased, legal suffix and punctuation
// stripped), so add entries in that same form: "Jane Street" → "janestreet".
export const TOP_TIER_COMPANIES = new Set([
  'google', 'alphabet', 'meta', 'facebook', 'apple', 'amazon', 'microsoft', 'netflix', 'nvidia',
  'openai', 'anthropic', 'deepmind', 'googledeepmind', 'xai', 'ssi',
  'janestreet', 'citadel', 'citadelsecurities', 'twosigma', 'hudsonrivertrading', 'hrt', 'jumptrading',
  'optiver', 'imc', 'imctrading', 'deshaw', 'towerresearchcapital', 'radixtrading', 'sig', 'susquehanna',
  'stripe', 'databricks', 'palantir', 'snowflake', 'figma', 'ramp', 'anduril', 'scaleai',
  'spacex', 'tesla', 'waymo', 'coinbase', 'airbnb', 'uber', 'doordash', 'linkedin', 'roblox',
]);
export const STRONG_TIER_COMPANIES = new Set([
  'shopify', 'atlassian', 'salesforce', 'adobe', 'oracle', 'ibm', 'intel', 'amd', 'qualcomm',
  'cloudflare', 'datadog', 'mongodb', 'hashicorp', 'twilio', 'dropbox', 'block', 'square',
  'robinhood', 'instacart', 'reddit', 'pinterest', 'snap', 'discord', 'plaid', 'brex',
  'notion', 'linear', 'vercel', 'retool', 'asana', 'lyft', 'spotify', 'squarespace',
  'perplexity', 'cohere', 'mistral', 'mistralai', 'huggingface', 'anysphere', 'cursor',
  'appliedintuition', 'rippling', 'gusto', 'benchling', 'affirm', 'chime', 'wealthsimple',
  'shopifyplus', 'sonder', 'cohereai', 'element', 'ideogram', 'together', 'togetherai',
]);

// Interview-odds model. Read src/score.js before trusting any of these numbers —
// they are a documented guess, tuned to feel right, calibrated against nothing.
export const ODDS_BASE_RATE = 0.06; // P(application → first-round interview), prior
export const ODDS_FLOOR = 0.01;
export const ODDS_CEILING = 0.6;

export const PROFILE_PATH = path.join(ROOT, 'assets', 'profile.json');

// Used when assets/profile.json is missing or unreadable. A generic CS student.
export const DEFAULT_PROFILE = {
  skills: ['javascript', 'typescript', 'python', 'java', 'react', 'node', 'sql', 'git', 'linux', 'algorithms'],
  strongSkills: ['javascript', 'python', 'react'],
  preferredFamilies: ['swe', 'fullstack', 'backend', 'frontend', 'infra', 'ml', 'data', 'mobile', 'security', 'embedded'],
};

// The candidate model that `compatibility` scores against. Unknown skill keys
// are dropped (and reported by validateConfig) rather than silently ignored —
// a typo'd skill would otherwise quietly depress every score.
function loadProfile() {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
  } catch {
    /* no profile.json — defaults below */
  }
  const merged = { ...DEFAULT_PROFILE, ...file };
  return {
    skills: (merged.skills || []).filter((s) => s in SKILL_LEXICON),
    strongSkills: (merged.strongSkills || []).filter((s) => s in SKILL_LEXICON),
    preferredFamilies: merged.preferredFamilies || DEFAULT_PROFILE.preferredFamilies,
    unknownSkills: [...(merged.skills || []), ...(merged.strongSkills || [])].filter((s) => !(s in SKILL_LEXICON)),
  };
}

export const CANDIDATE = loadProfile();

function profileFile() {
  try {
    return JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

// Answers to the questions every application form asks beyond name/email/phone.
// Absent values stay empty rather than defaulting: a wrong school or graduation
// date on a real application is worse than an aborted one.
export const EDUCATION = {
  school: '',
  degree: '',
  major: '',
  startMonth: '',
  startYear: '',
  graduationMonth: '',
  graduationYear: '',
  gpa: '',
  ...(profileFile().education || {}),
};

// How many co-op/internship terms are already finished. A string, because the forms
// asking it are free-text and an empty value must stay empty rather than become "0".
export const COMPLETED_WORK_TERMS = String(profileFile().completedWorkTerms ?? '');

// Keyed by the country a question is about, not the country of the posting — a US
// employer hiring in Toronto still asks "authorized to work in the US?". A country
// that is missing here means we cannot answer, and the applier aborts rather than
// guessing. Each entry is a legal statement made on the applicant's behalf.
export const WORK_AUTH = profileFile().workAuthorization || {};

// Where the applicant actually lives. Forms asking "current location" used to be
// filled with the *posting's* location, which told every employer the applicant
// already lived in their city. Empty means we don't know, and a required location
// field aborts rather than inventing a residence.
export const APPLICANT_LOCATION = profileFile().location || '';

// Postings below this compatibility score are skipped without applying. Off by
// default (0) — turn it up once you've seen how the scores land on real jobs.
export const MIN_COMPATIBILITY = parseInt(process.env.MIN_COMPATIBILITY || '0', 10);

// Postings that never name a hiring term go to a human by default (see term.js).
// That is the safe reading, but it parked every Canadian posting we found — co-op
// listings say "12-month" or "Co-op", almost never "Summer 2027" — while the only
// application that went out was the one US posting that spelled its term out.
// Turning this on applies to them instead. The cost of being wrong is an
// application to the wrong cycle, which an employer discards; the cost of leaving
// it off is applying to nothing.
export const APPLY_UNSTATED_TERM = (process.env.APPLY_UNSTATED_TERM || 'false').toLowerCase() === 'true';

export const APPLICANT = {
  name: process.env.APPLICANT_NAME || '',
  email: process.env.APPLICANT_EMAIL || '',
  phone: process.env.APPLICANT_PHONE || '',
  linkedin: process.env.APPLICANT_LINKEDIN || '',
  github: process.env.APPLICANT_GITHUB || '',
  website: process.env.APPLICANT_WEBSITE || '',
};

// --- Résumé routing --------------------------------------------------------
//
// One résumé per role shape, chosen per posting by src/resume.js. `base` is the
// fallback and the only one that must exist: a missing variant degrades to base
// rather than aborting the run, because attaching a slightly-off résumé beats
// attaching none, and the alternative is a hard failure the night before a
// deadline over a file you haven't exported yet.
export const DEFAULT_RESUME_VARIANT = 'base';

export const RESUME_VARIANT_FILES = {
  base: 'resume-base.pdf',
  backend: 'resume-backend.pdf',
  frontend: 'resume-frontend.pdf',
  ai: 'resume-ai.pdf',
  game: 'resume-game.pdf',
};

export const RESUME_VARIANTS = Object.keys(RESUME_VARIANT_FILES);

export function resumePath(variant) {
  const file = RESUME_VARIANT_FILES[variant] || RESUME_VARIANT_FILES[DEFAULT_RESUME_VARIANT];
  return path.join(ROOT, 'assets', file);
}

// Which résumé each role family wants. Families with no dedicated résumé fall to
// base: `security` and `embedded` postings are rare here and the general résumé
// is the honest answer, since there is no security or firmware work to show.
export const RESUME_FAMILY_VARIANT = {
  swe: 'base',
  fullstack: 'base',
  security: 'base',
  embedded: 'base',
  backend: 'backend',
  infra: 'backend',
  frontend: 'frontend',
  mobile: 'frontend',
  ml: 'ai',
  data: 'ai',
  game: 'game',
};

// Evidence found in the posting body, scored per variant. Deliberately NOT
// SKILL_LEXICON: that lexicon answers "does the candidate know this?" and is
// keyed to the profile. This answers a different question — "what shape of work
// is this posting?" — so `sql` is weak evidence of a candidate skill but strong
// evidence of a backend role, and the two lists disagree on purpose.
//
// `base` has no signals by design. It wins by being the fallback, not by
// out-scoring anything; a generic posting should get the generic résumé.
export const RESUME_SIGNALS = {
  base: [],
  backend: [
    { label: 'distributed systems', re: /\bdistributed systems?\b|\bmicroservices\b/i, weight: 2 },
    { label: 'databases', re: /\bpostgres(?:ql)?\b|\bmysql\b|\bdatabase schema\b|\bsql\b/i, weight: 2 },
    { label: 'containers/infra', re: /\bkubernetes\b|\bk8s\b|\bdocker\b|\bterraform\b/i, weight: 2 },
    { label: 'queues/streaming', re: /\bkafka\b|\brabbitmq\b|\bcelery\b|\bmessage queue\b|\bredis\b/i, weight: 2 },
    { label: 'API design', re: /\bgrpc\b|\brest(?:ful)? apis?\b|\bapi design\b/i, weight: 1 },
    { label: 'scale/latency', re: /\bthroughput\b|\blatency\b|\bhigh availability\b|\bscalab/i, weight: 1 },
  ],
  frontend: [
    { label: 'React/Vue/Angular', re: /\breact\b|\bnext\.?js\b|\bvue\b|\bangular\b|\bsvelte\b/i, weight: 2 },
    { label: 'CSS/design systems', re: /\bcss\b|\btailwind\b|\bdesign system\b|\bstyled-components\b/i, weight: 2 },
    { label: 'accessibility', re: /\baccessibility\b|\bwcag\b|\ba11y\b/i, weight: 2 },
    { label: 'browser/DOM', re: /\bbrowser\b|\bdom\b|\bsingle[\s-]page app/i, weight: 1 },
    { label: 'TypeScript', re: /\btypescript\b/i, weight: 1 },
  ],
  ai: [
    { label: 'LLM work', re: /\bllms?\b|\blarge language model|\bprompt engineering\b|\bretrieval[\s-]augmented\b/i, weight: 2 },
    { label: 'ML frameworks', re: /\bpytorch\b|\btensorflow\b|\bscikit|\bjax\b/i, weight: 2 },
    { label: 'machine learning', re: /\bmachine learning\b|\bdeep learning\b|\bneural network/i, weight: 2 },
    { label: 'inference/serving', re: /\bmodel (?:serving|inference|training)\b|\bembeddings?\b|\bvector (?:database|search)\b/i, weight: 2 },
    { label: 'data pipelines', re: /\bairflow\b|\bspark\b|\betl\b|\bdata pipeline/i, weight: 1 },
  ],
  game: [
    { label: 'Unity/Unreal', re: /\bunity\b|\bunreal\b|\bgodot\b/i, weight: 2 },
    { label: 'gameplay/engine', re: /\bgameplay\b|game engine|\bgamedev\b/i, weight: 2 },
    { label: 'graphics/rendering', re: /\bshaders?\b|\brendering\b|\brasteriz|\bgraphics pipeline\b/i, weight: 2 },
    { label: 'physics/simulation', re: /\bphysics (?:engine|simulation)\b|\bcollision detection\b/i, weight: 1 },
    { label: 'C++', re: /\bc\+\+/i, weight: 1 },
  ],
};

// Weak priors from the employer's name. Weight 1 on purpose: a games studio
// hires backend, tools, and IT engineers too — the Ubisoft internship on this
// résumé was Salesforce automation, not gameplay. A hint can tip a posting that
// already leans somewhere; it can never carry one alone, because a variant must
// win by RESUME_MIN_MARGIN (2) to displace what the title says.
export const RESUME_COMPANY_HINTS = [
  {
    label: 'games studio',
    variant: 'game',
    weight: 1,
    re: /\b(ubisoft|electronic arts|\bea\b|behaviour|warner bros\.? games|wb games|eidos|gameloft|epic games|riot games|activision|blizzard|rockstar|bungie|naughty dog|square enix|unity technologies|bethesda|cd projekt|larian|haven studios|ludia|amplitude studios)\b/i,
  },
  {
    label: 'AI lab',
    variant: 'ai',
    weight: 1,
    re: /\b(anthropic|openai|deepmind|cohere|mistral|hugging ?face|scale ai|databricks)\b/i,
  },
];

// Descriptions are scraped page text and can run to hundreds of kilobytes on a
// careers page that inlines its whole site. Routing only needs the posting.
export const RESUME_MAX_DESCRIPTION_CHARS = 20000;

// A title is a stronger signal than a body: a posting names its role in the
// title on purpose, and mentions half the stack in the body as background.
export const RESUME_TITLE_MULTIPLIER = 2;
// What the title's role family alone is worth, before any body evidence. Not
// awarded to DEFAULT_ROLE_FAMILY: "Software Engineer Intern" is the absence of a
// title signal, not evidence for the base résumé. See src/resume.js.
export const RESUME_FAMILY_WEIGHT = 3;
// How far ahead the winner must be to override the title's own family. Below
// this, the body is murmuring rather than speaking, and we trust the title.
export const RESUME_MIN_MARGIN = 2;

// How many independent pieces of evidence a body-only decision needs. Margin
// alone is not enough: one weight-2 signal clears it, so "you will write Go
// services, familiarity with HTML/CSS a plus" scored frontend=2 and confidently
// attached the frontend résumé to a backend job. A posting that is really about
// frontend work says so more than once. Title evidence is exempt — a title that
// names the role has already corroborated itself.
export const RESUME_MIN_SUPPORT = 2;

export const COVER_LETTER_PDF_PATH = path.join(ROOT, 'assets', 'cover_letter.pdf');
export const COVER_LETTER_TXT_PATH = path.join(ROOT, 'assets', 'cover_letter.txt');
// Overridable so a test or a scratch run can point at a throwaway ledger instead
// of the real one — writing to the real ledger marks jobs as handled for good.
export const APPLIED_JOBS_PATH = process.env.APPLIED_JOBS_PATH || path.join(ROOT, 'applied_jobs.json');

// The board: every posting ever seen, scored, with the attributes the pipeline used
// to gate on stored as fields. Separate from applied_jobs.json, which was a ledger of
// what the (now retired) applier did.
export const BOARD_PATH = process.env.BOARD_PATH || path.join(ROOT, 'board.json');

// The closed vocabularies the board writes and the dashboard renders. docs/index.html
// cannot import from src/, so it embeds a copy and test/dashboard.test.js compares the
// two. Add a value here without teaching the dashboard and the test fails, rather than
// the column quietly rendering a raw slug.
export const TERM_VALUES = ['2027', 'exempt', 'unstated', 'other-cycle'];
export const SPONSORSHIP_VALUES = ['offers', 'denies', 'silent', 'n/a'];

export const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
export const DRY_RUN = (process.env.DRY_RUN || 'true').toLowerCase() !== 'false';
// The number of applications actually submitted in a run.
export const MAX_APPLICATIONS_PER_RUN = parseInt(process.env.MAX_APPLICATIONS_PER_RUN || '10', 10);
// A separate, looser bound on how many jobs we'll *look at* to fill that quota.
// Needed because a job can be examined and then skipped (no sponsorship) or handed
// to a human (unsupported ATS) without ever costing an application. Without this,
// a queue full of skips would either submit nothing or grind through everything.
export const MAX_JOBS_EXAMINED_PER_RUN = parseInt(process.env.MAX_JOBS_EXAMINED_PER_RUN || '60', 10);
// Indeed sits behind Cloudflare and is almost always blocked from CI runners, so
// it's off by default. Set ENABLE_INDEED=true to attempt it (best on a residential IP).
export const ENABLE_INDEED = (process.env.ENABLE_INDEED || 'false').toLowerCase() === 'true';

// Company ATS boards (Greenhouse/Lever/Ashby) expose public, unauthenticated JSON
// APIs. We harvest board tokens from the apply URLs the GitHub feeds already give
// us, then enumerate each board directly — that surfaces postings weeks before a
// volunteer adds them to a README, and hands us the description for free, so most
// visa checks no longer need a browser.
export const ENABLE_ATS = (process.env.ENABLE_ATS || 'true').toLowerCase() !== 'false';
export const ATS_CONCURRENCY = parseInt(process.env.ATS_CONCURRENCY || '16', 10);

// Workday speaks the same public-API story as the boards above, but it's the only
// ATS most Canadian employers use (28% of their postings, vs 13% for Greenhouse,
// Ashby and Lever combined). Its pages hold 20 postings each, so cap the paging:
// 10 pages is 200 postings per tenant site, well past any campus portal's inventory.
export const ENABLE_WORKDAY = (process.env.ENABLE_WORKDAY || 'true').toLowerCase() !== 'false';
export const WORKDAY_MAX_PAGES = parseInt(process.env.WORKDAY_MAX_PAGES || '10', 10);

// Oracle Fusion is the biggest ATS after Workday (4,289 postings, 177 tenant sites)
// and the one Canadian banks and telcos run campus hiring on. Pages hold 200.
export const ENABLE_ORACLE = (process.env.ENABLE_ORACLE || 'true').toLowerCase() !== 'false';
export const ORACLE_MAX_PAGES = parseInt(process.env.ORACLE_MAX_PAGES || '5', 10);

// SmartRecruiters has no keyword filter, so every posting is paged through. Its
// pages hold 100 and no company in the feeds posts more than a few hundred roles.
export const ENABLE_SMARTRECRUITERS = (process.env.ENABLE_SMARTRECRUITERS || 'true').toLowerCase() !== 'false';
export const SMARTRECRUITERS_MAX_PAGES = parseInt(process.env.SMARTRECRUITERS_MAX_PAGES || '5', 10);

// Probe ATS boards for employers named in assets/employers.json, so a company can
// be found without waiting for some job board to list it first.
export const ENABLE_DISCOVERY = (process.env.ENABLE_DISCOVERY || 'true').toLowerCase() !== 'false';
export const EMPLOYERS_PATH = path.join(ROOT, 'assets', 'employers.json');

// Workday sites whose entire inventory is student roles, so a title needn't say
// "intern" to be one. Matching this wrongly is expensive: it waives the intern
// check for a whole company, which is how "Executive Assistant - CISO" arrived
// from `pfizer/internaljobs`.
//
// Site names are slugs with no reliable separators — `uvastudentjobs`,
// `IVZearlycareers`, `ExternalPrivatePostingStudents` — so word boundaries can't
// be used. Instead `intern` carries a lookahead rejecting the two words that
// swallow it: intern·al (`spgi_internal`, `Non-WorkdayInternal`) and
// intern·ational (`HUBInternational`, `laticreteinternational`).
export const CAMPUS_SITE =
  /campus|student|intern(?!al|ational)|university|new[-_]?grad|early[-_ ]?career|graduate/i;

// Postings whose term we can't determine go to a human instead of being applied
// to or dropped. Cap how many we surface per run so a first run doesn't dump
// hundreds of Slack lines; the rest stay unrecorded and resurface next run.
export const MANUAL_REVIEW_BATCH = parseInt(process.env.MANUAL_REVIEW_BATCH || '20', 10);

// Shared status vocabulary. The dashboard is a single self-contained HTML file and
// cannot import this, so it carries its own copy of these labels and kinds; the
// copies are held together by test/dashboard.test.js, which fails when they drift.
//
// `kind` names what the status *is to the reader*, not a colour. Only `attention`
// means a human has to do something, and it is the only kind the dashboard paints
// in its accent colour.
export const STATUS_META = {
  applied: { label: 'Applied', kind: 'success' },
  submitted_unconfirmed: { label: 'Submitted, unconfirmed', kind: 'warn' },
  manual_review: { label: 'Needs you', kind: 'attention' },
  skipped_unknown_required: { label: 'Skipped — unknown field', kind: 'muted' },
  skipped_no_sponsorship: { label: 'Skipped — no sponsorship', kind: 'muted' },
  skipped_closed: { label: 'Skipped — closed', kind: 'muted' },
  skipped_wrong_term: { label: 'Skipped — wrong term', kind: 'muted' },
  skipped_low_compatibility: { label: 'Skipped — low fit', kind: 'muted' },
};

// Only an actual submission is final. Everything else is a snapshot of what a
// posting looked like on one particular day, and postings change: a description
// gains "Summer 2027", a company adds sponsorship language, a form we couldn't
// parse gets rebuilt. Recording those verdicts permanently meant one bad reading
// removed a job from consideration forever — 122 postings whose term we couldn't
// determine would be flagged once and never looked at again.
export const TERMINAL_STATUSES = new Set(['applied', 'submitted_unconfirmed']);

// How long a non-terminal verdict stands before the job is reconsidered.
// Tuned to how fast the underlying fact can change:
//   manual_review           — we never decided; look again soon
//   skipped_unknown_required— the form had a field we couldn't fill; forms get rebuilt
//   skipped_no_sponsorship  — sponsorship language is edited mid-cycle
//   skipped_low_compatibility — only changes when assets/profile.json changes
//   skipped_closed          — a closed posting rarely reopens
//   skipped_wrong_term      — a Fall 2026 co-op never becomes Summer 2027, but the
//                             URL can be recycled for next cycle's posting
export const STATUS_RETRY_DAYS = {
  manual_review: 14,
  skipped_unknown_required: 21,
  skipped_no_sponsorship: 30,
  skipped_low_compatibility: 30,
  skipped_closed: 45,
  skipped_wrong_term: 90,
};

// A status we don't recognise blocks for this long rather than forever.
export const DEFAULT_RETRY_DAYS = parseInt(process.env.DEFAULT_RETRY_DAYS || '30', 10);

// A posting outlives our record of it: URLs 404 once a role is filled, and the
// dashboard is then the only surviving account of what we read and decided on.
// So the ledger keeps a short excerpt of the description — bounded, because the
// ledger is committed to git after every run and some careers pages inline their
// entire site into the page text.
export const LEDGER_EXCERPT_CHARS = parseInt(process.env.LEDGER_EXCERPT_CHARS || '600', 10);

// A posting can be examined several times as its verdict expires and it comes
// back around. Keep the most recent verdicts so the dashboard can show why a job
// moved from `manual_review` to `applied`, without growing without bound.
export const LEDGER_HISTORY_LIMIT = parseInt(process.env.LEDGER_HISTORY_LIMIT || '10', 10);

export function coverLetterText() {
  try {
    return fs.readFileSync(COVER_LETTER_TXT_PATH, 'utf8').trim();
  } catch {
    return '';
  }
}

// A real résumé PDF is tens of kilobytes. A truncated, empty, or placeholder file
// is not, and `fs.existsSync` cannot tell the difference — which is the whole
// problem, because whatever sits at these paths is uploaded to real employers and
// the submission is irreversible. Cheap structural checks catch the realistic
// failures: an empty file, a stub committed during setup, a Git LFS pointer, a
// truncated download.
const PDF_HEADER = '%PDF-';
export const MIN_RESUME_BYTES = parseInt(process.env.MIN_RESUME_BYTES || '4096', 10);

/** Returns a human-readable reason the buffer isn't a usable PDF, or null if it is. */
export function pdfProblem(buf, minBytes = MIN_RESUME_BYTES) {
  if (!buf || buf.length === 0) return 'the file is empty';
  const head = Buffer.from(buf.subarray(0, 5)).toString('latin1');
  if (head !== PDF_HEADER) return `it is not a PDF (expected a ${PDF_HEADER} header, found ${JSON.stringify(head)})`;
  if (buf.length < minBytes) {
    return `it is only ${buf.length} bytes, which is too small to be a real document — this looks like a placeholder`;
  }
  return null;
}

function documentProblem(label, filePath, { required }) {
  if (!fs.existsSync(filePath)) {
    return required ? `${label} not found at ${filePath}` : null;
  }
  let problem;
  try {
    problem = pdfProblem(fs.readFileSync(filePath));
  } catch (err) {
    return `${label} at ${filePath} could not be read: ${err.message}`;
  }
  return problem ? `${label} at ${filePath} cannot be used: ${problem}` : null;
}

/**
 * Splits problems by severity. `fatal` means we must not run: anything that would
 * make us submit a broken application. Callers abort on fatal rather than
 * pattern-matching the message text.
 */
export function validateConfig() {
  const fatal = [];
  const warnings = [];

  if (!APPLICANT.name) fatal.push('APPLICANT_NAME is not set');
  if (!APPLICANT.email) fatal.push('APPLICANT_EMAIL is not set');
  if (!APPLICANT.phone) fatal.push('APPLICANT_PHONE is not set');

  // The base résumé is the fallback for every posting we can't route, so a bad
  // one poisons the whole run — and each application is recorded as applied, so
  // it is never retried.
  const resume = documentProblem('résumé', resumePath(DEFAULT_RESUME_VARIANT), { required: true });
  if (resume) fatal.push(resume);

  // Role-specific résumés are optional. Missing is a warning (we fall back to
  // base); present-but-broken is fatal, because that file *will* be uploaded to
  // an employer the moment a matching posting comes through.
  for (const variant of RESUME_VARIANTS) {
    if (variant === DEFAULT_RESUME_VARIANT) continue;
    const file = resumePath(variant);
    if (!fs.existsSync(file)) {
      warnings.push(`no ${variant} résumé at ${file} — ${variant} postings will get the ${DEFAULT_RESUME_VARIANT} résumé`);
      continue;
    }
    const problem = documentProblem(`${variant} résumé`, file, { required: false });
    if (problem) fatal.push(problem);
  }

  // Only fatal when present-but-broken: the cover letter is optional, but if a file
  // exists at that path the form filler will attach it.
  const cover = documentProblem('cover letter PDF', COVER_LETTER_PDF_PATH, { required: false });
  if (cover) fatal.push(cover);

  if (!SLACK_WEBHOOK_URL) warnings.push('SLACK_WEBHOOK_URL is not set (notifications disabled)');
  if (CANDIDATE.unknownSkills.length) {
    warnings.push(`profile.json lists skills absent from SKILL_LEXICON, ignored: ${CANDIDATE.unknownSkills.join(', ')}`);
  }
  if (!CANDIDATE.skills.length) {
    warnings.push('profile.json declares no known skills — compatibility scores will be uninformative');
  }
  return { fatal, warnings };
}
