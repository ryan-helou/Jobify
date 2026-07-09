import test from 'node:test';
import assert from 'node:assert/strict';

import { chooseResume, resolveResume } from '../src/resume.js';
import { roleFamily } from '../src/score.js';

const job = (title, description = '') => ({ title, description });

test('an explicit title routes on the title alone', () => {
  assert.equal(chooseResume(job('Backend Engineer Intern')).variant, 'backend');
  assert.equal(chooseResume(job('Frontend Developer Intern')).variant, 'frontend');
  assert.equal(chooseResume(job('Machine Learning Engineer Intern')).variant, 'ai');
  assert.equal(chooseResume(job('Gameplay Programmer Intern')).variant, 'game');
  assert.equal(chooseResume(job('Full Stack Software Engineer Intern')).variant, 'base');
});

test('a generic title with no body gets the base résumé', () => {
  const pick = chooseResume(job('Software Engineer Intern'));
  assert.equal(pick.variant, 'base');
  assert.equal(pick.family, 'swe');
  assert.match(pick.reason, /no role-specific signal/);
});

test('a generic title is decided by the body', () => {
  // The common case: half the market posts "Software Engineer Intern" and lets
  // the description say what the job actually is.
  const backend = chooseResume(
    job('Software Engineer Intern', 'You will design microservices, own Postgres schemas, and deploy on Kubernetes.')
  );
  assert.equal(backend.variant, 'backend');

  const frontend = chooseResume(
    job('Software Engineer Intern', 'Build accessible React components with Tailwind CSS in our design system.')
  );
  assert.equal(frontend.variant, 'frontend');

  const ai = chooseResume(
    job('Software Engineer Intern', 'Work on LLM inference, prompt engineering, and model serving with PyTorch.')
  );
  assert.equal(ai.variant, 'ai');

  const game = chooseResume(
    job('Software Engineer Intern', 'Write gameplay systems in Unity, tune shaders and the rendering pipeline.')
  );
  assert.equal(game.variant, 'game');
});

test('a weak body signal does not override an explicit title', () => {
  // "We use Docker" is background, not the job. One backend signal (weight 2)
  // cannot beat the title family's 3.
  const pick = chooseResume(job('Frontend Engineer Intern', 'Our services run in Docker.'));
  assert.equal(pick.variant, 'frontend');
});

test('a strong body signal does override a generic title, and margin records how strongly', () => {
  const pick = chooseResume(
    job('Software Engineer Intern', 'Distributed systems, Kafka, Postgres, Kubernetes, gRPC, low latency.')
  );
  assert.equal(pick.variant, 'backend');
  assert.ok(pick.confident, 'expected a confident pick');
  assert.ok(pick.margin >= 2, `expected margin >= 2, got ${pick.margin}`);
});

test('game beats ml and fullstack when the title says both', () => {
  // \bai\b would otherwise resolve "Game AI Programmer" to ml, and "Full Stack
  // Game Developer" to fullstack. Both want the games résumé.
  assert.equal(roleFamily('Game AI Programmer Intern'), 'game');
  assert.equal(chooseResume(job('Game AI Programmer Intern')).variant, 'game');
  assert.equal(chooseResume(job('Full Stack Game Developer Intern')).variant, 'game');
});

test('a repeated term counts once, so keyword stuffing cannot swing the pick', () => {
  const once = chooseResume(job('Software Engineer Intern', 'We use React.'));
  const many = chooseResume(job('Software Engineer Intern', 'React React React React React React React.'));
  assert.equal(once.scores.frontend, many.scores.frontend);
});

test('a term in both title and body is counted once, at the title rate', () => {
  // "React Engineer" is not a title the role-family regexes recognize, so there
  // is no family bonus here — only the React signal, scored once at the title
  // rate (2 × 2 = 4) rather than title + body (6).
  const pick = chooseResume(job('React Engineer Intern', 'You will write React all day.'));
  assert.equal(pick.scores.frontend, 4);
  assert.equal(pick.variant, 'frontend');
});

test('the default family scores nothing, so a described posting is not trapped on base', () => {
  // A regression guard: awarding the `swe` family the base résumé's family
  // weight gave base a head start the body could not overcome.
  const generic = chooseResume(job('Software Engineer Intern'));
  assert.equal(generic.scores.base, 0);
  assert.equal(generic.variant, 'base');
});

test('infra routes to the backend résumé and mobile to the frontend one', () => {
  assert.equal(chooseResume(job('Platform Engineering Intern')).variant, 'backend');
  assert.equal(chooseResume(job('iOS Engineer Intern')).variant, 'frontend');
});

test('the choice is deterministic across calls', () => {
  const j = job('Software Engineer Intern', 'React and Postgres and Docker and CSS.');
  const a = chooseResume(j);
  const b = chooseResume(j);
  assert.deepEqual(a.scores, b.scores);
  assert.equal(a.variant, b.variant);
});

test('missing input never throws', () => {
  assert.equal(chooseResume().variant, 'base');
  assert.equal(chooseResume({}).variant, 'base');
  assert.equal(chooseResume({ title: null, description: undefined }).variant, 'base');
});

test('a company hint alone cannot pick a résumé', () => {
  // Ubisoft hires backend, tools, and IT engineers. The internship on this very
  // résumé was Salesforce automation. A studio name is a nudge, not a verdict.
  const pick = chooseResume({ title: 'Software Engineer Intern', company: 'Ubisoft', description: '' });
  assert.equal(pick.scores.game, 1);
  assert.equal(pick.variant, 'base');
});

