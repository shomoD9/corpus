import { getAccessToken } from './auth.js';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

export class DriveClient {
  constructor({
    tokenProvider = (options = {}) => getAccessToken({ interactive: false, ...options }),
    fetchImpl = (...args) => globalThis.fetch(...args)
  } = {}) {
    this.tokenProvider = tokenProvider;
    this.fetchImpl = fetchImpl;
  }

  async findFileInAppData(name) {
    const escapedName = escapeQueryValue(name);
    const files = await this.listFiles({
      spaces: 'appDataFolder',
      q: `name='${escapedName}' and 'appDataFolder' in parents and trashed=false`,
      fields: 'files(id,name,modifiedTime)'
    });

    return files[0] || null;
  }

  async createJsonFileInAppData(name, content) {
    return this.createMultipartFile({
      metadata: {
        name,
        parents: ['appDataFolder'],
        mimeType: 'application/json'
      },
      mediaMimeType: 'application/json',
      media: new TextEncoder().encode(content)
    });
  }

  async downloadJsonFile(fileId) {
    const response = await this.requestRaw(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`, {
      method: 'GET'
    });

    return response.text();
  }

  async updateJsonFile(fileId, content) {
    return this.updateMultipartFile({
      fileId,
      metadata: {
        mimeType: 'application/json'
      },
      mediaMimeType: 'application/json',
      media: new TextEncoder().encode(content)
    });
  }

  async findFolderByName(name, parentId) {
    const escapedName = escapeQueryValue(name);
    const effectiveParent = parentId || 'root';

    const files = await this.listFiles({
      q: `mimeType='application/vnd.google-apps.folder' and name='${escapedName}' and '${effectiveParent}' in parents and trashed=false`,
      fields: 'files(id,name)'
    });

    return files[0] || null;
  }

  async createFolder(name, parentId) {
    const metadata = {
      name,
      mimeType: 'application/vnd.google-apps.folder'
    };

    if (parentId) {
      metadata.parents = [parentId];
    }

    return this.requestJson(`${DRIVE_API_BASE}/files`, {
      method: 'POST',
      body: JSON.stringify(metadata)
    });
  }

  async createPdfFile(name, parentId, bytes) {
    return this.createMultipartFile({
      metadata: {
        name,
        parents: [parentId],
        mimeType: 'application/pdf'
      },
      mediaMimeType: 'application/pdf',
      media: bytes
    });
  }

  async updatePdfFile(fileId, name, parentId, bytes) {
    return this.updateMultipartFile({
      fileId,
      metadata: {
        name,
        parents: [parentId],
        mimeType: 'application/pdf'
      },
      mediaMimeType: 'application/pdf',
      media: bytes
    });
  }

  async ensureAnyoneReader(fileId) {
    try {
      await this.requestJson(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/permissions`, {
        method: 'POST',
        body: JSON.stringify({ role: 'reader', type: 'anyone' })
      });
    } catch (error) {
      if (error.code === 'DRIVE_API_ERROR') {
        return;
      }
      throw error;
    }
  }

  async listFiles({ q, spaces = '', fields = 'files(id,name)', pageSize = 50 }) {
    const params = new URLSearchParams({
      q,
      fields,
      pageSize: String(pageSize)
    });

    if (spaces) {
      params.set('spaces', spaces);
    }

    const data = await this.requestJson(`${DRIVE_API_BASE}/files?${params.toString()}`, {
      method: 'GET'
    });

    return Array.isArray(data.files) ? data.files : [];
  }

  async createMultipartFile({ metadata, mediaMimeType, media }) {
    const { body, contentType } = buildMultipartBody(metadata, media, mediaMimeType);

    return this.requestJson(
      `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,webViewLink,parents`,
      {
        method: 'POST',
        body,
        headers: {
          'Content-Type': contentType
        }
      }
    );
  }

  async updateMultipartFile({ fileId, metadata, mediaMimeType, media }) {
    const { body, contentType } = buildMultipartBody(metadata, media, mediaMimeType);

    return this.requestJson(
      `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,name,webViewLink,parents`,
      {
        method: 'PATCH',
        body,
        headers: {
          'Content-Type': contentType
        }
      }
    );
  }

  async requestJson(url, options) {
    const response = await this.requestRaw(url, options);
    const text = await response.text();

    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }

  async requestRaw(url, options = {}, attempt = 0) {
    const token = await this.tokenProvider({
      interactive: false,
      forceRefresh: attempt > 0
    });

    if (!this.fetchImpl) {
      throw createDriveError('DRIVE_API_ERROR', 'fetch is unavailable.');
    }

    const response = await this.fetchImpl(url, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(options.body && !(options.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      },
      body: options.body
    });

    if (response.status === 401 && attempt === 0) {
      return this.requestRaw(url, options, 1);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      const errorCode = response.status === 401 ? 'TOKEN_EXPIRED' : 'DRIVE_API_ERROR';
      throw createDriveError(
        errorCode,
        `Drive request failed (${response.status}). ${errorText}`.trim()
      );
    }

    return response;
  }
}

function buildMultipartBody(metadata, media, mediaMimeType) {
  const boundary = `corpus_${Math.random().toString(36).slice(2)}`;
  const encoder = new TextEncoder();

  const metadataPart =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n`;

  const mediaHeader = `--${boundary}\r\nContent-Type: ${mediaMimeType}\r\n\r\n`;
  const close = `\r\n--${boundary}--`;

  const mediaBytes = media instanceof Uint8Array ? media : encoder.encode(String(media));

  const body = new Blob([encoder.encode(metadataPart), encoder.encode(mediaHeader), mediaBytes, encoder.encode(close)]);

  return {
    body,
    contentType: `multipart/related; boundary=${boundary}`
  };
}

function escapeQueryValue(value) {
  return String(value).replace(/'/g, "\\'");
}

function createDriveError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
