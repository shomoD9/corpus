import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createEmptyWorkExperience,
  createEmptyEducation,
  createEmptyProject,
  splitLinesToList,
  splitCsvToList,
  joinListForTextarea,
  joinListForCsv
} from '../src/ui/form_entries.js';

test('entry factories create expected clean defaults', () => {
  assert.deepEqual(createEmptyWorkExperience(), {
    company: '',
    role: '',
    startDate: '',
    endDate: '',
    present: false,
    bullets: []
  });

  assert.deepEqual(createEmptyEducation(), {
    institution: '',
    degree: '',
    fieldOfStudy: '',
    graduationYear: ''
  });

  assert.deepEqual(createEmptyProject(), {
    name: '',
    url: '',
    description: '',
    tags: []
  });
});

test('list format helpers normalize user text cleanly', () => {
  assert.deepEqual(splitLinesToList('a\n\n b \n'), ['a', 'b']);
  assert.deepEqual(splitCsvToList('alpha, beta ,, gamma '), ['alpha', 'beta', 'gamma']);
  assert.equal(joinListForTextarea(['a', 'b']), 'a\nb');
  assert.equal(joinListForCsv(['a', 'b']), 'a, b');
});
