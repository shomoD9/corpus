import {
  createEmptyCvData,
  createFieldVisibilityDefaults,
  createFieldVisibilityOverrides,
  deepClone,
  makeId,
  sanitizeCvData,
  sanitizeState
} from '../common/schema.js';
import { mergeFieldVisibility } from '../common/visibility.js';
import { getAccessToken, signOut } from '../drive/auth.js';
import { DriveClient } from '../drive/client.js';
import { DriveRepository } from '../drive/repository.js';

const KNOWN_ERROR_CODES = new Set([
  'AUTH_REQUIRED',
  'TOKEN_EXPIRED',
  'DRIVE_API_ERROR',
  'STATE_CONFLICT',
  'VALIDATION_ERROR',
  'NOT_FOUND'
]);

export function createCommandRouter({ auth, repo, nowIso = () => new Date().toISOString() }) {
  let cachedState = null;

  async function ensureAuth(interactive = false) {
    try {
      await auth.getAccessToken({ interactive });
    } catch (error) {
      throw withCode('AUTH_REQUIRED', error?.message || 'Google sign-in is required.');
    }
  }

  async function getState() {
    if (!cachedState) {
      cachedState = sanitizeState(await repo.loadState(), nowIso);
    }

    return cachedState;
  }

  async function persistState(nextState, expectedUpdatedAt) {
    const saved = sanitizeState(
      await repo.saveState(nextState, expectedUpdatedAt || nextState.updatedAt),
      nowIso
    );
    cachedState = saved;
    return saved;
  }

  return async function route(message = {}) {
    const command = message.command;
    const payload = message.payload || {};

    try {
      switch (command) {
        case 'AUTH_STATUS': {
          try {
            await ensureAuth(false);
            const state = await getState();
            return ok({
              authenticated: true,
              driveConnected: Boolean(
                state?.settings?.driveRootFolderId && state?.settings?.driveCvsFolderId
              ),
              state
            });
          } catch (error) {
            if (error?.code === 'AUTH_REQUIRED') {
              return ok({ authenticated: false, driveConnected: false });
            }
            throw error;
          }
        }
        case 'AUTH_SIGN_IN': {
          await ensureAuth(true);
          let state = sanitizeState(await repo.loadState(), nowIso);

          if (typeof repo.bootstrapDriveBackend === 'function') {
            state = sanitizeState(await repo.bootstrapDriveBackend(state), nowIso);
            state = await persistState(state, state.updatedAt);
          } else {
            cachedState = state;
          }

          return ok({ authenticated: true, driveConnected: true, state });
        }
        case 'AUTH_SIGN_OUT': {
          await auth.signOut();
          cachedState = null;
          return ok({ signedOut: true });
        }
        case 'STATE_LOAD':
        case 'POPUP_REFRESH': {
          await ensureAuth(false);
          const state = await getState();
          return ok({ state });
        }
        case 'STATE_SAVE': {
          await ensureAuth(false);
          if (!payload.state) {
            throw withCode('VALIDATION_ERROR', 'Missing state payload.');
          }
          const state = await persistState(payload.state, payload.expectedUpdatedAt);
          return ok({ state });
        }
        case 'CV_CREATE_TYPE': {
          await ensureAuth(false);
          const state = await getState();
          const cvType = createCvTypeFromPayload(payload, state.cvTypes);
          state.cvTypes.push(cvType);
          const saved = await persistState(state, state.updatedAt);
          return ok({ state: saved, cvType });
        }
        case 'CV_UPDATE_TYPE': {
          await ensureAuth(false);
          const state = await getState();
          const index = state.cvTypes.findIndex((type) => type.id === payload.cvTypeId);

          if (index < 0) {
            throw withCode('NOT_FOUND', 'CV Type not found.');
          }

          if (payload.updatedType) {
            state.cvTypes[index] = payload.updatedType;
          } else {
            const current = state.cvTypes[index];

            if (typeof payload.name === 'string') {
              const nextName = payload.name.trim();
              if (!nextName) {
                throw withCode('VALIDATION_ERROR', 'CV Type name cannot be empty.');
              }
              current.name = nextName;
            }

            if (payload.data) {
              current.data = sanitizeCvData(payload.data);
            }
          }

          const saved = await persistState(state, state.updatedAt);
          return ok({ state: saved, cvType: state.cvTypes[index] });
        }
        case 'CV_DELETE_TYPE': {
          await ensureAuth(false);
          const state = await getState();
          const before = state.cvTypes.length;
          state.cvTypes = state.cvTypes.filter((type) => type.id !== payload.cvTypeId);

          if (state.cvTypes.length === before) {
            throw withCode('NOT_FOUND', 'CV Type not found.');
          }

          const saved = await persistState(state, state.updatedAt);
          return ok({ state: saved });
        }
        case 'CV_CREATE_VERSION': {
          await ensureAuth(false);
          const state = await getState();
          const cvType = findCvType(state, payload.cvTypeId);

          const version = {
            id: makeId('ver'),
            label: `v${cvType.versions.length + 1}`,
            createdAt: nowIso(),
            snapshot: deepClone(cvType.data),
            fieldVisibilityOverrides: createFieldVisibilityOverrides()
          };

          cvType.versions.push(version);

          if (!cvType.defaultVersionId) {
            cvType.defaultVersionId = version.id;
          }

          const saved = await persistState(state, state.updatedAt);
          return ok({ state: saved, version });
        }
        case 'CV_SET_DEFAULT_VERSION': {
          await ensureAuth(false);
          const state = await getState();
          const cvType = findCvType(state, payload.cvTypeId);
          const version = cvType.versions.find((item) => item.id === payload.versionId);

          if (!version) {
            throw withCode('NOT_FOUND', 'Version not found.');
          }

          cvType.defaultVersionId = version.id;
          const saved = await persistState(state, state.updatedAt);
          return ok({ state: saved, defaultVersionId: version.id });
        }
        case 'CV_SET_FIELD_DEFAULTS': {
          await ensureAuth(false);
          const state = await getState();
          const cvType = findCvType(state, payload.cvTypeId);
          cvType.fieldVisibilityDefaults = {
            ...cvType.fieldVisibilityDefaults,
            ...payload.defaults
          };

          const saved = await persistState(state, state.updatedAt);
          return ok({ state: saved, fieldVisibilityDefaults: cvType.fieldVisibilityDefaults });
        }
        case 'CV_SET_FIELD_OVERRIDES': {
          await ensureAuth(false);
          const state = await getState();
          const cvType = findCvType(state, payload.cvTypeId);
          const version = cvType.versions.find((item) => item.id === payload.versionId);

          if (!version) {
            throw withCode('NOT_FOUND', 'Version not found.');
          }

          version.fieldVisibilityOverrides = {
            ...version.fieldVisibilityOverrides,
            ...payload.overrides
          };

          const saved = await persistState(state, state.updatedAt);
          return ok({ state: saved, overrides: version.fieldVisibilityOverrides });
        }
        case 'EXPORT_VERSION_TO_DRIVE': {
          await ensureAuth(false);
          const state = await getState();
          const cvType = findCvType(state, payload.cvTypeId);
          const version = cvType.versions.find((item) => item.id === payload.versionId);

          if (!version) {
            throw withCode('NOT_FOUND', 'Version not found.');
          }

          const effectiveFieldVisibility = mergeFieldVisibility(
            cvType.fieldVisibilityDefaults,
            version.fieldVisibilityOverrides
          );

          const exportKey = `${cvType.id}:${version.id}`;
          const previousExport = state.exportsIndex[exportKey] || null;

          const nextExport = await repo.exportVersionPdf({
            cvType,
            version,
            effectiveFieldVisibility,
            previousExport
          });

          state.exportsIndex[exportKey] = nextExport;
          const saved = await persistState(state, state.updatedAt);

          return ok({ state: saved, export: nextExport, exportKey });
        }
        case 'LINKS_LIST': {
          await ensureAuth(false);
          const state = await getState();
          return ok({ links: state.linksDashboard, state });
        }
        case 'LINKS_UPSERT': {
          await ensureAuth(false);
          const state = await getState();
          const entry = payload.entry || {};

          const nextEntry = {
            id: typeof entry.id === 'string' && entry.id ? entry.id : makeId('link'),
            label: typeof entry.label === 'string' ? entry.label : '',
            url: typeof entry.url === 'string' ? entry.url : ''
          };

          const index = state.linksDashboard.findIndex((item) => item.id === nextEntry.id);
          if (index >= 0) {
            state.linksDashboard[index] = nextEntry;
          } else {
            state.linksDashboard.push(nextEntry);
          }

          const saved = await persistState(state, state.updatedAt);
          return ok({ state: saved, entry: nextEntry });
        }
        case 'LINKS_DELETE': {
          await ensureAuth(false);
          const state = await getState();
          state.linksDashboard = state.linksDashboard.filter((entry) => entry.id !== payload.id);
          const saved = await persistState(state, state.updatedAt);
          return ok({ state: saved });
        }
        default:
          throw withCode('VALIDATION_ERROR', `Unknown command: ${command}`);
      }
    } catch (error) {
      return errorResponse(error);
    }
  };
}

