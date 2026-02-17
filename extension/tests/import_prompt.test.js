import test from 'node:test';
import assert from 'node:assert/strict';

import { IMPORT_PROMPT, IMPORT_FLOW_STEPS } from '../src/ui/import_prompt.js';

test('IMPORT_PROMPT is file-first and keeps the expected Corpus schema', () => {
  assert.match(IMPORT_PROMPT, /(upload|attach).*(cv|resume).*(pdf|docx|word)/i);
  assert.match(IMPORT_PROMPT, /"personalInfo"/);
  assert.match(IMPORT_PROMPT, /"workExperience"/);
  assert.match(IMPORT_PROMPT, /"education"/);
  assert.match(IMPORT_PROMPT, /"skills"/);
  assert.match(IMPORT_PROMPT, /"projects"/);
  assert.match(IMPORT_PROMPT, /"links"/);
  assert.match(IMPORT_PROMPT, /Return JSON only/i);
  assert.doesNotMatch(IMPORT_PROMPT, /\[PASTE CV TEXT HERE\]/i);
});

test('IMPORT_FLOW_STEPS stays user-facing and avoids technical jargon', () => {
  assert.equal(Array.isArray(IMPORT_FLOW_STEPS), true);
  assert.ok(IMPORT_FLOW_STEPS.length >= 3);

  for (const step of IMPORT_FLOW_STEPS) {
    assert.doesNotMatch(step, /json array|comma-separated|one url per line/i);
  }
});
