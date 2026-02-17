import test from 'node:test';
import assert from 'node:assert/strict';

import { migrateStateToV2 } from '../src/common/migration.js';

const v1State = {
  auth: {
    signedIn: true,
    name: 'Shomo',
    email: 's@example.com'
  },
  cvTypes: [
    {
      id: 'type_1',
      name: 'PM General',
      data: {
        personalInfo: {
          name: 'Shomo',
          title: 'PM',
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
        projects: false,
        links: true
      },
      versions: [
        {
          id: 'ver_1',
          label: 'v1',
          createdAt: '2026-02-16T00:00:00.000Z',
          snapshot: {
            personalInfo: {
              name: 'Shomo',
              title: 'PM',
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
          visibilityOverrides: {
            personalInfo: null,
            workExperience: null,
            education: null,
            skills: null,
            projects: true,
            links: null
          }
        }
      ],
      defaultVersionId: 'ver_1'
    }
  ],
  linksDashboard: []
};

test('migrateStateToV2 converts section visibility to field visibility', () => {
  const next = migrateStateToV2(v1State);

  assert.equal(next.schemaVersion, 2);
  assert.equal(Array.isArray(next.cvTypes), true);
  assert.equal(next.cvTypes[0].fieldVisibilityDefaults['projects.name'], false);
  assert.equal(next.cvTypes[0].fieldVisibilityDefaults['personalInfo.name'], true);
  assert.equal(next.cvTypes[0].versions[0].fieldVisibilityOverrides['projects.name'], true);
  assert.equal(next.cvTypes[0].versions[0].fieldVisibilityOverrides['links.url'], null);
});
