/*
  This file is the main UI controller for the legacy standalone web CV Studio.
  It exists as a single-page orchestrator for rendering, state updates, modal flows, and local persistence.
  It talks to `core.js` for pure logic helpers and to browser localStorage for state durability.
*/

import {
  buildCvTypeFromModal,
  makeVersionRecord,
  mergeVisibility,
  resolveActionableElement
} from './core.js';

const STORAGE_KEY = 'cv_studio_v1_state';
const DRIVE_ROOT = '/Corpus/CVs';

const SECTION_META = [
  { key: 'personalInfo', label: 'Personal Info' },
  { key: 'workExperience', label: 'Work Experience' },
  { key: 'education', label: 'Education' },
  { key: 'skills', label: 'Skills' },
  { key: 'projects', label: 'Projects' },
  { key: 'links', label: 'Links' }
];

const PERSONAL_FIELDS = [
  { key: 'name', label: 'Full Name' },
  { key: 'title', label: 'Title' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'location', label: 'Location' },
  { key: 'linkedinUrl', label: 'LinkedIn URL' },
  { key: 'githubUrl', label: 'GitHub URL' },
  { key: 'website', label: 'Website' }
];

const IMPORT_PROMPT = `Convert the CV text below into valid JSON for CV Studio.

Rules:
1) Return JSON only. Do not include markdown, code fences, or commentary.
2) Use this exact top-level structure and keys:
{
  "personalInfo": {
    "name": "",
    "title": "",
    "email": "",
    "phone": "",
    "location": "",
    "linkedinUrl": "",
    "githubUrl": "",
    "website": ""
  },
  "workExperience": [
    {
      "company": "",
      "role": "",
      "startDate": "",
      "endDate": "",
      "present": false,
      "bullets": ["..."]
    }
  ],
  "education": [
    {
      "institution": "",
      "degree": "",
      "fieldOfStudy": "",
      "graduationYear": ""
    }
  ],
  "skills": ["..."],
  "projects": [
    {
      "name": "",
      "url": "",
      "description": "",
      "tags": ["..."]
    }
  ],
  "links": ["..."]
}

3) Keep bullet points concise and quantified when possible.
4) If a value is unknown, use an empty string or empty array.
5) Dates can remain plain text (for example: "Jan 2022").

CV text to convert:
[PASTE CV TEXT HERE]`;

let state = loadState();

const ui = {
  mainView: 'cvTypes',
  cvSubView: 'form',
  selectedTypeId: null,
  selectedVersionId: null,
  exportVersionId: null,
  modal: null,
  authDraft: {
    name: '',
    email: ''
  },
  githubDraft: '',
  lastExport: null,
  toastTimer: null
};

const appEl = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const toastEl = document.getElementById('toast');

bindEvents();
initializeUiFromState();
render();

function bindEvents() {
  appEl.addEventListener('click', handleClick);
  appEl.addEventListener('input', handleInput);
  appEl.addEventListener('change', handleChange);

  modalRoot.addEventListener('click', handleClick);
  modalRoot.addEventListener('input', handleInput);
  modalRoot.addEventListener('change', handleChange);
}

function loadState() {
  const fallback = createInitialState();
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return fallback;
  }

  try {
    // Any corrupted local payload gracefully falls back to a clean initial state.
    const parsed = JSON.parse(raw);
    return sanitizeState(parsed);
  } catch {
    return fallback;
  }
}

function createInitialState() {
  return {
    auth: {
      signedIn: false,
      name: '',
      email: '',
      driveFolderCreated: false,
      driveRoot: DRIVE_ROOT
    },
    github: {
      connected: false,
      username: ''
    },
    cvTypes: [],
    linksDashboard: [],
    driveExports: {}
  };
}

function sanitizeState(candidate) {
  const fallback = createInitialState();
  const safe = {
    auth: {
      signedIn: Boolean(candidate?.auth?.signedIn),
      name: safeString(candidate?.auth?.name),
      email: safeString(candidate?.auth?.email),
      driveFolderCreated: Boolean(candidate?.auth?.driveFolderCreated),
      driveRoot: DRIVE_ROOT
    },
    github: {
      connected: Boolean(candidate?.github?.connected),
      username: safeString(candidate?.github?.username)
    },
    cvTypes: [],
    linksDashboard: [],
    driveExports: isObject(candidate?.driveExports) ? candidate.driveExports : {}
  };

  const candidateTypes = Array.isArray(candidate?.cvTypes) ? candidate.cvTypes : [];

  safe.cvTypes = candidateTypes.map((type) => sanitizeCvType(type)).filter(Boolean);

  const dashboardLinks = Array.isArray(candidate?.linksDashboard) ? candidate.linksDashboard : [];
  safe.linksDashboard = dashboardLinks
    .map((entry) => ({
      id: safeString(entry?.id) || makeId('link'),
      label: safeString(entry?.label),
      url: safeString(entry?.url)
    }))
    .filter((entry) => entry.label || entry.url);

  if (!safe.auth.signedIn) {
    safe.auth.name = '';
    safe.auth.email = '';
  }

  if (!safe.github.username) {
    safe.github.connected = false;
  }

  return { ...fallback, ...safe };
}

function sanitizeCvType(type) {
  if (!type || typeof type !== 'object') {
    return null;
  }

  const data = sanitizeCvData(type.data);
  const visibilityDefaults = createDefaultVisibility();

  for (const section of SECTION_META) {
    visibilityDefaults[section.key] = Boolean(type.visibilityDefaults?.[section.key] ?? true);
  }

  const versions = Array.isArray(type.versions)
    ? type.versions
        .map((version, index) => sanitizeVersion(version, visibilityDefaults, index))
        .filter(Boolean)
    : [];

  const defaultVersionId = safeString(type.defaultVersionId);

  return {
    id: safeString(type.id) || makeId('type'),
    name: safeString(type.name) || 'Untitled CV',
    data,
    visibilityDefaults,
    versions,
    defaultVersionId: versions.some((version) => version.id === defaultVersionId)
      ? defaultVersionId
      : versions[0]?.id || null
  };
}

function sanitizeVersion(version, visibilityDefaults, index) {
  if (!version || typeof version !== 'object') {
    return null;
  }

  const overrides = createEmptyVisibilityOverrides();

  for (const section of SECTION_META) {
    const overrideValue = version.visibilityOverrides?.[section.key];
    if (overrideValue === true || overrideValue === false) {
      overrides[section.key] = overrideValue;
    }
  }

  return {
    id: safeString(version.id) || makeId('ver'),
    label: safeString(version.label) || `v${index + 1}`,
    createdAt: safeString(version.createdAt) || new Date().toISOString(),
    snapshot: sanitizeCvData(version.snapshot),
    visibilityOverrides: overrides,
    inheritedDefaultsAtSave: visibilityDefaults
  };
}

function sanitizeCvData(data) {
  const source = isObject(data) ? data : {};
  const personalInfo = isObject(source.personalInfo) ? source.personalInfo : {};

  return {
    personalInfo: {
      name: safeString(personalInfo.name),
      title: safeString(personalInfo.title),
      email: safeString(personalInfo.email),
      phone: safeString(personalInfo.phone),
      location: safeString(personalInfo.location),
      linkedinUrl: safeString(personalInfo.linkedinUrl),
      githubUrl: safeString(personalInfo.githubUrl),
      website: safeString(personalInfo.website)
    },
    workExperience: normalizeWorkExperience(source.workExperience),
    education: normalizeEducation(source.education),
    skills: normalizeStringArray(source.skills),
    projects: normalizeProjects(source.projects),
    links: normalizeStringArray(source.links)
  };
}

