/*
  This file is the UI-side runtime messaging adapter.
  It exists to hide raw `chrome.runtime.sendMessage` details and provide a consistent async error model
  (including interactive reconnect behavior) to editor and popup callers.
  It talks to the background service worker through command payloads and normalized response envelopes.
*/

export async function sendRuntimeCommand(command, payload = {}, options = {}) {
  const response = await dispatchCommand(command, payload);

  if (response?.ok) {
    return response.data;
  }

  const error = createUiError(
    response?.error?.code || 'DRIVE_API_ERROR',
    response?.error?.message || 'Request failed.'
  );

  if (
    options.interactiveReconnect &&
    command !== 'AUTH_SIGN_IN' &&
    (error.code === 'AUTH_REQUIRED' || error.code === 'TOKEN_EXPIRED')
  ) {
    // Reconnect is opt-in so read-only calls can fail fast while user actions self-heal.
    const reconnect = await dispatchCommand('AUTH_SIGN_IN', {});

    if (!reconnect?.ok) {
      throw createUiError(
        reconnect?.error?.code || 'DRIVE_API_ERROR',
        reconnect?.error?.message || 'Reconnect failed.'
      );
    }

    const retried = await dispatchCommand(command, payload);
    if (retried?.ok) {
      return retried.data;
    }

    throw createUiError(
      retried?.error?.code || 'DRIVE_API_ERROR',
      retried?.error?.message || 'Request failed after reconnect.'
    );
  }

  throw error;
}

async function dispatchCommand(command, payload = {}) {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    throw createUiError('DRIVE_API_ERROR', 'Chrome runtime API is unavailable.');
  }

  const response = await new Promise((resolve, reject) => {
    try {
      globalThis.chrome.runtime.sendMessage({ command, payload }, (result) => {
        if (globalThis.chrome.runtime.lastError) {
          reject(createUiError('DRIVE_API_ERROR', globalThis.chrome.runtime.lastError.message));
          return;
        }

        resolve(result);
      });
    } catch (error) {
      reject(createUiError('DRIVE_API_ERROR', error.message || 'Message dispatch failed.'));
    }
  });

  return response;
}

export function createUiError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
