import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRouter } from '../src/background/service_worker.js';
import { createInitialState } from '../src/common/schema.js';

function createTestDependencies() {
  let state = createInitialState();
  let bootstrapped = 0;

  const auth = {
    signedOut: false,
    async getAccessToken() {
      return 'token_123';
    },
    async signOut() {
      this.signedOut = true;
    }
  };

  const repo = {
    async loadState() {
      return JSON.parse(JSON.stringify(state));
    },
    async bootstrapDriveBackend(currentState) {
      bootstrapped += 1;
      const next = JSON.parse(JSON.stringify(currentState));
      next.settings.driveRootFolderId = 'folder_root';
      next.settings.driveCvsFolderId = 'folder_cvs';
      return next;
    },
    async saveState(nextState) {
      state = JSON.parse(JSON.stringify(nextState));
      return JSON.parse(JSON.stringify(state));
    },
    async exportVersionPdf() {
      return {
        driveFileId: 'pdf_1',
        webViewLink: 'https://drive.google.com/file/d/pdf_1/view',
        folderId: 'folder_1',
        updatedAt: '2026-02-16T22:00:00.000Z',
        fileName: 'PM - v1.pdf'
      };
    }
  };

  return { auth, repo, getState: () => state, getBootstrapped: () => bootstrapped };
}

test('AUTH_SIGN_IN returns normalized response', async () => {
  const { auth, repo, getBootstrapped } = createTestDependencies();
  const router = createCommandRouter({ auth, repo, nowIso: () => '2026-02-16T22:00:00.000Z' });

  const response = await router({ command: 'AUTH_SIGN_IN', payload: {} });

  assert.equal(response.ok, true);
  assert.equal(response.data.authenticated, true);
  assert.equal(response.data.state.schemaVersion, 2);
  assert.equal(response.data.state.settings.driveRootFolderId, 'folder_root');
  assert.equal(getBootstrapped(), 1);
});

test('CV_CREATE_TYPE adds new type', async () => {
  const { auth, repo } = createTestDependencies();
  const router = createCommandRouter({ auth, repo, nowIso: () => '2026-02-16T22:00:00.000Z' });

  await router({ command: 'AUTH_SIGN_IN', payload: {} });
  const response = await router({
    command: 'CV_CREATE_TYPE',
    payload: {
      name: 'PM General',
      source: 'blank',
      copySourceId: '',
      importJson: ''
    }
  });

  assert.equal(response.ok, true);
  assert.equal(response.data.cvType.name, 'PM General');
  assert.equal(response.data.state.cvTypes.length, 1);
});

test('CV_SET_FIELD_OVERRIDES persists tri-state overrides', async () => {
  const { auth, repo } = createTestDependencies();
  const router = createCommandRouter({ auth, repo, nowIso: () => '2026-02-16T22:00:00.000Z' });

  await router({ command: 'AUTH_SIGN_IN', payload: {} });
  const createType = await router({
    command: 'CV_CREATE_TYPE',
    payload: {
      name: 'PM General',
      source: 'blank',
      copySourceId: '',
      importJson: ''
    }
  });

  const typeId = createType.data.cvType.id;
  const createdVersion = await router({ command: 'CV_CREATE_VERSION', payload: { cvTypeId: typeId } });
  const versionId = createdVersion.data.version.id;

  const response = await router({
    command: 'CV_SET_FIELD_OVERRIDES',
    payload: {
      cvTypeId: typeId,
      versionId,
      overrides: {
        'personalInfo.email': false,
        'projects.url': true
      }
    }
  });

  assert.equal(response.ok, true);
  const version = response.data.state.cvTypes[0].versions[0];
  assert.equal(version.fieldVisibilityOverrides['personalInfo.email'], false);
  assert.equal(version.fieldVisibilityOverrides['projects.url'], true);
});

test('repository failures are normalized', async () => {
  const { auth } = createTestDependencies();
  const repo = {
    async loadState() {
      throw Object.assign(new Error('stale'), { code: 'STATE_CONFLICT' });
    },
    async saveState() {
      throw Object.assign(new Error('stale'), { code: 'STATE_CONFLICT' });
    }
  };

  const router = createCommandRouter({ auth, repo, nowIso: () => '2026-02-16T22:00:00.000Z' });
  const response = await router({ command: 'STATE_LOAD', payload: {} });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'STATE_CONFLICT');
});

test('token expiry errors are normalized', async () => {
  const { auth } = createTestDependencies();
  const repo = {
    async loadState() {
      throw Object.assign(new Error('expired'), { code: 'TOKEN_EXPIRED' });
    },
    async saveState() {
      throw Object.assign(new Error('expired'), { code: 'TOKEN_EXPIRED' });
    }
  };

  const router = createCommandRouter({ auth, repo, nowIso: () => '2026-02-16T22:00:00.000Z' });
  const response = await router({ command: 'STATE_LOAD', payload: {} });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'TOKEN_EXPIRED');
});