test('a company hint tips a posting that already leans', () => {
  const desc = 'You will work on collision detection for our simulation.';
  const without = chooseResume({ title: 'Software Engineer Intern', description: desc });
  const withHint = chooseResume({ title: 'Software Engineer Intern', company: 'Ubisoft', description: desc });

  assert.equal(without.variant, 'base', 'one weak signal should not clear the margin on its own');
  assert.equal(withHint.variant, 'game');
  assert.equal(withHint.scores.game, without.scores.game + 1);
});

test('a games studio posting an internal-tools role does not get the games résumé', () => {
  const pick = chooseResume({
    title: 'Software Engineer Intern',
    company: 'Ubisoft',
    description: 'Automate Salesforce workflows and build internal reporting tools.',
  });
  assert.notEqual(pick.variant, 'game');
});

test('an AI lab hint behaves the same way', () => {
  assert.equal(chooseResume({ title: 'Software Engineer Intern', company: 'Anthropic' }).variant, 'base');
  assert.equal(
    chooseResume({ title: 'Software Engineer Intern', company: 'Anthropic', description: 'Work on model inference.' })
      .variant,
    'ai'
  );
});

test('a company hint never fires on the description or title, only the company', () => {
  // "We partner with Ubisoft" in a body should not drag a backend role to games.
  const pick = chooseResume({
    title: 'Backend Engineer Intern',
    company: 'Acme Corp',
    description: 'We partner with Ubisoft and Epic Games on distributed backends.',
  });
  assert.equal(pick.scores.game, 0);
  assert.equal(pick.variant, 'backend');
});

test('an enormous description is truncated rather than scanned whole', () => {
  // A careers page that inlines its entire site should not cost seconds of regex.
  const padding = 'lorem ipsum '.repeat(50000); // ~600k chars
  const pick = chooseResume({ title: 'Software Engineer Intern', description: `${padding} kubernetes postgres` });
  // The backend terms sit past the cutoff, so they are never seen.
  assert.equal(pick.scores.backend, 0);
  assert.equal(pick.variant, 'base');
});

test('a lone body keyword cannot decide a résumé', () => {
  // The bug this guards: "familiarity with HTML/CSS a plus" on a Go backend role
  // scored frontend=2, cleared the margin, and attached the frontend résumé.
  const pick = chooseResume(job('Software Engineer Intern', 'You will write Go services. Familiarity with HTML/CSS a plus.'));
  assert.equal(pick.scores.frontend, 2);
  assert.equal(pick.variant, 'base');
  assert.equal(pick.confident, false);

  const docker = chooseResume(job('Software Engineer Intern', 'Some Docker experience is nice to have.'));
  assert.equal(docker.variant, 'base');
});

test('two independent body signals do decide it', () => {
  const pick = chooseResume(job('Software Engineer Intern', 'Build React components and own our CSS design system.'));
  assert.equal(pick.variant, 'frontend');
  assert.ok(pick.matched.length >= 2, 'expected corroborating evidence');
});

test('a title hit is exempt from the corroboration bar', () => {
  // A terse posting that names the role once, in the title, is not punished.
  const pick = chooseResume(job('React Engineer Intern'));
  assert.equal(pick.variant, 'frontend');
  assert.equal(pick.confident, true);
  assert.equal(pick.matched.length, 1);
});

test('a company hint corroborates a single body signal', () => {
  // One signal + a studio name is two independent pieces of evidence.
  const pick = chooseResume({
    title: 'Software Engineer Intern',
    company: 'Ubisoft',
    description: 'You will work on collision detection.',
  });
  assert.equal(pick.variant, 'game');
  assert.equal(pick.confident, true);
});

test('decidedBy separates "the body decided" from "the title decided"', () => {
  assert.equal(chooseResume(job('Software Engineer Intern', 'Kubernetes, Postgres, Kafka.')).decidedBy, 'evidence');
  assert.equal(chooseResume(job('Backend Engineer Intern', 'Our frontend uses React.')).decidedBy, 'title');
  assert.equal(chooseResume(job('Software Engineer Intern')).decidedBy, 'default');
});

test('a near miss is recorded in the reason, not silently dropped', () => {
  const pick = chooseResume(job('Backend Engineer Intern', 'Our frontend team uses React.'));
  assert.equal(pick.variant, 'backend');
  assert.equal(pick.runnerUp.variant, 'frontend');
  assert.match(pick.reason, /body leaned frontend/);
});

test('a confident pick does not carry a near-miss note', () => {
  const pick = chooseResume(job('Software Engineer Intern', 'Distributed systems, Kafka, Kubernetes, Postgres.'));
  assert.ok(pick.confident);
  assert.doesNotMatch(pick.reason, /body leaned/);
});

test('resolveResume falls back to base when the chosen variant is not on disk', () => {
  const j = job('Backend Engineer Intern');
  assert.equal(chooseResume(j).variant, 'backend');

  const resolved = resolveResume(j, { exists: (p) => p.endsWith('resume-base.pdf') });
  assert.equal(resolved.variant, 'base');
  assert.equal(resolved.fellBack, true);
  assert.match(resolved.reason, /no backend résumé on disk/);
});

test('resolveResume keeps the chosen variant when the file exists', () => {
  const resolved = resolveResume(job('Backend Engineer Intern'), { exists: () => true });
  assert.equal(resolved.variant, 'backend');
  assert.equal(resolved.fellBack, false);
  assert.match(resolved.path, /resume-backend\.pdf$/);
});
