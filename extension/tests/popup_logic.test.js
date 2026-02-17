import test from 'node:test';
import assert from 'node:assert/strict';

import { sortVersionsForPopup, buildVersionActionModel } from '../src/ui/popup_logic.js';

test('sortVersionsForPopup places default version first', () => {
  const versions = [
    { id: 'v2', label: 'v2' },
    { id: 'v1', label: 'v1' },
    { id: 'v3', label: 'v3' }
  ];

  const sorted = sortVersionsForPopup(versions, 'v1');

  assert.equal(sorted[0].id, 'v1');
  assert.equal(sorted.length, 3);
});

test('buildVersionActionModel marks when export is required', () => {
  const model = buildVersionActionModel({
    cvTypeId: 'type_1',
    versionId: 'v1',
    exportsIndex: {}
  });

  assert.equal(model.hasExport, false);
  assert.equal(model.link, '');

  const modelWithExport = buildVersionActionModel({
    cvTypeId: 'type_1',
    versionId: 'v1',
    exportsIndex: {
      'type_1:v1': {
        driveFileId: 'file_1',
        webViewLink: 'https://drive.google.com/file/d/file_1/view'
      }
    }
  });

  assert.equal(modelWithExport.hasExport, true);
  assert.match(modelWithExport.link, /drive.google.com/);
});
