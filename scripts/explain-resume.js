#!/usr/bin/env node
// Shows which résumé a posting would get, and why, without applying to anything.
//
//   node scripts/explain-resume.js "Software Engineer Intern" --company Ubisoft \
//     --description "Build gameplay systems in Unity."
//
//   node scripts/explain-resume.js --samples     # a matrix of representative postings
//
// Routing decisions land in applied_jobs.json and cannot be taken back, so it
// should be possible to inspect one before an employer sees it.

import { chooseResume } from '../src/resume.js';
import { RESUME_VARIANTS } from '../src/config.js';

const SAMPLES = [
  ['Software Engineer Intern', '', ''],
  ['Software Engineer Intern', 'Ubisoft', 'Build gameplay systems in Unity; profile the rendering pipeline.'],
  ['Software Engineer Intern', 'Ubisoft', 'Automate Salesforce workflows and build internal reporting tools.'],
  ['Software Engineer Intern', 'Stripe', 'Distributed systems, Postgres, Kafka, Kubernetes. Latency matters.'],
  ['Software Engineer Intern', 'Figma', 'Accessible React components, TypeScript, design system, CSS.'],
  ['Software Engineer Intern', 'Anthropic', 'LLM inference and model serving with PyTorch.'],
  ['Backend Engineer Intern', 'Shopify', 'Our frontend team uses React, but you will write Ruby services.'],
  ['Gameplay Programmer Intern', 'EA', ''],
  ['Game AI Programmer Intern', 'WB Games', ''],
  ['Data Engineer Intern', 'Databricks', 'Airflow, Spark, ETL pipelines.'],
  ['Platform Engineering Intern', 'Datadog', 'Terraform, Kubernetes, observability.'],
  ['iOS Engineer Intern', 'Robinhood', 'Swift and UIKit.'],
];

function flag(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DECIDED_BY = {
  evidence: 'the posting decided it',
  title: "the title decided it; the body was ambiguous",
  default: 'nothing in the posting decided it',
};

function explain(title, company, description) {
  const pick = chooseResume({ title, company, description });
  const table = RESUME_VARIANTS.map((v) => `${v}=${pick.scores[v]}`).join('  ');

  console.log(`\n${title}${company ? `  ·  ${company}` : ''}`);
  console.log(`  → ${pick.variant.toUpperCase()}   (${DECIDED_BY[pick.decidedBy]})`);
  console.log(`  scores:  ${table}   margin=${pick.margin}`);
  console.log(`  because: ${pick.matched.length ? pick.matched.join(', ') : 'no role-specific signal'}`);
  if (pick.runnerUp && !pick.confident) {
    console.log(`  near miss: ${pick.runnerUp.variant} scored ${pick.runnerUp.score}`);
  }
}

const args = process.argv.slice(2);
if (args.includes('--samples') || args.length === 0) {
  console.log('Résumé routing over representative postings:');
  for (const [title, company, description] of SAMPLES) explain(title, company, description);
  console.log('\nPass a title to route one posting. See --help in the source header.\n');
} else {
  explain(args[0], flag('company'), flag('description'));
}
