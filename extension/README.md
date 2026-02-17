# Corpus Extension (V1)

Corpus V1 is implemented as a single Chrome extension with Google Drive as backend storage.

## What is implemented

- MV3 extension with:
  - Full editor tab: `src/ui/app.html`
  - Toolbar popup deployer: `src/ui/popup.html`
- Real command router in service worker: `src/background/service_worker.js`
- Google auth integration via `chrome.identity`
- Drive-backed state in `appDataFolder` (`corpus-state-v2.json`)
- PDF export to `/Corpus/CVs/{CV Type}/` in My Drive
- Stable file overwrite flow by Drive file id
- Per-field visibility defaults + per-version tri-state overrides
- Automated tests (`node --test`)

## Build and package

```bash
cd /Users/shomo/development/build/corpus/extension
npm test
npm run build
npm run package
```

For production builds, inject OAuth client id automatically:

```bash
GOOGLE_OAUTH_CLIENT_ID=\"your-client-id.apps.googleusercontent.com\" npm run package
```

Outputs:

- Unpacked extension folder: `/Users/shomo/development/build/corpus/extension/dist`
- Uploadable zip: `/Users/shomo/development/build/corpus/extension/extension.zip`

## Google OAuth setup (required)

1. Create a Google Cloud project.
2. Enable Google Drive API.
3. Create OAuth client for Chrome Extension.
4. Copy the extension OAuth client id.
5. Provide OAuth client id at build time via `GOOGLE_OAUTH_CLIENT_ID`.
   - Local fallback still exists in `manifest.json` for development only.
6. Ensure scopes include:
   - `https://www.googleapis.com/auth/drive.file`
   - `https://www.googleapis.com/auth/drive.appdata`

## Load locally (unpacked)

1. Build first (`npm run build`).
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click "Load unpacked".
5. Select `/Users/shomo/development/build/corpus/extension/dist`.

## Publish

1. Use `extension.zip` for Chrome Web Store upload.
2. Publish as private/unlisted first.
3. Add your Google account as test user while OAuth app is in testing.

## Notes

- Production OAuth client id should be injected during build.
- If you rotate extension ID, update OAuth registration accordingly.
- Existing `/Users/shomo/development/build/corpus/web` is left untouched as legacy reference.

## End-user auth flow

1. User opens popup or editor.
2. If not connected, they see a single `Sign in with Google` button.
3. Extension performs interactive OAuth and immediately bootstraps Drive backend:
   - creates/ensures `/Corpus/CVs`
   - creates/loads hidden `corpus-state-v2.json` in appDataFolder
4. User lands directly in ready state.
5. If token expires later, user-triggered actions auto-reconnect once and retry seamlessly.