function createCvTypeFromPayload(payload, existingTypes) {
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';

  if (!name) {
    throw withCode('VALIDATION_ERROR', 'CV Type name is required.');
  }

  if (existingTypes.some((type) => type.name.toLowerCase() === name.toLowerCase())) {
    throw withCode('VALIDATION_ERROR', 'A CV type with that name already exists.');
  }

  let data = createEmptyCvData();

  if (payload.source === 'copy') {
    const sourceType = existingTypes.find((type) => type.id === payload.copySourceId);

    if (!sourceType) {
      throw withCode('NOT_FOUND', 'Source CV type not found.');
    }

    data = deepClone(sourceType.data);
  }

  if (payload.source === 'import') {
    try {
      data = sanitizeCvData(JSON.parse(payload.importJson || '{}'));
    } catch {
      throw withCode('VALIDATION_ERROR', 'Invalid import JSON.');
    }
  }

  return {
    id: makeId('type'),
    name,
    data,
    fieldVisibilityDefaults: createFieldVisibilityDefaults(true),
    versions: [],
    defaultVersionId: null
  };
}

function findCvType(state, cvTypeId) {
  const cvType = state.cvTypes.find((type) => type.id === cvTypeId);

  if (!cvType) {
    throw withCode('NOT_FOUND', 'CV Type not found.');
  }

  return cvType;
}

function ok(data) {
  return { ok: true, data };
}

function errorResponse(error) {
  const code = KNOWN_ERROR_CODES.has(error?.code) ? error.code : 'DRIVE_API_ERROR';
  return {
    ok: false,
    error: {
      code,
      message: error?.message || 'Unexpected error.'
    }
  };
}

function withCode(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const defaultRouter = createCommandRouter({
  auth: {
    getAccessToken,
    signOut
  },
  repo: new DriveRepository({
    driveClient: new DriveClient()
  })
});

if (globalThis.chrome?.runtime?.onMessage) {
  globalThis.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    defaultRouter(message)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse(errorResponse(error)));

    return true;
  });
}
