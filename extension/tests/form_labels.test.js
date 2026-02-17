import test from 'node:test';
import assert from 'node:assert/strict';

import { FORM_LABELS } from '../src/ui/form_labels.js';

test('FORM_LABELS are plain section names without formatting hints', () => {
  const labels = Object.values(FORM_LABELS);

  assert.deepEqual(Object.keys(FORM_LABELS), ['skills', 'links', 'workExperience', 'education', 'projects']);

  for (const label of labels) {
    assert.match(label, /^[A-Za-z ]+$/);
    assert.doesNotMatch(label, /json|array|comma|url per line/i);
  }
});
