/*
  This test file validates the local-first sync controller that keeps editor typing responsive.
  It exists as an isolated unit suite because synchronization edge cases are timing-sensitive and
  much easier to verify without rendering the full UI.
  It talks to `createSyncController` through mocked command and storage adapters.
*/

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSyncController, LOCAL_DRAFTS_KEY } from '../src/ui/sync_controller.js';

test('coalesces rapid edits into a single Drive write', async () => {
  const commandCalls = [];
  const storage = createMemoryStorage();

  const controller = createSyncController({
    storageArea: storage,
    idleMs: 25,
    localPersistMs: 1,
    sendCommand: async (command, payload) => {
      commandCalls.push({ command, payload });
      return {
        state: {
          updatedAt: new Date().toISOString(),
          cvTypes: [{ id: payload.cvTypeId, data: payload.data }]
        }
      };
    }
  });

  controller.scheduleTypeSave('type_1', { marker: 'first' }, 'remote_a');
  controller.scheduleTypeSave('type_1', { marker: 'second' }, 'remote_a');

  await wait(70);

  const driveWrites = commandCalls.filter((call) => call.command === 'CV_UPDATE_TYPE');
  assert.equal(driveWrites.length, 1);
  assert.equal(driveWrites[0].payload.data.marker, 'second');
  assert.equal(controller.getStatus(), 'saved');
  assert.deepEqual(storage.snapshot()[LOCAL_DRAFTS_KEY], {});
});

test('runs a trailing sync pass when new edits arrive during an in-flight save', async () => {
  const calls = [];
  const resolvers = [];

  const controller = createSyncController({
    idleMs: 5000,
    localPersistMs: 1,
    sendCommand: async (command, payload) => {
      if (command !== 'CV_UPDATE_TYPE') {
        return {
          state: {
            updatedAt: new Date().toISOString(),
            cvTypes: []
          }
        };
      }

      calls.push(payload.data.marker);
      return new Promise((resolve) => {
        resolvers.push(() => {
          resolve({
            state: {
              updatedAt: new Date().toISOString(),
              cvTypes: [{ id: payload.cvTypeId, data: payload.data }]
            }
          });
        });
      });
    }
  });

  controller.scheduleTypeSave('type_1', { marker: 'first' }, 'remote_a');
  const flushPromise = controller.flush('manual');

  await wait(5);
  controller.scheduleTypeSave('type_1', { marker: 'second' }, 'remote_a');

  assert.equal(calls.length, 1);
  resolvers.shift()?.();

  await wait(5);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], 'second');

  resolvers.shift()?.();
  await flushPromise;
  assert.equal(controller.getStatus(), 'saved');
});

test('handles conflict by reloading state once then retrying', async () => {
  const order = [];
  let didConflict = false;

  const controller = createSyncController({
    idleMs: 5000,
    localPersistMs: 1,
    sendCommand: async (command, payload) => {
      order.push(command);

      if (command === 'CV_UPDATE_TYPE' && !didConflict) {
        didConflict = true;
        const conflict = new Error('conflict');
        conflict.code = 'STATE_CONFLICT';
        throw conflict;
      }

      if (command === 'STATE_LOAD') {
        return {
          state: {
            updatedAt: '2026-02-17T00:00:00.000Z',
            cvTypes: [{ id: payload?.cvTypeId || 'type_1', data: { marker: 'remote' } }]
          }
        };
      }

      return {
        state: {
          updatedAt: '2026-02-17T00:00:01.000Z',
          cvTypes: [{ id: 'type_1', data: payload.data }]
        }
      };
    }
  });

  controller.scheduleTypeSave('type_1', { marker: 'draft' }, 'remote_a');
  const result = await controller.flush('manual');

  assert.equal(result.ok, true);
  assert.equal(controller.getStatus(), 'saved');
  assert.deepEqual(order, ['CV_UPDATE_TYPE', 'STATE_LOAD', 'CV_UPDATE_TYPE']);
});

test('keeps local drafts on sync failure and restores them on next load', async () => {
  const storage = createMemoryStorage();

  const failingController = createSyncController({
    storageArea: storage,
    idleMs: 5000,
    localPersistMs: 1,
    sendCommand: async () => {
      const error = new Error('token expired');
      error.code = 'TOKEN_EXPIRED';
      throw error;
    }
  });

  failingController.scheduleTypeSave(
    'type_1',
    {
      personalInfo: { name: 'Local Draft' }
    },
    'remote_a'
  );

  const failed = await failingController.flush('manual');
  assert.equal(failed.ok, false);
  assert.equal(failingController.getStatus(), 'error');
  assert.ok(storage.snapshot()[LOCAL_DRAFTS_KEY].type_1);

  const recoveringController = createSyncController({
    storageArea: storage,
    idleMs: 5000,
    localPersistMs: 1,
    sendCommand: async (command, payload) => {
      if (command === 'STATE_LOAD') {
        return {
          state: {
            updatedAt: '2026-02-17T00:00:00.000Z',
            cvTypes: [{ id: 'type_1', data: { personalInfo: { name: 'Remote' } } }]
          }
        };
      }

      return {
        state: {
          updatedAt: '2026-02-17T00:00:01.000Z',
          cvTypes: [{ id: payload.cvTypeId, data: payload.data }]
        }
      };
    }
  });

  const merged = await recoveringController.restoreDrafts({
    updatedAt: '2026-02-17T00:00:00.000Z',
    cvTypes: [{ id: 'type_1', data: { personalInfo: { name: 'Remote' } } }]
  });

  assert.equal(merged.cvTypes[0].data.personalInfo.name, 'Local Draft');
});

test('status transitions cover pending -> saving -> saved', async () => {
  const statuses = [];

  const controller = createSyncController({
    idleMs: 5000,
    localPersistMs: 1,
    onStatus: (status) => statuses.push(status),
    sendCommand: async (_command, payload) => {
      return {
        state: {
          updatedAt: new Date().toISOString(),
          cvTypes: [{ id: payload.cvTypeId, data: payload.data }]
        }
      };
    }
  });

  controller.scheduleTypeSave('type_1', { marker: 'draft' }, 'remote_a');
  await controller.flush('manual');

  assert.ok(statuses.includes('pending'));
  assert.ok(statuses.includes('saving'));
  assert.ok(statuses.includes('saved'));
  assert.equal(controller.getStatus(), 'saved');
});

function createMemoryStorage(initial = {}) {
  const state = { ...initial };

  return {
    async get(key) {
      if (typeof key === 'string') {
        return { [key]: state[key] };
      }

      if (Array.isArray(key)) {
        const output = {};
        for (const name of key) {
          output[name] = state[name];
        }
        return output;
      }

      return { ...state };
    },
    async set(value) {
      Object.assign(state, value);
    },
    snapshot() {
      return JSON.parse(JSON.stringify(state));
    }
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
