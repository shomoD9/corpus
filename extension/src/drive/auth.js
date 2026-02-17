/*
  This file is the Google OAuth token utility for the extension runtime.
  It exists separately from API client code so token lifecycle and Drive request mechanics remain decoupled.
  It talks directly to `chrome.identity` and returns normalized auth errors to callers in UI and background layers.
*/

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.appdata'
];

let currentToken = '';

export async function getAccessToken(options = {}) {
  const identity = globalThis.chrome?.identity;

  if (!identity?.getAuthToken) {
    throw createAuthError('AUTH_REQUIRED', 'Chrome identity API is unavailable.');
  }

  const interactive = Boolean(options.interactive);
  const forceRefresh = Boolean(options.forceRefresh);

  if (forceRefresh && currentToken) {
    // We clear the token cache before retrying so Drive 401 responses can recover cleanly.
    await removeCachedAuthToken(currentToken);
    currentToken = '';
  }

  const token = await new Promise((resolve, reject) => {
    try {
      identity.getAuthToken({ interactive }, (value) => {
        if (globalThis.chrome?.runtime?.lastError) {
          reject(createAuthError('AUTH_REQUIRED', globalThis.chrome.runtime.lastError.message));
          return;
        }

        resolve(value || '');
      });
    } catch (error) {
      reject(createAuthError('AUTH_REQUIRED', error.message || 'Unable to acquire token.'));
    }
  });

  if (!token) {
    throw createAuthError('AUTH_REQUIRED', 'Google sign-in is required.');
  }

  currentToken = token;
  return token;
}

export async function signOut() {
  await removeCachedAuthToken(currentToken);
  currentToken = '';
}

export async function invalidateAccessToken(token = currentToken) {
  await removeCachedAuthToken(token);

  if (token && token === currentToken) {
    currentToken = '';
  }
}

async function removeCachedAuthToken(token) {
  if (!token) {
    return;
  }

  const identity = globalThis.chrome?.identity;

  if (!identity?.removeCachedAuthToken) {
    return;
  }

  await new Promise((resolve) => {
    identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

function createAuthError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
