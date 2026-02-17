import test from 'node:test';
import assert from 'node:assert/strict';

import { DriveClient } from '../src/drive/client.js';

function jsonResponse(status, payload) {
  const text = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return text;
    }
  };
}

test('DriveClient retries once on 401 with forced token refresh', async () => {
  const tokenCalls = [];
  const fetchCalls = [];

  const client = new DriveClient({
    tokenProvider: async (options = {}) => {
      tokenCalls.push(options);
      return options.forceRefresh ? 'token_2' : 'token_1';
    },
    fetchImpl: async (_url, request) => {
      fetchCalls.push(request.headers.Authorization);
      if (fetchCalls.length === 1) {
        return jsonResponse(401, { error: { message: 'Unauthorized' } });
      }
      return jsonResponse(200, { files: [] });
    }
  });

  const files = await client.listFiles({
    q: "name='x' and trashed=false"
  });

  assert.equal(Array.isArray(files), true);
  assert.equal(fetchCalls.length, 2);
  assert.equal(tokenCalls.length, 2);
  assert.equal(tokenCalls[1].forceRefresh, true);
});

test('DriveClient returns TOKEN_EXPIRED after retry fails', async () => {
  const client = new DriveClient({
    tokenProvider: async () => 'token_1',
    fetchImpl: async () => jsonResponse(401, { error: { message: 'Unauthorized' } })
  });

  await assert.rejects(
    () =>
      client.listFiles({
        q: "name='x' and trashed=false"
      }),
    (error) => {
      assert.equal(error.code, 'TOKEN_EXPIRED');
      return true;
    }
  );
});

test('DriveClient default fetch binding works for WorkerGlobalScope-style fetch', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async function (_url, request) {
      if (this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation");
      }

      calls.push(request?.headers?.Authorization || '');
      return jsonResponse(200, { files: [] });
    };

    const client = new DriveClient({
      tokenProvider: async () => 'token_ctx'
    });

    const files = await client.listFiles({
      q: "name='x' and trashed=false"
    });

    assert.equal(Array.isArray(files), true);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
