/*
  This file migrates legacy Corpus state payloads into schema version 2.
  It exists separately so migration rules can evolve without polluting normal read/write paths.
  It talks to the schema module for sanitization and visibility-key mapping.
*/

import {
  FIELD_KEYS,
  SECTION_FIELD_MAP,
  createFieldVisibilityDefaults,
  createFieldVisibilityOverrides,
  createInitialState,
  sanitizeCvData,
  sanitizeState
} from './schema.js';

export function migrateStateToV2(candidate, nowIso = () => new Date().toISOString()) {
  if (!candidate || typeof candidate !== 'object') {
    return createInitialState(nowIso);
  }

  if (candidate.schemaVersion === 2) {
    // Once data is already on v2, we only sanitize to guard against partial corruption.
    return sanitizeState(candidate, nowIso);
  }

  const next = {
    schemaVersion: 2,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : nowIso(),
    cvTypes: [],
    linksDashboard: Array.isArray(candidate.linksDashboard) ? candidate.linksDashboard : [],
    settings: {
      driveRootFolderId: '',
      driveCvsFolderId: ''
    },
    exportsIndex: typeof candidate.driveExports === 'object' && candidate.driveExports
      ? mapLegacyDriveExports(candidate.driveExports)
      : {}
  };

  const types = Array.isArray(candidate.cvTypes) ? candidate.cvTypes : [];

  next.cvTypes = types.map((type) => migrateType(type, nowIso)).filter(Boolean);

  return sanitizeState(next, nowIso);
}

function migrateType(type, nowIso) {
  if (!type || typeof type !== 'object') {
    return null;
  }

  const sectionDefaults = isObject(type.visibilityDefaults) ? type.visibilityDefaults : {};
  const fieldDefaults = createFieldVisibilityDefaults(true);

  for (const [sectionKey, fields] of Object.entries(SECTION_FIELD_MAP)) {
    const sectionVisible = toBooleanOrDefault(sectionDefaults[sectionKey], true);
    for (const fieldKey of fields) {
      fieldDefaults[fieldKey] = sectionVisible;
    }
  }

  const versions = Array.isArray(type.versions)
    ? type.versions.map((version, index) => migrateVersion(version, index, nowIso)).filter(Boolean)
    : [];

  return {
    id: safeString(type.id),
    name: safeString(type.name) || 'Untitled CV',
    data: sanitizeCvData(type.data),
    fieldVisibilityDefaults: fieldDefaults,
    versions,
    defaultVersionId: safeString(type.defaultVersionId)
  };
}

function migrateVersion(version, index, nowIso) {
  if (!version || typeof version !== 'object') {
    return null;
  }

  const sectionOverrides = isObject(version.visibilityOverrides) ? version.visibilityOverrides : {};
  const fieldOverrides = createFieldVisibilityOverrides();

  for (const [sectionKey, fields] of Object.entries(SECTION_FIELD_MAP)) {
    const sectionOverride = sectionOverrides[sectionKey];

    for (const fieldKey of fields) {
      if (sectionOverride === true || sectionOverride === false) {
        fieldOverrides[fieldKey] = sectionOverride;
      } else {
        fieldOverrides[fieldKey] = null;
      }
    }
  }

  return {
    id: safeString(version.id),
    label: safeString(version.label) || `v${index + 1}`,
    createdAt: safeString(version.createdAt) || nowIso(),
    snapshot: sanitizeCvData(version.snapshot),
    fieldVisibilityOverrides: fieldOverrides
  };
}

function mapLegacyDriveExports(driveExports) {
  const mapped = {};

  for (const [key, value] of Object.entries(driveExports)) {
    if (!value || typeof value !== 'object') {
      continue;
    }

    const typeId = safeString(value.typeId);
    const versionId = safeString(value.versionId);

    if (!typeId || !versionId) {
      continue;
    }

    mapped[`${typeId}:${versionId}`] = {
      driveFileId: safeString(value.driveFileId),
      webViewLink: safeString(value.link),
      folderId: safeString(value.folderId),
      updatedAt: safeString(value.updatedAt)
    };
  }

  return mapped;
}

function toBooleanOrDefault(value, fallback) {
  if (value === true || value === false) {
    return value;
  }

  return fallback;
}

function safeString(value) {
  return typeof value === 'string' ? value : '';
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
