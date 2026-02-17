/*
  This file is the editor-side synchronization orchestrator for Corpus.
  It exists separately from `app.js` so the state-sync policy is isolated from rendering concerns:
  the editor can stay responsive while this module handles local draft persistence, Drive sync cadence,
  and conflict recovery behavior.
  It talks "upward" to the runtime command layer through an injected `sendCommand` function and talks
  "sideways" to browser local storage through an injected `storageArea`.
*/

export const LOCAL_DRAFTS_KEY = 'corpus_drafts_v1';
export const SYNC_META_KEY = 'corpus_sync_meta_v1';

const DEFAULT_IDLE_MS = 2000;
const DEFAULT_LOCAL_PERSIST_MS = 120;

export function createSyncController({
  sendCommand,
  storageArea = globalThis.chrome?.storage?.local || null,
  nowMs = () => Date.now(),
  idleMs = DEFAULT_IDLE_MS,
  localPersistMs = DEFAULT_LOCAL_PERSIST_MS,
  onStatus = () => {},
  onState = () => {},
  onError = () => {}
} = {}) {
  if (typeof sendCommand !== 'function') {
    throw new Error('createSyncController requires a sendCommand function.');
  }

  let drafts = {};
  let status = 'saved';
  let idleTimer = 0;
  let localPersistTimer = 0;
  let flushing = false;
  let needsTrailingFlush = false;
  let destroyed = false;

  function setStatus(nextStatus) {
    if (status === nextStatus) {
      return;
    }
    status = nextStatus;
    onStatus(status);
  }

  function hasPendingDrafts() {
    return Object.keys(drafts).length > 0;
  }

  function scheduleTypeSave(cvTypeId, data, baseRemoteUpdatedAt = '') {
    if (!cvTypeId) {
      return;
    }

    drafts[cvTypeId] = {
      cvTypeId,
      data: deepClone(data),
      localUpdatedAtMs: nowMs(),
      baseRemoteUpdatedAt: String(baseRemoteUpdatedAt || ''),
      dirty: true
    };

    // We mark the UI as pending as soon as the local draft changes.
    setStatus('pending');
    scheduleLocalPersist();
    scheduleIdleFlush();

    // If a flush is already running, we flag a trailing pass so the new data is not skipped.
    if (flushing) {
      needsTrailingFlush = true;
    }
  }

  async function restoreDrafts(remoteState) {
    drafts = await loadDraftsFromStorage(storageArea);
    drafts = pruneDraftsAgainstRemote(drafts, remoteState);

    const merged = applyDraftsToRemoteState(remoteState, drafts);

    if (hasPendingDrafts()) {
      setStatus('pending');
      scheduleIdleFlush();
    } else {
      setStatus('saved');
    }

    await persistDrafts(storageArea, drafts, status, nowMs);
    return merged;
  }

  function absorbRemoteState(remoteState) {
    drafts = pruneDraftsAgainstRemote(drafts, remoteState);

    if (!hasPendingDrafts() && !flushing) {
      setStatus('saved');
    }
  }

  function getStatus() {
    return status;
  }

  async function flush(reason = 'manual') {
    if (destroyed) {
      return { ok: false, reason: 'destroyed', status };
    }

    clearIdleTimer();
    await persistDrafts(storageArea, drafts, status, nowMs);
    await performFlush(reason);
    return { ok: getStatus() !== 'error', status: getStatus() };
  }

  function destroy() {
    destroyed = true;
    clearIdleTimer();
    clearLocalPersistTimer();
  }

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = 0;
    }
  }

  function clearLocalPersistTimer() {
    if (localPersistTimer) {
      clearTimeout(localPersistTimer);
      localPersistTimer = 0;
    }
  }

  function scheduleIdleFlush() {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      void flush('idle');
    }, idleMs);
  }

  function scheduleLocalPersist() {
    clearLocalPersistTimer();
    localPersistTimer = setTimeout(() => {
      void persistDrafts(storageArea, drafts, status, nowMs);
    }, localPersistMs);
  }

  async function performFlush(reason) {
    if (flushing) {
      needsTrailingFlush = true;
      return;
    }

    if (!hasPendingDrafts()) {
      if (status !== 'error') {
        setStatus('saved');
      }
      return;
    }

    flushing = true;
    setStatus('saving');

    try {
      do {
        needsTrailingFlush = false;
        await syncDirtyDrafts(reason);
      } while (needsTrailingFlush);

      if (hasPendingDrafts()) {
        setStatus('pending');
      } else {
        setStatus('saved');
      }
    } catch (error) {
      // We keep local drafts on error so the user never loses edits.
      setStatus('error');
      onError(error);
    } finally {
      flushing = false;
      await persistDrafts(storageArea, drafts, status, nowMs);
    }
  }

  async function syncDirtyDrafts(reason) {
    const entries = Object.values(drafts).sort((a, b) => a.localUpdatedAtMs - b.localUpdatedAtMs);

    for (const entry of entries) {
      await syncEntry(entry, reason);
    }
  }

  async function syncEntry(entry, reason) {
    let recoveredConflict = false;

    while (true) {
      try {
        const response = await sendCommand(
          'CV_UPDATE_TYPE',
          {
            cvTypeId: entry.cvTypeId,
            data: entry.data
          },
          {
            interactiveReconnect: true,
            syncReason: reason
          }
        );

        // The draft is now reflected in Drive, so we can remove it locally.
        const latestDraft = drafts[entry.cvTypeId];
        if (!latestDraft || latestDraft.localUpdatedAtMs <= entry.localUpdatedAtMs) {
          delete drafts[entry.cvTypeId];
        } else {
          // Newer local edits arrived during the network call; keep them queued.
          needsTrailingFlush = true;
        }

        if (response?.state) {
          onState(response.state, { source: 'sync', cvTypeId: entry.cvTypeId });
          absorbRemoteState(response.state);
        }

        return;
      } catch (error) {
        if (error?.code === 'STATE_CONFLICT' && !recoveredConflict) {
          recoveredConflict = true;
          const reloaded = await sendCommand('STATE_LOAD', {}, { interactiveReconnect: true });

          if (reloaded?.state) {
            onState(reloaded.state, {
              source: 'conflict-reload',
              cvTypeId: entry.cvTypeId
            });
          }

          // Retry once after pulling the latest remote state.
          continue;
        }

        throw error;
      }
    }
  }

  return {
    restoreDrafts,
    absorbRemoteState,
    scheduleTypeSave,
    hasPendingDrafts,
    getStatus,
    flush,
    destroy
  };
}

