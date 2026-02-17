import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCvTypeFromModal,
  makeVersionRecord,
  mergeVisibility,
  resolveActionableElement
} from '../src/core.js';

function makeMockType(overrides = {}) {
  return {
    id: 'type_existing',
    name: 'PM General',
    data: {
      personalInfo: {
        name: 'Alex PM',
        title: 'Product Manager',
        email: '',
        phone: '',
        location: '',
        linkedinUrl: '',
        githubUrl: '',
        website: ''
      },
      workExperience: [],
      education: [],
      skills: [],
      projects: [],
      links: []
    },
    visibilityDefaults: {
      personalInfo: true,
      workExperience: true,
      education: true,
      skills: true,
      projects: true,
      links: true
    },
    versions: [],
    defaultVersionId: null,
    ...overrides
  };
}

test('resolveActionableElement returns actionable element for regular element targets', () => {
  const actionable = { dataset: { action: 'submit-create-cv' } };
  const target = {
    closest(selector) {
      return selector === '[data-action]' ? actionable : null;
    }
  };

  const result = resolveActionableElement({ target });
  assert.equal(result, actionable);
});

test('resolveActionableElement supports text-node-like targets via parentElement', () => {
  const actionable = { dataset: { action: 'close-modal' } };
  const parentElement = {
    closest(selector) {
      return selector === '[data-action]' ? actionable : null;
    }
  };

  const textNodeLikeTarget = { parentElement };

  const result = resolveActionableElement({ target: textNodeLikeTarget });
  assert.equal(result, actionable);
});

test('buildCvTypeFromModal creates blank CV type', () => {
  const existingTypes = [makeMockType()];
  const result = buildCvTypeFromModal({
    modal: {
      source: 'blank',
      name: 'Startup PM',
      copySourceId: '',
      importJson: ''
    },
    existingTypes,
    makeId: () => 'type_new'
  });

  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.equal(result.cvType.name, 'Startup PM');
  assert.equal(result.cvType.id, 'type_new');
  assert.deepEqual(result.cvType.data.skills, []);
  assert.equal(result.cvType.versions.length, 0);
});

test('buildCvTypeFromModal rejects duplicate names case-insensitively', () => {
  const existingTypes = [makeMockType({ name: 'PM General' })];

  const result = buildCvTypeFromModal({
    modal: {
      source: 'blank',
      name: 'pm general',
      copySourceId: '',
      importJson: ''
    },
    existingTypes,
    makeId: () => 'type_new'
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /already exists/i);
});

test('buildCvTypeFromModal rejects invalid import json', () => {
  const result = buildCvTypeFromModal({
    modal: {
      source: 'import',
      name: 'Imported PM',
      copySourceId: '',
      importJson: '{not-json'
    },
    existingTypes: [],
    makeId: () => 'type_new'
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /json import failed/i);
});

test('buildCvTypeFromModal copies existing type data deeply', () => {
  const sourceType = makeMockType();
  const existingTypes = [sourceType];

  const result = buildCvTypeFromModal({
    modal: {
      source: 'copy',
      name: 'Copy PM',
      copySourceId: 'type_existing',
      importJson: ''
    },
    existingTypes,
    makeId: () => 'type_copy'
  });

  assert.equal(result.ok, true);
  assert.equal(result.cvType.data.personalInfo.name, 'Alex PM');
  assert.notEqual(result.cvType.data, sourceType.data);
});

test('makeVersionRecord increments label based on version count', () => {
  const version = makeVersionRecord({
    existingVersions: [{ id: 'v1', label: 'v1' }],
    data: { skills: ['roadmapping'] },
    makeId: () => 'ver_2',
    nowIso: () => '2026-02-16T21:00:00.000Z'
  });

  assert.equal(version.id, 'ver_2');
  assert.equal(version.label, 'v2');
  assert.equal(version.createdAt, '2026-02-16T21:00:00.000Z');
  assert.equal(version.snapshot.skills[0], 'roadmapping');
});

test('mergeVisibility applies overrides on top of defaults', () => {
  const visibility = mergeVisibility({
    defaults: {
      personalInfo: true,
      workExperience: true,
      education: true,
      skills: true,
      projects: false,
      links: true
    },
    overrides: {
      personalInfo: null,
      workExperience: false,
      education: null,
      skills: true,
      projects: null,
      links: false
    }
  });

  assert.equal(visibility.personalInfo, true);
  assert.equal(visibility.workExperience, false);
  assert.equal(visibility.skills, true);
  assert.equal(visibility.projects, false);
  assert.equal(visibility.links, false);
});
