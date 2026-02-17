import test from 'node:test';
import assert from 'node:assert/strict';

import { DriveRepository } from '../src/drive/repository.js';
import { createInitialState } from '../src/common/schema.js';

function createFakeDriveClient() {
  const appDataFiles = new Map();
  const folders = new Map();
  const pdfFiles = new Map();
  const permissions = [];

  const rootFolderId = 'root_corpus';
  folders.set('root', { id: rootFolderId, name: 'Corpus', parentId: null });

  return {
    calls: {
      createJsonFileInAppData: 0,
      updateJsonFile: 0,
      createPdfFile: 0,
      updatePdfFile: 0
    },
    async findFileInAppData(name) {
      for (const [, file] of appDataFiles) {
        if (file.name === name) {
          return file;
        }
      }
      return null;
    },
    async createJsonFileInAppData(name, content) {
      const id = `app_${appDataFiles.size + 1}`;
      this.calls.createJsonFileInAppData += 1;
      appDataFiles.set(id, { id, name, content });
      return { id, name };
    },
    async downloadJsonFile(fileId) {
      return appDataFiles.get(fileId)?.content || null;
    },
    async updateJsonFile(fileId, content) {
      this.calls.updateJsonFile += 1;
      const file = appDataFiles.get(fileId);
      file.content = content;
      return { id: fileId };
    },
    async findFolderByName(name, parentId) {
      for (const [, folder] of folders) {
        if (folder.name === name && folder.parentId === parentId) {
          return folder;
        }
      }
      return null;
    },
    async createFolder(name, parentId) {
      const id = `folder_${folders.size + 1}`;
      const folder = { id, name, parentId };
      folders.set(id, folder);
      return folder;
    },
    async createPdfFile(name, parentId, bytes) {
      const id = `pdf_${pdfFiles.size + 1}`;
      this.calls.createPdfFile += 1;
      const webViewLink = `https://drive.google.com/file/d/${id}/view`;
      pdfFiles.set(id, { id, name, parentId, bytes, webViewLink });
      return { id, webViewLink };
    },
    async updatePdfFile(fileId, name, parentId, bytes) {
      this.calls.updatePdfFile += 1;
      const file = pdfFiles.get(fileId);
      file.name = name;
      file.parentId = parentId;
      file.bytes = bytes;
      return { id: fileId, webViewLink: file.webViewLink };
    },
    async ensureAnyoneReader(fileId) {
      permissions.push(fileId);
    }
  };
}

test('loadState creates appData file when missing', async () => {
  const client = createFakeDriveClient();
  const repo = new DriveRepository({ driveClient: client, nowIso: () => '2026-02-16T12:00:00.000Z' });

  const state = await repo.loadState();

  assert.equal(state.schemaVersion, 2);
  assert.equal(client.calls.createJsonFileInAppData, 1);
});

test('saveState updates existing appData file', async () => {
  const client = createFakeDriveClient();
  const repo = new DriveRepository({ driveClient: client, nowIso: () => '2026-02-16T12:00:00.000Z' });

  const state = await repo.loadState();
  state.updatedAt = '2026-02-16T12:00:00.000Z';
  state.linksDashboard.push({ id: 'lnk_1', label: 'LinkedIn', url: 'https://linkedin.com' });

  const saved = await repo.saveState(state, '2026-02-16T12:00:00.000Z');

  assert.equal(saved.linksDashboard.length, 1);
  assert.equal(client.calls.updateJsonFile, 1);
});

test('exportVersionPdf overwrites existing drive file id', async () => {
  const client = createFakeDriveClient();
  const repo = new DriveRepository({ driveClient: client, nowIso: () => '2026-02-16T12:00:00.000Z' });

  const cvType = {
    id: 'type_1',
    name: 'PM General',
    data: createInitialState().cvTypes,
    fieldVisibilityDefaults: {},
    versions: [],
    defaultVersionId: null
  };

  const version = {
    id: 'ver_1',
    label: 'v1',
    createdAt: '2026-02-16T12:00:00.000Z',
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
    }
  };

  const visibility = {
    'personalInfo.name': true,
    'personalInfo.title': true,
    'personalInfo.email': true,
    'personalInfo.phone': true,
    'personalInfo.location': true,
    'personalInfo.linkedinUrl': true,
    'personalInfo.githubUrl': true,
    'personalInfo.website': true,
    'workExperience.company': true,
    'workExperience.role': true,
    'workExperience.startDate': true,
    'workExperience.endDate': true,
    'workExperience.present': true,
    'workExperience.bullets': true,
    'education.institution': true,
    'education.degree': true,
    'education.fieldOfStudy': true,
    'education.graduationYear': true,
    'skills.items': true,
    'projects.name': true,
    'projects.url': true,
    'projects.description': true,
    'projects.tags': true,
    'links.url': true
  };

  const first = await repo.exportVersionPdf({
    cvType,
    version,
    effectiveFieldVisibility: visibility,
    previousExport: null
  });

  const second = await repo.exportVersionPdf({
    cvType,
    version,
    effectiveFieldVisibility: visibility,
    previousExport: first
  });

  assert.equal(client.calls.createPdfFile, 1);
  assert.equal(client.calls.updatePdfFile, 1);
  assert.equal(first.driveFileId, second.driveFileId);
});

test('bootstrapDriveBackend sets drive folder ids on state', async () => {
  const client = createFakeDriveClient();
  const repo = new DriveRepository({ driveClient: client, nowIso: () => '2026-02-16T12:00:00.000Z' });
  const state = await repo.loadState();

  const bootstrapped = await repo.bootstrapDriveBackend(state);

  assert.equal(Boolean(bootstrapped.settings.driveRootFolderId), true);
  assert.equal(Boolean(bootstrapped.settings.driveCvsFolderId), true);
});
