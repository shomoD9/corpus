# Spec: Corpus Chrome Extension — V1

## What This Is

The Corpus Chrome Extension is called CV Deployer. It lets the user 
access their saved CV versions from any page in the browser and either 
download a PDF, copy a stable Google Drive link, or open a Drive popup 
to drag and drop the file directly into an upload field — without opening 
the Corpus web app.

## Who This Is For

Shomo — actively applying for jobs. He is on a job portal, an ATS, or 
a company careers page and needs his CV fast without switching tabs or 
hunting through Drive.

---

## How It Works

The extension is a popup — it opens when the user clicks the Corpus icon 
in the Chrome toolbar. It does not inject anything into pages automatically. 
It does not run in the background or observe what the user is doing.

The user opens it when they need it. That's it.

---

## Features

### 1. Authentication

On first use, the extension prompts the user to sign in with the same 
Google account they use for Corpus. Once signed in, the session persists 
— the user does not need to sign in again on subsequent uses.

If the user is not signed into Corpus at all, the popup shows a single 
prompt: "Sign in to Corpus" with a button that opens the Corpus web app.

### 2. CV List

Once signed in, the popup shows all the user's CV Types. Each Type is 
expandable to show its versions. The default version is shown first and 
labelled as default.

For each version, three actions are available:

- **Download** — downloads the PDF to the user's local system
- **Copy Drive Link** — copies the stable Google Drive link to clipboard. 
  A brief confirmation ("Copied!") appears inline.
- **Open in Drive** — opens a small browser popup window pointing to the 
  `/Corpus/CVs/` folder in the user's Google Drive. The user can then 
  drag the file directly from that window into an upload field on the 
  page behind it.

**Note on Open in Drive:** drag and drop from a browser window into an 
upload field works on most job portals but not all — some ATS platforms 
only accept drags from the OS file system. Download or Copy Drive Link 
are the fallback for those cases.

### 3. Refresh

A small refresh button in the popup header re-fetches the latest CV data 
from Corpus. This ensures that if the user has just exported a new version 
in the web app, it appears in the extension without needing to reinstall 
or restart Chrome.

---

## UI Notes

- Popup width: fixed, compact — this is a utility tool not a dashboard
- CV Types listed by name, collapsed by default
- Expanding a Type shows its versions in order, default version first
- No editing of any kind inside the extension — it is read and deploy only
- If the user has no CVs yet, the popup shows a prompt: 
  "No CVs found. Go to Corpus to create one." with a link to the web app
- The Drive popup window should open small and to the side — it is 
  a utility window, not a full tab

---

## Out of Scope for V1

- Automated form auto-fill on job application pages (V1.1)
- Filtering or searching CV versions
- Any settings or configuration inside the extension

---

## Acceptance Criteria

- [ ] Extension icon appears in Chrome toolbar after installation
- [ ] Unsigned-in user sees a prompt to sign into Corpus
- [ ] Signed-in user sees all their CV Types and versions
- [ ] Default version is clearly labelled and appears first within its Type
- [ ] Download action downloads the correct PDF to local system
- [ ] Copy Link action copies the correct Drive link and shows confirmation
- [ ] Open in Drive opens a small popup window to the Corpus CVs folder 
      in Google Drive
- [ ] Refresh button fetches latest data from Corpus
- [ ] User with no CVs sees a prompt linking to the web app
- [ ] Extension works on any page — no site-specific behaviour