async function loadDraftsFromStorage(storageArea) {
  if (!storageArea?.get) {
    return {};
  }

  try {
    const raw = await storageGet(storageArea, LOCAL_DRAFTS_KEY);
    return normalizeDraftMap(raw?.[LOCAL_DRAFTS_KEY]);
  } catch {
    return {};
  }
}

async function persistDrafts(storageArea, draftMap, status, nowMs) {
  if (!storageArea?.set) {
    return;
  }

  const cleanDrafts = normalizeDraftMap(draftMap);

  await storageSet(storageArea, {
    [LOCAL_DRAFTS_KEY]: cleanDrafts,
    [SYNC_META_KEY]: {
      status,
      updatedAtMs: nowMs()
    }
  });
}

function normalizeDraftMap(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return {};
  }

  const output = {};

  for (const [cvTypeId, value] of Object.entries(candidate)) {
    if (!cvTypeId || !value || typeof value !== 'object') {
      continue;
    }

    if (!value.dirty) {
      continue;
    }

    output[cvTypeId] = {
      cvTypeId,
      data: deepClone(value.data),
      localUpdatedAtMs: Number(value.localUpdatedAtMs) || Date.now(),
      baseRemoteUpdatedAt: String(value.baseRemoteUpdatedAt || ''),
      dirty: true
    };
  }

  return output;
}

function pruneDraftsAgainstRemote(draftMap, remoteState) {
  if (!Array.isArray(remoteState?.cvTypes)) {
    return { ...(draftMap || {}) };
  }

  const knownTypeIds = new Set(Array.isArray(remoteState?.cvTypes) ? remoteState.cvTypes.map((type) => type.id) : []);
  const output = {};

  for (const [cvTypeId, value] of Object.entries(draftMap || {})) {
    if (!knownTypeIds.has(cvTypeId)) {
      continue;
    }
    output[cvTypeId] = value;
  }

  return output;
}

function applyDraftsToRemoteState(remoteState, draftMap) {
  if (!remoteState || typeof remoteState !== 'object') {
    return remoteState;
  }

  const merged = deepClone(remoteState);
  const types = Array.isArray(merged.cvTypes) ? merged.cvTypes : [];

  for (const cvType of types) {
    const draft = draftMap[cvType.id];
    if (!draft) {
      continue;
    }

    cvType.data = deepClone(draft.data);
  }

  return merged;
}

async function storageGet(storageArea, key) {
  // Chrome storage APIs expose both callback and promise styles across environments.
  if (storageArea.get.length <= 1) {
    try {
      const maybePromise = storageArea.get(key);
      if (isPromiseLike(maybePromise)) {
        return maybePromise;
      }
    } catch {
      // Fall through to callback style.
    }
  }

  return new Promise((resolve, reject) => {
    try {
      storageArea.get(key, (value) => {
        const lastError = globalThis.chrome?.runtime?.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(value || {});
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function storageSet(storageArea, value) {
  if (storageArea.set.length <= 1) {
    try {
      const maybePromise = storageArea.set(value);
      if (isPromiseLike(maybePromise)) {
        await maybePromise;
        return;
      }
    } catch {
      // Fall through to callback style.
    }
  }

  await new Promise((resolve, reject) => {
    try {
      storageArea.set(value, () => {
        const lastError = globalThis.chrome?.runtime?.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

function isPromiseLike(value) {
  return Boolean(value) && typeof value.then === 'function';
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}
