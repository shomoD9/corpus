import test from 'node:test';
import assert from 'node:assert/strict';

import { createEmptyCvData, FIELD_KEYS } from '../src/common/schema.js';
import {
  mergeFieldVisibility,
  filterCvDataByVisibility,
  sectionHasVisibleFields
} from '../src/common/visibility.js';

test('FIELD_KEYS includes all expected keys', () => {
  assert.equal(FIELD_KEYS.length, 24);
  assert.equal(FIELD_KEYS.includes('personalInfo.name'), true);
  assert.equal(FIELD_KEYS.includes('projects.tags'), true);
});

test('mergeFieldVisibility applies overrides over defaults', () => {
  const defaults = Object.fromEntries(FIELD_KEYS.map((key) => [key, true]));
  const overrides = Object.fromEntries(FIELD_KEYS.map((key) => [key, null]));
  overrides['personalInfo.email'] = false;
  overrides['projects.url'] = false;

  const merged = mergeFieldVisibility(defaults, overrides);

  assert.equal(merged['personalInfo.name'], true);
  assert.equal(merged['personalInfo.email'], false);
  assert.equal(merged['projects.url'], false);
});

test('filterCvDataByVisibility removes hidden fields only', () => {
  const data = createEmptyCvData();
  data.personalInfo.name = 'Shomo';
  data.personalInfo.email = 'shomo@example.com';
  data.projects = [{
    name: 'Corpus',
    url: 'https://example.com',
    description: 'Tooling',
    tags: ['chrome']
  }];

  const visibility = Object.fromEntries(FIELD_KEYS.map((key) => [key, true]));
  visibility['personalInfo.email'] = false;
  visibility['projects.url'] = false;

  const filtered = filterCvDataByVisibility(data, visibility);

  assert.equal(filtered.personalInfo.name, 'Shomo');
  assert.equal(filtered.personalInfo.email, '');
  assert.equal(filtered.projects[0].name, 'Corpus');
  assert.equal(filtered.projects[0].url, '');
});

test('sectionHasVisibleFields returns false when all fields hidden', () => {
  const visibility = Object.fromEntries(FIELD_KEYS.map((key) => [key, false]));
  assert.equal(sectionHasVisibleFields('personalInfo', visibility), false);

  visibility['personalInfo.name'] = true;
  assert.equal(sectionHasVisibleFields('personalInfo', visibility), true);
});
