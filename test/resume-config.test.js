import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_RESUME_VARIANT,
  DEFAULT_ROLE_FAMILY,
  RESUME_COMPANY_HINTS,
  RESUME_FAMILY_VARIANT,
  RESUME_SIGNALS,
  RESUME_VARIANTS,
  RESUME_VARIANT_FILES,
  ROLE_FAMILIES,
  resumePath,
} from '../src/config.js';

// Invariants over the routing tables. These are the mistakes that produce no
// error and no test failure — a role family quietly falling through to the base
// résumé forever, a signal keyed to a variant that no longer exists — and they
// are only visible if something asserts them.

test('every role family maps to a résumé variant', () => {
  const families = [...ROLE_FAMILIES.map(([name]) => name), DEFAULT_ROLE_FAMILY];
  for (const family of families) {
    assert.ok(
      family in RESUME_FAMILY_VARIANT,
      `role family "${family}" has no résumé mapping — it would silently fall back to ${DEFAULT_RESUME_VARIANT}`
    );
  }
});

test('every mapping target is a real variant', () => {
  for (const [family, variant] of Object.entries(RESUME_FAMILY_VARIANT)) {
    assert.ok(RESUME_VARIANTS.includes(variant), `family "${family}" maps to unknown variant "${variant}"`);
  }
});

test('every signal and hint is keyed to a real variant', () => {
  for (const variant of Object.keys(RESUME_SIGNALS)) {
    assert.ok(RESUME_VARIANTS.includes(variant), `RESUME_SIGNALS has unknown variant "${variant}"`);
  }
  for (const { variant, label } of RESUME_COMPANY_HINTS) {
    assert.ok(RESUME_VARIANTS.includes(variant), `company hint "${label}" targets unknown variant "${variant}"`);
  }
});

test('every variant has a file and a signal list', () => {
  for (const variant of RESUME_VARIANTS) {
    assert.ok(RESUME_VARIANT_FILES[variant], `variant "${variant}" has no file`);
    assert.ok(Array.isArray(RESUME_SIGNALS[variant]), `variant "${variant}" has no signal list`);
    assert.match(resumePath(variant), /assets[/\\]resume-.*\.pdf$/);
  }
});

test('the default variant exists and is the only one without signals', () => {
  assert.ok(RESUME_VARIANTS.includes(DEFAULT_RESUME_VARIANT));
  // base wins by being the fallback, not by out-scoring anything.
  assert.equal(RESUME_SIGNALS[DEFAULT_RESUME_VARIANT].length, 0);
  for (const variant of RESUME_VARIANTS) {
    if (variant === DEFAULT_RESUME_VARIANT) continue;
    assert.ok(RESUME_SIGNALS[variant].length > 0, `variant "${variant}" can never be chosen from the body`);
  }
});

test('no signal or hint matches empty text', () => {
  // A regex that matches '' would score every posting for that variant.
  const all = [...Object.values(RESUME_SIGNALS).flat(), ...RESUME_COMPANY_HINTS];
  for (const { label, re } of all) {
    assert.equal(re.test(''), false, `signal "${label}" matches the empty string`);
  }
});

test('every signal carries a positive weight and a label', () => {
  for (const [variant, signals] of Object.entries(RESUME_SIGNALS)) {
    for (const { label, weight } of signals) {
      assert.ok(label, `a ${variant} signal has no label — it would print as "undefined" in the ledger`);
      assert.ok(weight > 0, `${variant} signal "${label}" has a non-positive weight`);
    }
  }
});

test('unresolvable variants degrade to the default path rather than throwing', () => {
  assert.equal(resumePath('nonsense'), resumePath(DEFAULT_RESUME_VARIANT));
  assert.equal(resumePath(undefined), resumePath(DEFAULT_RESUME_VARIANT));
});
