import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeCvData } from '../src/common/schema.js';

test('sanitizeCvData normalizes markdown-formatted URLs to plain links', () => {
  const sanitized = sanitizeCvData({
    personalInfo: {
      linkedinUrl: '[https://www.linkedin.com/in/test/](https://www.linkedin.com/in/test/)',
      githubUrl: '[https://github.com/test]'
    },
    links: [
      '[https://portfolio.example.com](https://portfolio.example.com)',
      'https://plain.example.com'
    ],
    projects: [
      {
        name: 'Project',
        url: '[https://project.example.com](https://project.example.com)',
        description: 'Demo',
        tags: ['a']
      }
    ]
  });

  assert.equal(sanitized.personalInfo.linkedinUrl, 'https://www.linkedin.com/in/test/');
  assert.equal(sanitized.personalInfo.githubUrl, 'https://github.com/test');
  assert.deepEqual(sanitized.links, ['https://portfolio.example.com', 'https://plain.example.com']);
  assert.equal(sanitized.projects[0].url, 'https://project.example.com');
});

