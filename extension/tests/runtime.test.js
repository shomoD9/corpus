import test from 'node:test';
import assert from 'node:assert/strict';

import { sendRuntimeCommand } from '../src/ui/runtime.js';

test('sendRuntimeCommand reconnects interactively and retries once', async () => {
  const originalChrome = globalThis.chrome;
  const calls = [];

  try {
    globalThis.chrome = {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          calls.push(message.command);

          if (message.command === 'CV_CREATE_TYPE') {
            if (calls.filter((item) => item === 'CV_CREATE_TYPE').length === 1) {
              callback({ ok: false, error: { code: 'TOKEN_EXPIRED', message: 'expired' } });
              return;
            }

            callback({ ok: true, data: { created: true } });
            return;
          }

          if (message.command === 'AUTH_SIGN_IN') {
            callback({ ok: true, data: { authenticated: true } });
            return;
          }

          callback({ ok: false, error: { code: 'DRIVE_API_ERROR', message: 'unexpected' } });
        }
      }
    };

    const result = await sendRuntimeCommand('CV_CREATE_TYPE', {}, { interactiveReconnect: true });

    assert.equal(result.created, true);
    assert.deepEqual(calls, ['CV_CREATE_TYPE', 'AUTH_SIGN_IN', 'CV_CREATE_TYPE']);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test('sendRuntimeCommand throws when reconnect is disabled', async () => {
  const originalChrome = globalThis.chrome;

  try {
    globalThis.chrome = {
      runtime: {
        lastError: null,
        sendMessage(_message, callback) {
          callback({ ok: false, error: { code: 'TOKEN_EXPIRED', message: 'expired' } });
        }
      }
    };

    await assert.rejects(
      () => sendRuntimeCommand('STATE_SAVE', {}, { interactiveReconnect: false }),
      (error) => {
        assert.equal(error.code, 'TOKEN_EXPIRED');
        return true;
      }
    );
  } finally {
    globalThis.chrome = originalChrome;
  }
});
