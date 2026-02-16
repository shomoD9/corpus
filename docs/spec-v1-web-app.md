# Spec: Corpus Web App — V1

## What This Is

The Corpus web app is called CV Studio. It is where the user builds and 
maintains their CVs, manages versions, and exports to Google Drive as PDFs.

## Who This Is For

Shomo — a Product Manager and content creator. Not a developer. The UI 
should require zero technical knowledge to use.

---

## Core Data Model

### CV Type
A distinct CV with its own independent data. The user may have multiple 
types — e.g. "PM General", "B2C PM", "Startup PM". Fields that look the 
same across types (e.g. Work Experience) can have completely different 
content. Types do not share data.

### CV Version
An iteration within a CV Type. When the user updates a CV Type, they can 
save the new state as a new version (e.g. v1, v2, v3) rather than 
overwriting. Older versions are accessible and can be exported.

One version per CV Type is marked as the default. The user decides which 
version is default — it does not automatically change when a new version 
is created.

### Section Visibility
Each CV Type has a default section visibility configuration (which sections 
are on or off). All versions within that type inherit this configuration 
by default. Each version can override the inherited settings independently 
without affecting other versions or the type-level defaults.

---

## Features

### 1. Google Sign-In

The user signs in with their Google account. This single auth flow also 
grants Corpus permission to read/write to their Google Drive. No separate 
Drive connection step.

On first sign-in, Corpus creates a folder at `/Corpus/CVs/` in the user's 
Drive.

### 2. CV Type Management

The user can create, edit, and delete CV Types. Each type has a name 
and an independent set of CV data.

**Creating a new CV Type — three options:**

**a) Start blank**
All sections are empty. The user fills everything in manually.

**b) Copy from existing**
The user picks any existing CV Type in Corpus. All data from that type 
is duplicated into the new one. The user then edits from there.

**c) Import via JSON**
The user pastes a JSON object into an import box. Corpus reads it and 
populates the new CV Type's fields accordingly.

To help with this, Corpus provides a ready-made import prompt. The user 
copies this prompt, goes to any AI tool of their choice (ChatGPT, Claude, 
etc.), pastes the prompt along with their existing CV text, and receives 
a JSON object in Corpus's exact schema. They paste that output into the 
import box and the CV Type is populated.

The import prompt is accessible from the "Import via JSON" screen at all 
times. It must be written carefully enough that AI output rarely requires 
manual correction after import.

The JSON schema Corpus accepts is fixed and documented. It maps directly 
to the CV sections listed below.

### 3. CV Data Form

Each CV Type has its own form with the following sections. All data saves 
automatically — no manual save button.

- **Personal Info** — name, title, email, phone, location, LinkedIn URL, 
  GitHub URL, personal website
- **Work Experience** — each entry: company, role, start date, end date 
  or "present", bullet points
- **Education** — institution, degree, field of study, graduation year
- **Skills** — freeform tags
- **Projects** — each entry: name, URL (optional), short description, 
  tags (optional)
- **Links** — any additional URLs (e.g. YouTube, portfolio)

### 4. Section Visibility

Each CV Type has a section visibility panel where the user can toggle 
any section on or off. These settings are the type-level defaults and 
are inherited by all versions within the type.

When editing a specific version, the user can override section visibility 
for that version only. Overrides do not affect other versions or the 
type-level defaults.

Hidden sections are not included in the exported PDF.

### 5. CV Versioning

Within a CV Type, the user can save the current state as a new version. 
Versions are numbered sequentially (v1, v2, v3…). The user can:

- View any past version (read-only)
- Export any version to Drive as a PDF
- Mark any version as the default
- Override section visibility per version

Versions are not created automatically — the user explicitly saves a 
new version when they want to checkpoint their work.

### 6. GitHub Project Import

In the Projects section, the user can "Import from GitHub". Corpus reads 
their public GitHub repositories and shows a list. The user selects a repo 
and it is added to Projects with the name and description pre-filled. 
Editable before saving.

GitHub is connected once from Settings, separate from Google auth.

### 7. PDF Export

Each CV version has an "Export to Drive" button. When clicked:

- Corpus generates a clean, professional PDF
- Saved to `/Corpus/CVs/{CV Type name}/` in the user's Drive
- Filename is `{CV Type name} - {version}.pdf` (e.g. `PM General - v2.pdf`)
- If that file already exists, it is overwritten — Drive link stays stable
- File is automatically set to "anyone with the link can view"
- User sees a confirmation with the stable Drive link and a "Copy Link" button

### 8. Links Dashboard

A separate section (not part of the CV form) where the user saves useful 
URLs. Each entry has a label and a URL. Examples: LinkedIn, Greenhouse, 
Indeed, specific company career portals.

- User can add, edit, and delete entries
- One-click "Open" button per entry opens URL in a new tab
- Flat list in V1 — no folders or categories

---

## UI Notes

- Sidebar navigation: CV Types, Links Dashboard, Settings
- Within a CV Type: sub-navigation for Form, Versions, Section Visibility, Export
- Navigation between sections should feel instant — no full page reloads
- Clean, minimal, professional design
- Desktop only in V1

---

## Out of Scope for V1

- Chrome extension (separate spec)
- Form auto-fill on job portals
- Application tracking
- Any storage other than Google Drive

---

## Acceptance Criteria

- [ ] User can sign in with Google and Drive access is granted in the same flow
- [ ] User can create a CV Type via blank, copy, or JSON import
- [ ] JSON import prompt is available on-screen and produces correct output 
      when used with an AI tool
- [ ] User can fill in all sections and data persists across sessions
- [ ] User can set section visibility at the type level; versions inherit 
      these settings by default
- [ ] User can override section visibility per version without affecting 
      other versions
- [ ] User can save new versions within a CV Type and access past versions
- [ ] User can mark any version as the default
- [ ] User can import a project from their public GitHub repos
- [ ] User can export any CV version to Drive as a PDF with a stable, 
      shareable link
- [ ] User can save, edit, and delete links in the Links Dashboard
