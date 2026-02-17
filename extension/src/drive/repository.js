import { buildPdfBytesFromVersion } from '../common/pdf.js';
import { migrateStateToV2 } from '../common/migration.js';
import { sanitizeState, STATE_FILE_NAME } from '../common/schema.js';

const ROOT_FOLDER_NAME = 'Corpus';
const CVS_FOLDER_NAME = 'CVs';

export class DriveRepository {
  constructor({ driveClient, nowIso = () => new Date().toISOString() } = {}) {
    this.driveClient = driveClient;
    this.nowIso = nowIso;
    this.stateFileId = '';
    this.lastKnownUpdatedAt = '';
  }

  async loadState() {
    const existing = await this.driveClient.findFileInAppData(STATE_FILE_NAME);

    if (!existing) {
      const initial = sanitizeState(
        {
          schemaVersion: 2,
          updatedAt: this.nowIso(),
          cvTypes: [],
          linksDashboard: [],
          settings: {
            driveRootFolderId: '',
            driveCvsFolderId: ''
          },
          exportsIndex: {}
        },
        this.nowIso
      );

      const created = await this.driveClient.createJsonFileInAppData(
        STATE_FILE_NAME,
        JSON.stringify(initial)
      );

      this.stateFileId = created.id;
      this.lastKnownUpdatedAt = initial.updatedAt;
      return initial;
    }

    this.stateFileId = existing.id;
    const raw = await this.driveClient.downloadJsonFile(existing.id);

    let parsed = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = {};
    }

    const migrated = migrateStateToV2(parsed, this.nowIso);
    this.lastKnownUpdatedAt = migrated.updatedAt;

    if (migrated.schemaVersion !== parsed?.schemaVersion) {
      await this.driveClient.updateJsonFile(existing.id, JSON.stringify(migrated));
    }

    return migrated;
  }

  async saveState(nextState, expectedUpdatedAt = '') {
    if (!this.stateFileId) {
      await this.loadState();
    }

    if (expectedUpdatedAt && this.lastKnownUpdatedAt && expectedUpdatedAt !== this.lastKnownUpdatedAt) {
      const error = new Error('State conflict. Reload and retry.');
      error.code = 'STATE_CONFLICT';
      throw error;
    }

    const normalized = sanitizeState(nextState, this.nowIso);
    normalized.updatedAt = this.nowIso();

    await this.driveClient.updateJsonFile(this.stateFileId, JSON.stringify(normalized));
    this.lastKnownUpdatedAt = normalized.updatedAt;

    return normalized;
  }

  async bootstrapDriveBackend(currentState) {
    const state = sanitizeState(currentState || (await this.loadState()), this.nowIso);
    const rootFolderId = await this.ensureFolderPath([ROOT_FOLDER_NAME]);
    const cvsFolderId = await this.ensureFolderPath([ROOT_FOLDER_NAME, CVS_FOLDER_NAME]);

    state.settings.driveRootFolderId = rootFolderId;
    state.settings.driveCvsFolderId = cvsFolderId;

    return state;
  }

  async exportVersionPdf({ cvType, version, effectiveFieldVisibility, previousExport }) {
    const folderId = await this.ensureFolderPath([
      ROOT_FOLDER_NAME,
      CVS_FOLDER_NAME,
      sanitizeNameForPath(cvType.name)
    ]);

    const fileName = `${cvType.name} - ${version.label}.pdf`;
    const pdfBytes = buildPdfBytesFromVersion({
      cvType,
      version,
      effectiveFieldVisibility
    });

    let uploadResult;

    if (previousExport?.driveFileId) {
      uploadResult = await this.driveClient.updatePdfFile(
        previousExport.driveFileId,
        fileName,
        folderId,
        pdfBytes
      );
    } else {
      uploadResult = await this.driveClient.createPdfFile(fileName, folderId, pdfBytes);
    }

    const driveFileId = uploadResult.id || previousExport?.driveFileId || '';
    const webViewLink =
      uploadResult.webViewLink ||
      previousExport?.webViewLink ||
      (driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : '');

    if (driveFileId) {
      await this.driveClient.ensureAnyoneReader(driveFileId);
    }

    return {
      driveFileId,
      webViewLink,
      folderId,
      fileName,
      updatedAt: this.nowIso()
    };
  }

  async ensureFolderPath(pathParts) {
    let parentId = null;

    for (const segment of pathParts) {
      const existing = await this.driveClient.findFolderByName(segment, parentId);
      const folder = existing || (await this.driveClient.createFolder(segment, parentId));
      parentId = folder.id;
    }

    return parentId;
  }
}

function sanitizeNameForPath(value) {
  const cleaned = String(value || '').trim().replace(/[\\/:*?"<>|]/g, '-');
  return cleaned || 'Untitled CV';
}