function normalizeWorkExperience(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.map((entry) => ({
    company: safeString(entry?.company),
    role: safeString(entry?.role),
    startDate: safeString(entry?.startDate),
    endDate: safeString(entry?.endDate),
    present: Boolean(entry?.present),
    bullets: normalizeStringArray(entry?.bullets)
  }));
}

function normalizeEducation(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.map((entry) => ({
    institution: safeString(entry?.institution),
    degree: safeString(entry?.degree),
    fieldOfStudy: safeString(entry?.fieldOfStudy),
    graduationYear: safeString(entry?.graduationYear)
  }));
}

function normalizeProjects(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.map((entry) => ({
    name: safeString(entry?.name),
    url: safeString(entry?.url),
    description: safeString(entry?.description),
    tags: normalizeStringArray(entry?.tags)
  }));
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => safeString(value).trim())
    .filter((value) => value.length > 0);
}

function safeString(value) {
  return typeof value === 'string' ? value : '';
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function initializeUiFromState() {
  ui.authDraft.name = state.auth.name;
  ui.authDraft.email = state.auth.email;
  ui.githubDraft = state.github.username;

  ensureTypeSelection();
}

function ensureTypeSelection() {
  if (!state.cvTypes.length) {
    ui.selectedTypeId = null;
    ui.selectedVersionId = null;
    ui.exportVersionId = null;
    return;
  }

  const selectedTypeExists = state.cvTypes.some((type) => type.id === ui.selectedTypeId);

  if (!selectedTypeExists) {
    ui.selectedTypeId = state.cvTypes[0].id;
  }

  const currentType = getSelectedType();

  if (!currentType) {
    ui.selectedVersionId = null;
    ui.exportVersionId = null;
    return;
  }

  if (ui.selectedVersionId && !currentType.versions.some((version) => version.id === ui.selectedVersionId)) {
    ui.selectedVersionId = null;
  }

  if (
    ui.exportVersionId &&
    !currentType.versions.some((version) => version.id === ui.exportVersionId)
  ) {
    ui.exportVersionId = null;
  }

  if (!ui.exportVersionId) {
    ui.exportVersionId = currentType.defaultVersionId || currentType.versions.at(-1)?.id || null;
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  ensureTypeSelection();

  if (!state.auth.signedIn) {
    renderAuthScreen();
  } else {
    renderShell();
  }

  renderModal();
}

function renderAuthScreen() {
  appEl.innerHTML = `
    <div class="auth-wrap">
      <section class="auth-card">
        <div class="brand-eyebrow">Corpus CV Studio</div>
        <h1 class="auth-title">Build and version your CVs in one workspace.</h1>
        <p class="auth-copy">
          Sign in with Google to unlock Drive export and manage every CV type, version, and share link from one desktop flow.
        </p>

        <div class="grid two">
          <div class="field">
            <label>Name</label>
            <input
              type="text"
              placeholder="Your name"
              value="${escapeHtml(ui.authDraft.name)}"
              data-action="auth-draft-name"
            />
          </div>
          <div class="field">
            <label>Google Email</label>
            <input
              type="email"
              placeholder="you@gmail.com"
              value="${escapeHtml(ui.authDraft.email)}"
              data-action="auth-draft-email"
            />
          </div>
        </div>

        <div style="margin-top: 20px" class="inline">
          <button class="btn btn-primary" data-action="google-sign-in">Sign in with Google</button>
          <span class="hint">First sign-in creates <code class="inline-code">${escapeHtml(DRIVE_ROOT)}</code> in Drive.</span>
        </div>
      </section>
    </div>
  `;
}

function renderShell() {
  appEl.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <section class="brand">
          <h1>CV Studio</h1>
          <p>Versioned CV workspace for fast export.</p>
        </section>

        <nav class="nav-stack">
          ${renderMainNavButton('cvTypes', 'CV Types')}
          ${renderMainNavButton('linksDashboard', 'Links Dashboard')}
          ${renderMainNavButton('settings', 'Settings')}
        </nav>

        <section class="profile-pill">
          <strong>${escapeHtml(state.auth.name || 'Signed in')}</strong>
          ${escapeHtml(state.auth.email)}
        </section>
      </aside>

      <main class="main-panel">
        <div class="mobile-warning">
          Desktop-first V1: best experience at larger widths.
        </div>
        ${renderCurrentMainView()}
      </main>
    </div>
  `;
}

function renderMainNavButton(view, label) {
  const activeClass = ui.mainView === view ? 'active' : '';

  return `<button class="nav-btn ${activeClass}" data-action="set-main-view" data-view="${view}">${label}</button>`;
}

function renderCurrentMainView() {
  if (ui.mainView === 'linksDashboard') {
    return renderLinksDashboard();
  }

  if (ui.mainView === 'settings') {
    return renderSettingsView();
  }

  return renderCvTypesView();
}

function renderCvTypesView() {
  const selectedType = getSelectedType();

  return `
    <header class="page-header">
      <div>
        <h2 class="page-title">CV Types</h2>
        <p class="page-description">Each type is independent. Save checkpointed versions only when you decide to.</p>
      </div>
      <button class="btn btn-primary" data-action="open-create-cv-modal">Create CV Type</button>
    </header>

    <div class="cv-layout">
      <section class="card">
        <h3>Your CV Types</h3>
        <p style="margin-bottom: 12px">Create blank, copy an existing type, or import via JSON.</p>
        <div class="cv-type-list">
          ${state.cvTypes.length ? state.cvTypes.map((type) => renderTypeItem(type)).join('') : '<div class="empty">No CV types yet. Create your first one.</div>'}
        </div>
      </section>

      <section class="card">
        ${selectedType ? renderSelectedTypeWorkspace(selectedType) : '<div class="empty">Select or create a CV type to start.</div>'}
      </section>
    </div>
  `;
}

function renderTypeItem(type) {
  const activeClass = type.id === ui.selectedTypeId ? 'active' : '';
  const versionsCount = type.versions.length;

  return `
    <article class="type-item ${activeClass}" data-action="select-cv-type" data-type-id="${type.id}">
      <h4 class="type-item-title">${escapeHtml(type.name)}</h4>
      <div class="type-item-meta">${versionsCount} version${versionsCount === 1 ? '' : 's'}</div>
      <div class="type-item-actions">
        <button class="btn btn-secondary btn-small" data-action="rename-cv-type" data-type-id="${type.id}">Rename</button>
        <button class="btn btn-danger btn-small" data-action="delete-cv-type" data-type-id="${type.id}">Delete</button>
      </div>
    </article>
  `;
}

function renderSelectedTypeWorkspace(type) {
  return `
    <header class="page-header" style="margin-bottom: 12px">
      <div>
        <h3 class="page-title" style="font-size: 28px">${escapeHtml(type.name)}</h3>
        <p class="page-description">Autosave is always on. No manual save button required.</p>
      </div>
      ${type.defaultVersionId ? '<span class="pill default">Default version set</span>' : '<span class="pill muted">No default version yet</span>'}
    </header>

    <nav class="subnav">
      ${renderSubNavButton('form', 'Form')}
      ${renderSubNavButton('versions', 'Versions')}
      ${renderSubNavButton('visibility', 'Section Visibility')}
      ${renderSubNavButton('export', 'Export')}
    </nav>

    ${renderCvSubView(type)}
  `;
}

function renderSubNavButton(subView, label) {
  const kind = ui.cvSubView === subView ? 'btn-primary' : 'btn-secondary';
  return `<button class="btn ${kind}" data-action="set-cv-sub-view" data-sub-view="${subView}">${label}</button>`;
}

function renderCvSubView(type) {
  if (ui.cvSubView === 'versions') {
    return renderVersionsView(type);
  }

  if (ui.cvSubView === 'visibility') {
    return renderTypeVisibilityView(type);
  }

  if (ui.cvSubView === 'export') {
    return renderExportView(type);
  }

  return renderFormView(type);
}

function renderFormView(type) {
  const data = type.data;

  return `
    <div class="section-stack">
      <section class="section-card">
        <div class="section-header">
          <h3>Personal Info</h3>
          <span class="hint">Saved automatically as you type.</span>
        </div>
        <div class="field-grid">
          ${PERSONAL_FIELDS.map((field) => {
            return `
              <div class="field">
                <label>${field.label}</label>
                <input
                  type="text"
                  value="${escapeHtml(data.personalInfo[field.key])}"
                  data-action="update-personal-field"
                  data-field="${field.key}"
                />
              </div>
            `;
          }).join('')}
        </div>
      </section>

      <section class="section-card">
        <div class="section-header">
          <h3>Work Experience</h3>
          <button class="btn btn-secondary btn-small" data-action="add-work-entry">Add entry</button>
        </div>
        ${renderWorkExperienceEntries(data.workExperience)}
      </section>

      <section class="section-card">
        <div class="section-header">
          <h3>Education</h3>
          <button class="btn btn-secondary btn-small" data-action="add-education-entry">Add entry</button>
        </div>
        ${renderEducationEntries(data.education)}
      </section>

      <section class="section-card">
        <div class="section-header">
          <h3>Skills</h3>
        </div>
        <div class="field-grid one">
          <div class="field">
            <label>Tags (comma separated)</label>
            <input
              type="text"
              value="${escapeHtml(data.skills.join(', '))}"
              data-action="update-skills"
            />
          </div>
        </div>
      </section>

      <section class="section-card">
        <div class="section-header">
          <h3>Projects</h3>
          <div class="inline">
            <button class="btn btn-secondary btn-small" data-action="add-project-entry">Add entry</button>
            <button class="btn btn-ghost btn-small" data-action="open-github-import-modal">Import from GitHub</button>
          </div>
        </div>
        ${renderProjectsEntries(data.projects)}
      </section>

      <section class="section-card">
        <div class="section-header">
          <h3>Links</h3>
        </div>
        <div class="field-grid one">
          <div class="field">
            <label>One URL per line</label>
            <textarea data-action="update-cv-links">${escapeHtml(data.links.join('\n'))}</textarea>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderWorkExperienceEntries(entries) {
  if (!entries.length) {
    return '<div class="empty">No work entries yet.</div>';
  }

  return entries
    .map((entry, index) => {
      return `
        <article class="entry-card">
          <div class="entry-head">
            <strong>Work Entry ${index + 1}</strong>
            <button class="btn btn-danger btn-small" data-action="remove-work-entry" data-index="${index}">Remove</button>
          </div>
          <div class="field-grid">
            <div class="field">
              <label>Company</label>
              <input type="text" value="${escapeHtml(entry.company)}" data-action="update-work-field" data-index="${index}" data-field="company" />
            </div>
            <div class="field">
              <label>Role</label>
              <input type="text" value="${escapeHtml(entry.role)}" data-action="update-work-field" data-index="${index}" data-field="role" />
            </div>
            <div class="field">
              <label>Start Date</label>
              <input type="text" value="${escapeHtml(entry.startDate)}" data-action="update-work-field" data-index="${index}" data-field="startDate" />
            </div>
            <div class="field">
              <label>End Date</label>
              <input type="text" value="${escapeHtml(entry.endDate)}" ${entry.present ? 'disabled' : ''} data-action="update-work-field" data-index="${index}" data-field="endDate" />
            </div>
          </div>
          <div class="inline" style="margin-top: 6px; margin-bottom: 6px;">
            <input type="checkbox" ${entry.present ? 'checked' : ''} data-action="update-work-present" data-index="${index}" id="present-${index}" />
            <label for="present-${index}">Currently in this role</label>
          </div>
          <div class="field-grid one">
            <div class="field">
              <label>Bullet points (one per line)</label>
              <textarea data-action="update-work-bullets" data-index="${index}">${escapeHtml(entry.bullets.join('\n'))}</textarea>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderEducationEntries(entries) {
  if (!entries.length) {
    return '<div class="empty">No education entries yet.</div>';
  }

  return entries
    .map((entry, index) => {
      return `
        <article class="entry-card">
          <div class="entry-head">
            <strong>Education Entry ${index + 1}</strong>
            <button class="btn btn-danger btn-small" data-action="remove-education-entry" data-index="${index}">Remove</button>
          </div>
          <div class="field-grid">
            <div class="field">
              <label>Institution</label>
              <input type="text" value="${escapeHtml(entry.institution)}" data-action="update-education-field" data-index="${index}" data-field="institution" />
            </div>
            <div class="field">
              <label>Degree</label>
              <input type="text" value="${escapeHtml(entry.degree)}" data-action="update-education-field" data-index="${index}" data-field="degree" />
            </div>
            <div class="field">
              <label>Field of Study</label>
              <input type="text" value="${escapeHtml(entry.fieldOfStudy)}" data-action="update-education-field" data-index="${index}" data-field="fieldOfStudy" />
            </div>
            <div class="field">
              <label>Graduation Year</label>
              <input type="text" value="${escapeHtml(entry.graduationYear)}" data-action="update-education-field" data-index="${index}" data-field="graduationYear" />
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderProjectsEntries(entries) {
  if (!entries.length) {
    return '<div class="empty">No project entries yet.</div>';
  }

  return entries
    .map((entry, index) => {
      return `
        <article class="entry-card">
          <div class="entry-head">
            <strong>Project ${index + 1}</strong>
            <button class="btn btn-danger btn-small" data-action="remove-project-entry" data-index="${index}">Remove</button>
          </div>
          <div class="field-grid">
            <div class="field">
              <label>Name</label>
              <input type="text" value="${escapeHtml(entry.name)}" data-action="update-project-field" data-index="${index}" data-field="name" />
            </div>
            <div class="field">
              <label>URL (optional)</label>
              <input type="url" value="${escapeHtml(entry.url)}" data-action="update-project-field" data-index="${index}" data-field="url" />
            </div>
          </div>
          <div class="field-grid one">
            <div class="field">
              <label>Short description</label>
              <textarea data-action="update-project-field" data-index="${index}" data-field="description">${escapeHtml(entry.description)}</textarea>
            </div>
            <div class="field">
              <label>Tags (comma separated)</label>
              <input type="text" value="${escapeHtml(entry.tags.join(', '))}" data-action="update-project-tags" data-index="${index}" />
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderVersionsView(type) {
  return `
    <div class="grid">
      <section class="section-card">
        <div class="section-header">
          <h3>Version History</h3>
          <button class="btn btn-primary btn-small" data-action="create-version">Save Current State as New Version</button>
        </div>
        ${renderVersionsTable(type)}
      </section>
      ${renderSelectedVersionDetail(type)}
    </div>
  `;
}

function renderVersionsTable(type) {
  if (!type.versions.length) {
    return '<div class="empty">No versions saved yet. Save one to checkpoint this CV type.</div>';
  }

  return `
    <table class="table-like">
      <thead>
        <tr>
          <th>Version</th>
          <th>Created</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${type.versions
          .map((version) => {
            const isDefault = type.defaultVersionId === version.id;
            const isSelected = ui.selectedVersionId === version.id;

            return `
              <tr>
                <td>${escapeHtml(version.label)}</td>
                <td>${formatDate(version.createdAt)}</td>
                <td>${isDefault ? '<span class="pill default">Default</span>' : '<span class="pill muted">Saved</span>'}</td>
                <td>
                  <div class="inline">
                    <button class="btn btn-secondary btn-small" data-action="select-version" data-version-id="${version.id}">${isSelected ? 'Selected' : 'View'}</button>
                    <button class="btn btn-ghost btn-small" data-action="set-default-version" data-version-id="${version.id}" ${isDefault ? 'disabled' : ''}>Make Default</button>
                    <button class="btn btn-secondary btn-small" data-action="export-version" data-version-id="${version.id}">Export</button>
                  </div>
                </td>
              </tr>
            `;
          })
          .join('')}
      </tbody>
    </table>
  `;
}

function renderSelectedVersionDetail(type) {
  if (!type.versions.length) {
    return '';
  }

  const selectedVersion = getSelectedVersion(type) || type.versions.at(-1);

  if (!selectedVersion) {
    return '';
  }

  return `
    <section class="section-card">
      <div class="section-header">
        <h3>${escapeHtml(selectedVersion.label)} (Read-only snapshot)</h3>
        <span class="hint">Snapshot data cannot be edited directly.</span>
      </div>

      <div class="field-grid one" style="margin-bottom: 8px;">
        <div class="field">
          <label>Section Visibility Overrides</label>
          <div>
            ${SECTION_META.map((section) => {
              const current = selectedVersion.visibilityOverrides[section.key];
              const selected = current === null ? 'inherit' : current ? 'show' : 'hide';
              return `
                <div class="visibility-row">
                  <div>
                    <strong>${section.label}</strong>
                    <div class="hint">Type default: ${type.visibilityDefaults[section.key] ? 'Visible' : 'Hidden'}</div>
                  </div>
                  <select data-action="update-version-override" data-version-id="${selectedVersion.id}" data-section="${section.key}">
                    <option value="inherit" ${selected === 'inherit' ? 'selected' : ''}>Inherit type default</option>
                    <option value="show" ${selected === 'show' ? 'selected' : ''}>Always show</option>
                    <option value="hide" ${selected === 'hide' ? 'selected' : ''}>Always hide</option>
                  </select>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>

      ${renderVersionSnapshotSummary(selectedVersion)}
    </section>
  `;
}

function renderVersionSnapshotSummary(version) {
  const snapshot = version.snapshot;
  const personal = snapshot.personalInfo;

  return `
    <div class="grid two">
      <article class="card" style="padding: 12px;">
        <h4>Personal</h4>
        <p>${escapeHtml(personal.name || 'No name')} | ${escapeHtml(personal.title || 'No title')}</p>
      </article>
      <article class="card" style="padding: 12px;">
        <h4>Counts</h4>
        <p>
          Work: ${snapshot.workExperience.length} | Education: ${snapshot.education.length} |
          Projects: ${snapshot.projects.length} | Skills: ${snapshot.skills.length}
        </p>
      </article>
    </div>
  `;
}

function renderTypeVisibilityView(type) {
  return `
    <section class="section-card">
      <div class="section-header">
        <h3>Type-level Section Visibility</h3>
        <span class="hint">These defaults are inherited by every version unless overridden.</span>
      </div>
      ${SECTION_META.map((section) => {
        return `
          <div class="visibility-row">
            <div>
              <strong>${section.label}</strong>
            </div>
            <select data-action="update-type-visibility" data-section="${section.key}">
              <option value="show" ${type.visibilityDefaults[section.key] ? 'selected' : ''}>Visible</option>
              <option value="hide" ${!type.visibilityDefaults[section.key] ? 'selected' : ''}>Hidden</option>
            </select>
          </div>
        `;
      }).join('')}
    </section>
  `;
}

function renderExportView(type) {
  const versions = type.versions;
  const exportEntries = Object.entries(state.driveExports)
    .filter(([, details]) => details?.typeId === type.id)
    .sort(([, a], [, b]) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

  return `
    <div class="grid">
      <section class="section-card">
        <div class="section-header">
          <h3>Export to Drive</h3>
          <span class="hint">Files are saved into <code class="inline-code">${escapeHtml(DRIVE_ROOT)}/${escapeHtml(sanitizeNameForPath(type.name))}</code></span>
        </div>

        ${versions.length
          ? `
            <div class="field-grid" style="align-items: end;">
              <div class="field">
                <label>Select Version</label>
                <select data-action="select-export-version">
                  ${versions
                    .map((version) => {
                      return `<option value="${version.id}" ${ui.exportVersionId === version.id ? 'selected' : ''}>${escapeHtml(version.label)}${version.id === type.defaultVersionId ? ' (default)' : ''}</option>`;
                    })
                    .join('')}
                </select>
              </div>
              <div class="field">
                <button class="btn btn-primary" data-action="export-selected-version">Export to Drive</button>
              </div>
            </div>
          `
          : '<div class="empty">Save at least one version before exporting.</div>'}
      </section>

      ${renderExportConfirmation(type)}

      <section class="section-card">
        <h3>Drive Export History</h3>
        ${exportEntries.length
          ? `<div class="grid">
              ${exportEntries
                .map(([pathKey, details]) => {
                  return `
                    <article class="card" style="padding: 12px;">
                      <div><strong>${escapeHtml(pathKey.split('/').pop() || pathKey)}</strong></div>
                      <div class="hint">${formatDate(details.updatedAt)}</div>
                      <div class="link-row" style="margin-top: 8px;">
                        <a href="${escapeHtml(details.link)}" target="_blank" rel="noreferrer">Open link</a>
                        <button class="btn btn-secondary btn-small" data-action="copy-link" data-link="${escapeHtml(details.link)}">Copy Link</button>
                      </div>
                    </article>
                  `;
                })
                .join('')}
            </div>`
          : '<div class="empty">No exports yet for this CV type.</div>'}
      </section>
    </div>
  `;
}

function renderExportConfirmation(type) {
  if (!ui.lastExport || ui.lastExport.typeId !== type.id) {
    return '';
  }

  return `
    <section class="confirmation">
      <strong>Export complete</strong>
      <div>File path: <code class="inline-code">${escapeHtml(ui.lastExport.path)}</code></div>
      <div class="link-row">
        <a href="${escapeHtml(ui.lastExport.link)}" target="_blank" rel="noreferrer">Open stable Drive link</a>
        <button class="btn btn-secondary btn-small" data-action="copy-link" data-link="${escapeHtml(ui.lastExport.link)}">Copy Link</button>
        <button class="btn btn-secondary btn-small" data-action="download-last-export">Download PDF</button>
      </div>
    </section>
  `;
}

function renderLinksDashboard() {
  return `
    <header class="page-header">
      <div>
        <h2 class="page-title">Links Dashboard</h2>
        <p class="page-description">Save useful URLs, open them in one click, and keep your job-search links in one list.</p>
      </div>
      <button class="btn btn-primary" data-action="add-dashboard-link">Add Link</button>
    </header>

    <section class="card">
      ${state.linksDashboard.length
        ? `<div class="grid">
            ${state.linksDashboard
              .map((entry, index) => {
                return `
                  <article class="entry-card">
                    <div class="field-grid">
                      <div class="field">
                        <label>Label</label>
                        <input type="text" value="${escapeHtml(entry.label)}" data-action="update-dashboard-link-label" data-index="${index}" />
                      </div>
                      <div class="field">
                        <label>URL</label>
                        <input type="url" value="${escapeHtml(entry.url)}" data-action="update-dashboard-link-url" data-index="${index}" />
                      </div>
                    </div>
                    <div class="inline" style="margin-top: 10px;">
                      <button class="btn btn-secondary btn-small" data-action="open-dashboard-link" data-index="${index}">Open</button>
                      <button class="btn btn-danger btn-small" data-action="remove-dashboard-link" data-index="${index}">Delete</button>
                    </div>
                  </article>
                `;
              })
              .join('')}
          </div>`
        : '<div class="empty">No saved links yet.</div>'}
    </section>
  `;
}

function renderSettingsView() {
  return `
    <header class="page-header">
      <div>
        <h2 class="page-title">Settings</h2>
        <p class="page-description">Manage integrations and account-level preferences.</p>
      </div>
    </header>

    <div class="grid two">
      <section class="card">
        <h3>Google + Drive</h3>
        <p style="margin-bottom: 12px">Connected with your Google sign-in session.</p>
        <div class="grid">
          <div><strong>Name:</strong> ${escapeHtml(state.auth.name)}</div>
          <div><strong>Email:</strong> ${escapeHtml(state.auth.email)}</div>
          <div>
            <strong>Drive root:</strong>
            <code class="inline-code">${escapeHtml(DRIVE_ROOT)}</code>
          </div>
          <div>
            ${state.auth.driveFolderCreated ? '<span class="pill default">Drive folder created</span>' : '<span class="pill muted">Drive folder pending</span>'}
          </div>
          <div>
            <button class="btn btn-danger" data-action="sign-out">Sign out</button>
          </div>
        </div>
      </section>

      <section class="card">
        <h3>GitHub Import</h3>
        <p style="margin-bottom: 12px">Connect once, then import public repositories into Projects.</p>
        <div class="field-grid one">
          <div class="field">
            <label>GitHub Username</label>
            <input type="text" value="${escapeHtml(ui.githubDraft)}" placeholder="octocat" data-action="update-github-draft" />
          </div>
          <div class="inline">
            <button class="btn btn-primary" data-action="connect-github">${state.github.connected ? 'Update Connection' : 'Connect GitHub'}</button>
            <button class="btn btn-secondary" data-action="disconnect-github" ${state.github.connected ? '' : 'disabled'}>Disconnect</button>
          </div>
          <div>
            ${state.github.connected
              ? `<span class="pill default">Connected as ${escapeHtml(state.github.username)}</span>`
              : '<span class="pill muted">Not connected</span>'}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderModal() {
  if (!ui.modal) {
    modalRoot.innerHTML = '';
    return;
  }

  if (ui.modal.type === 'create-cv') {
    renderCreateCvModal();
    return;
  }

  if (ui.modal.type === 'github-import') {
    renderGithubImportModal();
    return;
  }

  modalRoot.innerHTML = '';
}

function renderCreateCvModal() {
  const modal = ui.modal;

  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal-backdrop">
      <section class="modal" data-action="modal-surface">
        <header class="modal-header">
          <h3>Create CV Type</h3>
          <button class="btn btn-secondary btn-small" data-action="close-modal">Close</button>
        </header>

        <div class="field-grid one">
          <div class="field">
            <label>CV Type Name</label>
            <input type="text" value="${escapeHtml(modal.name)}" placeholder="PM General" data-action="modal-create-name" />
          </div>
        </div>

        <div class="tabs">
          ${renderCreateSourceTab('blank', 'Start Blank')}
          ${renderCreateSourceTab('copy', 'Copy Existing')}
          ${renderCreateSourceTab('import', 'Import JSON')}
        </div>

        ${renderCreateCvModalSourceBody(modal)}

        <div class="inline" style="margin-top: 16px; justify-content: flex-end;">
          <button class="btn btn-secondary" data-action="close-modal">Cancel</button>
          <button class="btn btn-primary" data-action="submit-create-cv">Create CV Type</button>
        </div>
      </section>
    </div>
  `;
}

function renderCreateSourceTab(source, label) {
  const kind = ui.modal?.source === source ? 'btn-primary' : 'btn-secondary';
  return `<button class="btn ${kind} btn-small" data-action="modal-set-source" data-source="${source}">${label}</button>`;
}

function renderCreateCvModalSourceBody(modal) {
  if (modal.source === 'copy') {
    return `
      <div class="field-grid one">
        <div class="field">
          <label>Copy from</label>
          <select data-action="modal-copy-source">
            <option value="">Select an existing CV type</option>
            ${state.cvTypes
              .map((type) => {
                return `<option value="${type.id}" ${modal.copySourceId === type.id ? 'selected' : ''}>${escapeHtml(type.name)}</option>`;
              })
              .join('')}
          </select>
        </div>
      </div>
    `;
  }

  if (modal.source === 'import') {
    return `
      <div class="grid">
        <div class="field-grid one">
          <div class="field">
            <label>Import Prompt</label>
            <div class="import-prompt">${escapeHtml(IMPORT_PROMPT)}</div>
          </div>
        </div>
        <div class="inline">
          <button class="btn btn-secondary btn-small" data-action="copy-import-prompt">Copy Prompt</button>
        </div>
        <div class="field-grid one">
          <div class="field">
            <label>Paste JSON</label>
            <textarea data-action="modal-import-json" placeholder='{"personalInfo": ...}'>${escapeHtml(modal.importJson)}</textarea>
          </div>
        </div>
      </div>
    `;
  }

  return '<p class="hint">Creates an empty CV type with all sections ready to fill.</p>';
}

function renderGithubImportModal() {
  const modal = ui.modal;

  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal-backdrop">
      <section class="modal" data-action="modal-surface">
        <header class="modal-header">
          <h3>Import from GitHub</h3>
          <button class="btn btn-secondary btn-small" data-action="close-modal">Close</button>
        </header>

        <p style="margin-top: 0; margin-bottom: 10px;">
          Pulling public repositories for <strong>${escapeHtml(state.github.username)}</strong>.
        </p>

        <div class="inline" style="margin-bottom: 10px;">
          <button class="btn btn-primary btn-small" data-action="fetch-github-repos" ${modal.loading ? 'disabled' : ''}>${modal.loading ? 'Loading...' : 'Refresh list'}</button>
        </div>

        ${renderGithubRepoList(modal)}
      </section>
    </div>
  `;
}

function renderGithubRepoList(modal) {
  if (modal.error) {
    return `<div class="empty">${escapeHtml(modal.error)}</div>`;
  }

  if (!modal.repos?.length) {
    return '<div class="empty">No repositories loaded yet.</div>';
  }

  return `
    <div class="repo-list">
      ${modal.repos
        .map((repo) => {
          return `
            <article class="repo-item">
              <div>
                <strong>${escapeHtml(repo.name)}</strong>
                <p>${escapeHtml(repo.description || 'No description')}</p>
              </div>
              <button class="btn btn-secondary btn-small" data-action="import-repo" data-repo-name="${escapeHtml(repo.name)}" data-repo-url="${escapeHtml(repo.url)}" data-repo-description="${escapeHtml(repo.description || '')}">Add</button>
            </article>
          `;
        })
        .join('')}
    </div>
  `;
}

function handleClick(event) {
  const actionable = resolveActionableElement(event);

  if (!actionable) {
    return;
  }

  const action = actionable.dataset.action;

  switch (action) {
    case 'modal-surface':
      return;
    case 'close-modal-backdrop':
      ui.modal = null;
      renderModal();
      return;
    case 'google-sign-in':
      signInWithGoogle();
      return;
    case 'set-main-view':
      ui.mainView = actionable.dataset.view || 'cvTypes';
      render();
      return;
    case 'open-create-cv-modal':
      ui.modal = {
        type: 'create-cv',
        source: 'blank',
        name: '',
        copySourceId: state.cvTypes[0]?.id || '',
        importJson: ''
      };
      renderModal();
      return;
    case 'close-modal':
      ui.modal = null;
      renderModal();
      return;
    case 'modal-set-source':
      if (ui.modal?.type === 'create-cv') {
        ui.modal.source = actionable.dataset.source || 'blank';
        renderModal();
      }
      return;
    case 'submit-create-cv':
      submitCreateCvType();
      return;
    case 'copy-import-prompt':
      copyText(IMPORT_PROMPT, 'Import prompt copied.');
      return;
    case 'select-cv-type':
      ui.selectedTypeId = actionable.dataset.typeId || null;
      ui.selectedVersionId = null;
      ensureTypeSelection();
      render();
      return;
    case 'rename-cv-type':
      event.stopPropagation();
      renameCvType(actionable.dataset.typeId || '');
      return;
    case 'delete-cv-type':
      event.stopPropagation();
      deleteCvType(actionable.dataset.typeId || '');
      return;
    case 'set-cv-sub-view':
      ui.cvSubView = actionable.dataset.subView || 'form';
      render();
      return;
    case 'add-work-entry':
      withSelectedType((type) => {
        type.data.workExperience.push(createBlankWorkExperienceEntry());
      }, { rerender: true, toast: 'Work entry added.' });
      return;
    case 'remove-work-entry':
      withSelectedType((type) => {
        const index = Number(actionable.dataset.index);
        type.data.workExperience.splice(index, 1);
      }, { rerender: true, toast: 'Work entry removed.' });
      return;
    case 'add-education-entry':
      withSelectedType((type) => {
        type.data.education.push(createBlankEducationEntry());
      }, { rerender: true, toast: 'Education entry added.' });
      return;
    case 'remove-education-entry':
      withSelectedType((type) => {
        const index = Number(actionable.dataset.index);
        type.data.education.splice(index, 1);
      }, { rerender: true, toast: 'Education entry removed.' });
      return;
    case 'add-project-entry':
      withSelectedType((type) => {
        type.data.projects.push(createBlankProjectEntry());
      }, { rerender: true, toast: 'Project entry added.' });
      return;
    case 'remove-project-entry':
      withSelectedType((type) => {
        const index = Number(actionable.dataset.index);
        type.data.projects.splice(index, 1);
      }, { rerender: true, toast: 'Project entry removed.' });
      return;
    case 'create-version':
      createVersion();
      return;
    case 'select-version':
      ui.selectedVersionId = actionable.dataset.versionId || null;
      render();
      return;
    case 'set-default-version':
      setDefaultVersion(actionable.dataset.versionId || '');
      return;
    case 'export-version':
      exportVersion(actionable.dataset.versionId || '');
      return;
    case 'export-selected-version':
      exportVersion(ui.exportVersionId || '');
      return;
    case 'download-last-export':
      downloadLastExport();
      return;
    case 'copy-link':
      copyText(actionable.dataset.link || '', 'Link copied.');
      return;
    case 'add-dashboard-link':
      state.linksDashboard.push({ id: makeId('dash-link'), label: '', url: '' });
      persist();
      render();
      return;
    case 'remove-dashboard-link':
      removeDashboardLink(actionable.dataset.index);
      return;
    case 'open-dashboard-link':
      openDashboardLink(actionable.dataset.index);
      return;
    case 'sign-out':
      signOut();
      return;
    case 'connect-github':
      connectGithub();
      return;
    case 'disconnect-github':
      disconnectGithub();
      return;
    case 'open-github-import-modal':
      openGithubImportModal();
      return;
    case 'fetch-github-repos':
      fetchGithubRepos();
      return;
    case 'import-repo':
      importRepoIntoProjects(actionable.dataset);
      return;
    default:
      return;
  }
}

function handleInput(event) {
  const action = event.target.dataset.action;

  switch (action) {
    case 'auth-draft-name':
      ui.authDraft.name = event.target.value;
      return;
    case 'auth-draft-email':
      ui.authDraft.email = event.target.value;
      return;
    case 'modal-create-name':
      if (ui.modal?.type === 'create-cv') {
        ui.modal.name = event.target.value;
      }
      return;
    case 'modal-import-json':
      if (ui.modal?.type === 'create-cv') {
        ui.modal.importJson = event.target.value;
      }
      return;
    case 'update-github-draft':
      ui.githubDraft = event.target.value;
      return;
    case 'update-personal-field':
      withSelectedType((type) => {
        const field = event.target.dataset.field;
        if (field in type.data.personalInfo) {
          type.data.personalInfo[field] = event.target.value;
        }
      });
      return;
    case 'update-work-field':
      withSelectedType((type) => {
        const index = Number(event.target.dataset.index);
        const field = event.target.dataset.field;
        const entry = type.data.workExperience[index];

        if (!entry || !field) {
          return;
        }

        entry[field] = event.target.value;
      });
      return;
    case 'update-work-bullets':
      withSelectedType((type) => {
        const index = Number(event.target.dataset.index);
        const entry = type.data.workExperience[index];

        if (!entry) {
          return;
        }

        entry.bullets = splitMultiline(event.target.value);
      });
      return;
    case 'update-education-field':
      withSelectedType((type) => {
        const index = Number(event.target.dataset.index);
        const field = event.target.dataset.field;
        const entry = type.data.education[index];

        if (!entry || !field) {
          return;
        }

        entry[field] = event.target.value;
      });
      return;
    case 'update-skills':
      withSelectedType((type) => {
        type.data.skills = splitCsv(event.target.value);
      });
      return;
    case 'update-project-field':
      withSelectedType((type) => {
        const index = Number(event.target.dataset.index);
        const field = event.target.dataset.field;
        const entry = type.data.projects[index];

        if (!entry || !field) {
          return;
        }

        entry[field] = event.target.value;
      });
      return;
    case 'update-project-tags':
      withSelectedType((type) => {
        const index = Number(event.target.dataset.index);
        const entry = type.data.projects[index];

        if (!entry) {
          return;
        }

        entry.tags = splitCsv(event.target.value);
      });
      return;
    case 'update-cv-links':
      withSelectedType((type) => {
        type.data.links = splitMultiline(event.target.value);
      });
      return;
    case 'update-dashboard-link-label':
      updateDashboardLinkField(event.target.dataset.index, 'label', event.target.value);
      return;
    case 'update-dashboard-link-url':
      updateDashboardLinkField(event.target.dataset.index, 'url', event.target.value);
      return;
    default:
      return;
  }
}

function handleChange(event) {
  const action = event.target.dataset.action;

  switch (action) {
    case 'modal-copy-source':
      if (ui.modal?.type === 'create-cv') {
        ui.modal.copySourceId = event.target.value;
      }
      return;
    case 'update-work-present':
      withSelectedType((type) => {
        const index = Number(event.target.dataset.index);
        const entry = type.data.workExperience[index];

        if (!entry) {
          return;
        }

        entry.present = event.target.checked;

        if (entry.present) {
          entry.endDate = '';
        }
      }, { rerender: true });
      return;
    case 'update-type-visibility':
      withSelectedType((type) => {
        const section = event.target.dataset.section;
        if (!section) {
          return;
        }
        type.visibilityDefaults[section] = event.target.value === 'show';
      }, { rerender: true, toast: 'Type visibility updated.' });
      return;
    case 'update-version-override':
      updateVersionOverride(event.target.dataset, event.target.value);
      return;
    case 'select-export-version':
      ui.exportVersionId = event.target.value || null;
      persist();
      return;
    default:
      return;
  }
}

function signInWithGoogle() {
  const name = ui.authDraft.name.trim();
  const email = ui.authDraft.email.trim();

  if (!name || !email) {
    showToast('Enter name and email to continue.');
    return;
  }

  state.auth.signedIn = true;
  state.auth.name = name;
  state.auth.email = email;
  state.auth.driveFolderCreated = true;
  state.auth.driveRoot = DRIVE_ROOT;

  persist();
  render();
  showToast(`Signed in. ${DRIVE_ROOT} created in Drive.`);
}

function signOut() {
  state.auth.signedIn = false;
  state.auth.name = '';
  state.auth.email = '';
  ui.authDraft = { name: '', email: '' };
  ui.mainView = 'cvTypes';

  persist();
  render();
}

function submitCreateCvType() {
  if (!ui.modal || ui.modal.type !== 'create-cv') {
    return;
  }

  const result = buildCvTypeFromModal({
    modal: ui.modal,
    existingTypes: state.cvTypes,
    makeId
  });

  if (!result.ok) {
    showToast(result.error);
    return;
  }

  const cvType = result.cvType;

  state.cvTypes.push(cvType);
  ui.selectedTypeId = cvType.id;
  ui.cvSubView = 'form';
  ui.modal = null;

  persist();
  render();
  showToast(`Created CV type: ${cvType.name}`);
}

function renameCvType(typeId) {
  const type = state.cvTypes.find((item) => item.id === typeId);

  if (!type) {
    return;
  }

  const nextName = window.prompt('Rename CV type', type.name);

  if (nextName === null) {
    return;
  }

  const trimmed = nextName.trim();

  if (!trimmed) {
    showToast('Name cannot be empty.');
    return;
  }

  if (
    state.cvTypes.some((item) => item.id !== type.id && item.name.toLowerCase() === trimmed.toLowerCase())
  ) {
    showToast('A CV type with that name already exists.');
    return;
  }

  type.name = trimmed;
  persist();
  render();
  showToast('CV type renamed.');
}

function deleteCvType(typeId) {
  const type = state.cvTypes.find((item) => item.id === typeId);

  if (!type) {
    return;
  }

  const confirmed = window.confirm(`Delete "${type.name}" and all versions?`);

  if (!confirmed) {
    return;
  }

  state.cvTypes = state.cvTypes.filter((item) => item.id !== typeId);

  if (ui.lastExport?.typeId === typeId && ui.lastExport.downloadUrl) {
    URL.revokeObjectURL(ui.lastExport.downloadUrl);
    ui.lastExport = null;
  }

  ensureTypeSelection();
  persist();
  render();
  showToast('CV type deleted.');
}

function withSelectedType(mutator, options = {}) {
  const type = getSelectedType();

  if (!type) {
    return;
  }

  mutator(type);
  persist();

  if (options.rerender) {
    render();
  }

  if (options.toast) {
    showToast(options.toast);
  }
}

function getSelectedType() {
  return state.cvTypes.find((type) => type.id === ui.selectedTypeId) || null;
}

function getSelectedVersion(type) {
  if (!type) {
    return null;
  }

  return type.versions.find((version) => version.id === ui.selectedVersionId) || null;
}

function createVersion() {
  const type = getSelectedType();

  if (!type) {
    return;
  }

  const newVersion = makeVersionRecord({
    existingVersions: type.versions,
    data: type.data,
    makeId
  });

  type.versions.push(newVersion);

  if (!type.defaultVersionId) {
    type.defaultVersionId = newVersion.id;
  }

  ui.selectedVersionId = newVersion.id;
  ui.exportVersionId = newVersion.id;

  persist();
  render();
  showToast(`${newVersion.label} saved.`);
}

function setDefaultVersion(versionId) {
  const type = getSelectedType();

  if (!type) {
    return;
  }

  const version = type.versions.find((item) => item.id === versionId);

  if (!version) {
    showToast('Version not found.');
    return;
  }

  type.defaultVersionId = version.id;
  persist();
  render();
  showToast(`${version.label} is now default.`);
}

function updateVersionOverride(dataset, value) {
  const versionId = dataset.versionId;
  const section = dataset.section;

  if (!versionId || !section) {
    return;
  }

  const type = getSelectedType();

  if (!type) {
    return;
  }

  const version = type.versions.find((item) => item.id === versionId);

  if (!version) {
    return;
  }

  version.visibilityOverrides[section] = value === 'inherit' ? null : value === 'show';

  persist();
  showToast('Version visibility override updated.');
}

function exportVersion(versionId) {
  const type = getSelectedType();

  if (!type) {
    return;
  }

  const version = type.versions.find((item) => item.id === versionId);

  if (!version) {
    showToast('Save a version first.');
    return;
  }

  const folderPath = `${DRIVE_ROOT}/${sanitizeNameForPath(type.name)}`;
  const fileName = `${type.name} - ${version.label}.pdf`;
  const fullPath = `${folderPath}/${fileName}`;

  const existing = state.driveExports[fullPath];
  const stableLink = existing?.link || `https://drive.google.com/file/d/${makeStableId(fullPath)}/view?usp=sharing`;

  const visibility = getEffectiveVisibility(type, version);
  const contentLines = buildPdfContentLines(type, version, visibility);
  const pdfBytes = createSimplePdf(contentLines);
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const downloadUrl = URL.createObjectURL(blob);

  if (ui.lastExport?.downloadUrl) {
    URL.revokeObjectURL(ui.lastExport.downloadUrl);
  }

  ui.lastExport = {
    typeId: type.id,
    versionId: version.id,
    path: fullPath,
    link: stableLink,
    fileName,
    downloadUrl,
    updatedAt: new Date().toISOString()
  };

  state.driveExports[fullPath] = {
    typeId: type.id,
    versionId: version.id,
    link: stableLink,
    updatedAt: new Date().toISOString()
  };

  ui.exportVersionId = version.id;

  persist();
  render();
  showToast(`${version.label} exported. Stable Drive link ready.`);
}

function getEffectiveVisibility(type, version) {
  return mergeVisibility({
    defaults: type.visibilityDefaults,
    overrides: version.visibilityOverrides
  });
}

function buildPdfContentLines(type, version, visibility) {
  const lines = [`${type.name} | ${version.label}`, `Generated: ${formatDate(version.createdAt)}`, ''];
  const data = version.snapshot;

  if (visibility.personalInfo) {
    lines.push('PERSONAL INFO');
    lines.push(`Name: ${data.personalInfo.name || '-'}`);
    lines.push(`Title: ${data.personalInfo.title || '-'}`);
    lines.push(`Email: ${data.personalInfo.email || '-'}`);
    lines.push(`Phone: ${data.personalInfo.phone || '-'}`);
    lines.push(`Location: ${data.personalInfo.location || '-'}`);
    lines.push(`LinkedIn: ${data.personalInfo.linkedinUrl || '-'}`);
    lines.push(`GitHub: ${data.personalInfo.githubUrl || '-'}`);
    lines.push(`Website: ${data.personalInfo.website || '-'}`);
    lines.push('');
  }

  if (visibility.workExperience) {
    lines.push('WORK EXPERIENCE');
    if (!data.workExperience.length) {
      lines.push('- None');
    }
    data.workExperience.forEach((entry) => {
      lines.push(`- ${entry.role || '-'} at ${entry.company || '-'}`);
      lines.push(`  ${entry.startDate || '-'} to ${entry.present ? 'Present' : entry.endDate || '-'}`);
      (entry.bullets || []).forEach((bullet) => lines.push(`  * ${bullet}`));
    });
    lines.push('');
  }

  if (visibility.education) {
    lines.push('EDUCATION');
    if (!data.education.length) {
      lines.push('- None');
    }
    data.education.forEach((entry) => {
      lines.push(`- ${entry.degree || '-'}, ${entry.fieldOfStudy || '-'}`);
      lines.push(`  ${entry.institution || '-'} (${entry.graduationYear || '-'})`);
    });
    lines.push('');
  }

  if (visibility.skills) {
    lines.push('SKILLS');
    lines.push(data.skills.length ? data.skills.join(', ') : '- None');
    lines.push('');
  }

  if (visibility.projects) {
    lines.push('PROJECTS');
    if (!data.projects.length) {
      lines.push('- None');
    }
    data.projects.forEach((project) => {
      lines.push(`- ${project.name || '-'}`);
      lines.push(`  ${project.description || '-'}`);
      if (project.url) {
        lines.push(`  URL: ${project.url}`);
      }
      if (project.tags?.length) {
        lines.push(`  Tags: ${project.tags.join(', ')}`);
      }
    });
    lines.push('');
  }

  if (visibility.links) {
    lines.push('LINKS');
    if (!data.links.length) {
      lines.push('- None');
    }
    data.links.forEach((link) => lines.push(`- ${link}`));
  }

  return lines;
}

function createSimplePdf(lines) {
  const safeLines = lines
    .map((line) => line.slice(0, 110))
    .map((line) => escapePdfText(line))
    .slice(0, 46);

  let content = 'BT\n/F1 10 Tf\n72 760 Td\n';

  safeLines.forEach((line, index) => {
    if (index > 0) {
      content += '0 -14 Td\n';
    }
    content += `(${line}) Tj\n`;
  });

  content += 'ET';

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach((objectBody, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${objectBody}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';

  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

function escapePdfText(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r?\n/g, ' ');
}

function downloadLastExport() {
  if (!ui.lastExport?.downloadUrl) {
    showToast('No export file available for download.');
    return;
  }

  const anchor = document.createElement('a');
  anchor.href = ui.lastExport.downloadUrl;
  anchor.download = ui.lastExport.fileName;
  anchor.click();
}

function removeDashboardLink(indexValue) {
  const index = Number(indexValue);

  if (!Number.isInteger(index) || index < 0 || index >= state.linksDashboard.length) {
    return;
  }

  state.linksDashboard.splice(index, 1);
  persist();
  render();
}

function openDashboardLink(indexValue) {
  const index = Number(indexValue);
  const entry = state.linksDashboard[index];

  if (!entry?.url) {
    showToast('Add a URL first.');
    return;
  }

  const url = normalizeUrl(entry.url);
  window.open(url, '_blank', 'noopener,noreferrer');
}

function updateDashboardLinkField(indexValue, field, nextValue) {
  const index = Number(indexValue);
  const entry = state.linksDashboard[index];

  if (!entry || !(field in entry)) {
    return;
  }

  entry[field] = nextValue;
  persist();
}

function connectGithub() {
  const username = ui.githubDraft.trim();

  if (!username) {
    showToast('Enter a GitHub username.');
    return;
  }

  state.github.connected = true;
  state.github.username = username;
  persist();
  render();
  showToast(`GitHub connected as ${username}.`);
}

function disconnectGithub() {
  state.github.connected = false;
  state.github.username = '';
  ui.githubDraft = '';

  persist();
  render();
  showToast('GitHub disconnected.');
}

function openGithubImportModal() {
  const type = getSelectedType();

  if (!type) {
    showToast('Select a CV type first.');
    return;
  }

  if (!state.github.connected || !state.github.username) {
    showToast('Connect GitHub in Settings first.');
    ui.mainView = 'settings';
    render();
    return;
  }

  ui.modal = {
    type: 'github-import',
    loading: false,
    repos: [],
    error: ''
  };

  renderModal();
  fetchGithubRepos();
}

async function fetchGithubRepos() {
  if (!ui.modal || ui.modal.type !== 'github-import') {
    return;
  }

  ui.modal.loading = true;
  ui.modal.error = '';
  renderModal();

  try {
    const endpoint = `https://api.github.com/users/${encodeURIComponent(state.github.username)}/repos?sort=updated&per_page=100`;
    const response = await fetch(endpoint);

    if (!response.ok) {
      throw new Error(`GitHub request failed with status ${response.status}`);
    }

    const repositories = await response.json();

    ui.modal.repos = Array.isArray(repositories)
      ? repositories.map((repo) => ({
          name: safeString(repo?.name),
          description: safeString(repo?.description),
          url: safeString(repo?.html_url)
        }))
      : [];

    ui.modal.loading = false;
    renderModal();
  } catch (error) {
    ui.modal.loading = false;
    ui.modal.error = 'Could not fetch public repositories. Check username and network access.';
    renderModal();
  }
}

function importRepoIntoProjects(dataset) {
  const type = getSelectedType();

  if (!type) {
    return;
  }

  type.data.projects.push({
    name: safeString(dataset.repoName),
    url: safeString(dataset.repoUrl),
    description: safeString(dataset.repoDescription),
    tags: ['github']
  });

  persist();
  render();
  ui.modal = null;
  renderModal();
  showToast('Repository imported into Projects.');
}

function updateTypeVisibility(section, value) {
  withSelectedType((type) => {
    type.visibilityDefaults[section] = value;
  });
}

function createDefaultVisibility() {
  const visibility = {};

  for (const section of SECTION_META) {
    visibility[section.key] = true;
  }

  return visibility;
}

function createEmptyVisibilityOverrides() {
  const overrides = {};

  for (const section of SECTION_META) {
    overrides[section.key] = null;
  }

  return overrides;
}

function createEmptyCvData() {
  return {
    personalInfo: {
      name: '',
      title: '',
      email: '',
      phone: '',
      location: '',
      linkedinUrl: '',
      githubUrl: '',
      website: ''
    },
    workExperience: [],
    education: [],
    skills: [],
    projects: [],
    links: []
  };
}

function createBlankWorkExperienceEntry() {
  return {
    company: '',
    role: '',
    startDate: '',
    endDate: '',
    present: false,
    bullets: []
  };
}

function createBlankEducationEntry() {
  return {
    institution: '',
    degree: '',
    fieldOfStudy: '',
    graduationYear: ''
  };
}

function createBlankProjectEntry() {
  return {
    name: '',
    url: '',
    description: '',
    tags: []
  };
}

function splitCsv(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function splitMultiline(value) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function makeId(prefix = 'id') {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeStableId(seed) {
  let hash = 0;

  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }

  return `mock${Math.abs(hash)}`;
}

function sanitizeNameForPath(value) {
  const trimmed = value.trim();

  if (!trimmed) {
    return 'Untitled CV';
  }

  return trimmed.replace(/[\\/:*?"<>|]/g, '-');
}

function normalizeUrl(url) {
  const trimmed = url.trim();

  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function formatDate(iso) {
  if (!iso) {
    return '-';
  }

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return date.toLocaleString();
}

function showToast(message) {
  if (!message) {
    return;
  }

  toastEl.textContent = message;
  toastEl.classList.add('show');

  if (ui.toastTimer) {
    clearTimeout(ui.toastTimer);
  }

  ui.toastTimer = window.setTimeout(() => {
    toastEl.classList.remove('show');
  }, 2200);
}

async function copyText(text, successMessage) {
  if (!text) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage || 'Copied.');
  } catch {
    showToast('Clipboard copy failed.');
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
