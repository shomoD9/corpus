/*
  This file is the main editor surface for the Corpus Chrome extension.
  It exists as a single orchestrator because the editor's value comes from coordinating many concerns
  at once: rendering views, handling user input, scheduling sync, and invoking runtime commands.
  It talks to schema constants from `../common/*`, runtime messaging via `runtime.js`, and the new
  local-first sync lifecycle via `sync_controller.js` and `lifecycle_flush.js`.
*/

import { FIELD_KEYS } from '../common/schema.js';
import { sendRuntimeCommand } from './runtime.js';
import { FORM_LABELS } from './form_labels.js';
import { IMPORT_FLOW_STEPS, IMPORT_PROMPT } from './import_prompt.js';
import { createPerfTracker } from './perf.js';
import { registerLifecycleFlush } from './lifecycle_flush.js';
import { createSyncController } from './sync_controller.js';
import {
  createEmptyEducation,
  createEmptyProject,
  createEmptyWorkExperience,
  joinListForCsv,
  joinListForTextarea,
  splitCsvToList,
  splitLinesToList
} from './form_entries.js';

const appEl = document.getElementById('app');
const toastEl = document.getElementById('toast');

const ui = {
  authRequired: true,
  mainView: 'cvTypes',
  cvSubView: 'form',
  selectedTypeId: '',
  selectedVersionId: '',
  modal: null,
  exportVersionId: '',
  toastTimer: null,
  syncStatus: 'saved'
};

let appState = null;
const perf = createPerfTracker();
const syncController = createSyncController({
  sendCommand: sendUserCommand,
  onStatus: (status) => {
    ui.syncStatus = status;
    perf.markSync('status', { status });
    updateSyncStatusBadge();
  },
  onState: (nextState) => {
    if (!nextState) {
      return;
    }
    setAppState(nextState);
  },
  onError: (error) => {
    showToast(error?.message || 'Sync failed. Local draft is safe.');
  }
});

appEl.addEventListener('click', onClick);
appEl.addEventListener('input', onInput);
appEl.addEventListener('change', onChange);

registerLifecycleFlush({
  onFlush: async (reason) => {
    if (!ui.authRequired && syncController.hasPendingDrafts()) {
      await syncController.flush(reason);
    }
  }
});

initialize();

async function initialize() {
  await loadState();
  render();
}

async function loadState() {
  try {
    const data = await sendRuntimeCommand('STATE_LOAD', {});
    // We overlay local drafts on top of remote state so reloads never discard unsynced edits.
    const restoredState = await syncController.restoreDrafts(data.state);
    setAppState(restoredState);
    ui.authRequired = false;
    ensureTypeSelection();
  } catch (error) {
    if (error.code === 'AUTH_REQUIRED') {
      ui.authRequired = true;
      appState = null;
      ui.syncStatus = 'saved';
      return;
    }

    showToast(error.message || 'Failed to load state.');
  }
}

function render() {
  if (ui.authRequired) {
    renderAuth();
    return;
  }

  ensureTypeSelection();

  // The editor uses full-template rendering for now; sync work is isolated so UI stays responsive.
  appEl.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div>
          <div class="brand">Corpus</div>
          <div class="brand-sub muted">CV Studio</div>
        </div>
        <nav class="sidebar-nav">
          <button class="nav-btn ${ui.mainView === 'cvTypes' ? 'active' : ''}" data-action="set-main" data-view="cvTypes">CV Types</button>
          <button class="nav-btn ${ui.mainView === 'links' ? 'active' : ''}" data-action="set-main" data-view="links">Links Dashboard</button>
          <button class="nav-btn ${ui.mainView === 'settings' ? 'active' : ''}" data-action="set-main" data-view="settings">Settings</button>
        </nav>
        <div class="sidebar-foot muted">Drive-backed extension workspace</div>
      </aside>
      <main class="main">${renderMainView()}</main>
    </div>
    ${renderModal()}
  `;

  updateSyncStatusBadge();
  perf.markRender('app-render');
}

function renderAuth() {
  appEl.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card stack">
        <h2>Sign in to Corpus</h2>
        <p class="muted">Use Google sign-in to connect Drive and load your CV workspace.</p>
        <div class="row">
          <button class="btn btn-primary" data-action="sign-in">Sign in with Google</button>
        </div>
      </div>
    </div>
  `;

  perf.markRender('auth-render');
}

function renderMainView() {
  if (!appState) {
    return '<div class="empty">Loading...</div>';
  }

  if (ui.mainView === 'links') {
    return renderLinksDashboard();
  }

  if (ui.mainView === 'settings') {
    return renderSettings();
  }

  return renderCvTypesWorkspace();
}

function renderCvTypesWorkspace() {
  const selectedType = getSelectedType();

  return `
    <div class="page-header">
      <h2>CV Types</h2>
      <button class="btn btn-primary" data-action="open-create-modal">Create CV Type</button>
    </div>

    <div class="layout">
      <section class="card stack">
        ${appState.cvTypes.length
          ? appState.cvTypes.map((type) => renderTypeRow(type)).join('')
          : '<div class="empty">No CV types yet.</div>'}
      </section>

      <section class="card">
        ${selectedType ? renderSelectedType(selectedType) : '<div class="empty">Select or create a CV type.</div>'}
      </section>
    </div>
  `;
}

function renderTypeRow(type) {
  const active = type.id === ui.selectedTypeId ? 'active' : '';

  return `
    <article class="type-item ${active}">
      <div class="row" style="justify-content: space-between;">
        <strong>${escapeHtml(type.name)}</strong>
        <span class="muted">${type.versions.length} versions</span>
      </div>
      <div class="row" style="margin-top: 8px;">
        <button class="btn btn-small" data-action="select-type" data-type-id="${type.id}">Open</button>
        <button class="btn btn-small" data-action="rename-type" data-type-id="${type.id}">Rename</button>
        <button class="btn btn-small" data-action="delete-type" data-type-id="${type.id}">Delete</button>
      </div>
    </article>
  `;
}

function renderSelectedType(cvType) {
  return `
    <div class="page-header">
      <div>
        <h3>${escapeHtml(cvType.name)}</h3>
        <div class="muted">Default version: ${escapeHtml(cvType.defaultVersionId || 'Not set')}</div>
        <div class="sync-status-wrap">
          <span id="sync-status" class="sync-status sync-status-${escapeHtml(ui.syncStatus)}">${escapeHtml(getSyncStatusLabel(ui.syncStatus))}</span>
        </div>
      </div>
    </div>

    <nav class="subnav">
      ${renderSubnavButton('form', 'Form')}
      ${renderSubnavButton('versions', 'Versions')}
      ${renderSubnavButton('fieldVisibility', 'Field Visibility')}
      ${renderSubnavButton('export', 'Export')}
    </nav>

    ${renderCvSubview(cvType)}
  `;
}

function renderSubnavButton(view, label) {
  const className = ui.cvSubView === view ? 'btn btn-primary' : 'btn';
  return `<button class="${className}" data-action="set-cv-sub" data-sub-view="${view}">${label}</button>`;
}

function renderCvSubview(cvType) {
  if (ui.cvSubView === 'versions') {
    return renderVersionsView(cvType);
  }

  if (ui.cvSubView === 'fieldVisibility') {
    return renderFieldVisibilityView(cvType);
  }

  if (ui.cvSubView === 'export') {
    return renderExportView(cvType);
  }

  return renderFormView(cvType);
}

function renderFormView(cvType) {
  const data = cvType.data;

  return `
    <div class="stack">
      <div class="grid-two">
        ${renderPersonalField('name', 'Name', data.personalInfo.name)}
        ${renderPersonalField('title', 'Title', data.personalInfo.title)}
        ${renderPersonalField('email', 'Email', data.personalInfo.email)}
        ${renderPersonalField('phone', 'Phone', data.personalInfo.phone)}
        ${renderPersonalField('location', 'Location', data.personalInfo.location)}
        ${renderPersonalField('linkedinUrl', 'LinkedIn URL', data.personalInfo.linkedinUrl)}
        ${renderPersonalField('githubUrl', 'GitHub URL', data.personalInfo.githubUrl)}
        ${renderPersonalField('website', 'Website', data.personalInfo.website)}
      </div>

      <div class="field">
        <label>${FORM_LABELS.skills}</label>
        <input type="text" data-action="update-skills" value="${escapeHtml(joinListForCsv(data.skills))}" />
      </div>

      <div class="field">
        <label>${FORM_LABELS.links}</label>
        <textarea data-action="update-links">${escapeHtml(joinListForTextarea(data.links))}</textarea>
      </div>

      ${renderWorkExperienceSection(data.workExperience)}
      ${renderEducationSection(data.education)}
      ${renderProjectsSection(data.projects)}
    </div>
  `;
}

function renderPersonalField(key, label, value) {
  return `
    <div class="field">
      <label>${label}</label>
      <input type="text" value="${escapeHtml(value || '')}" data-action="update-personal" data-key="${key}" />
    </div>
  `;
}

function renderWorkExperienceSection(entries) {
  return `
    <section class="entry-section">
      <div class="row entry-header">
        <h4>${FORM_LABELS.workExperience}</h4>
        <button class="btn btn-small" data-action="add-work-entry">Add Role</button>
      </div>
      ${entries.length ? entries.map((entry, index) => renderWorkEntry(entry, index)).join('') : '<div class="empty">No work experience added yet.</div>'}
    </section>
  `;
}

function renderWorkEntry(entry, index) {
  return `
    <article class="entry-card stack">
      <div class="row entry-title">
        <strong>Role ${index + 1}</strong>
        <button class="btn btn-small" data-action="remove-work-entry" data-index="${index}">Remove</button>
      </div>
      <div class="grid-two">
        <div class="field">
          <label>Company</label>
          <input type="text" value="${escapeHtml(entry.company)}" data-action="update-work-field" data-index="${index}" data-key="company" />
        </div>
        <div class="field">
          <label>Role</label>
          <input type="text" value="${escapeHtml(entry.role)}" data-action="update-work-field" data-index="${index}" data-key="role" />
        </div>
        <div class="field">
          <label>Start Date</label>
          <input type="text" value="${escapeHtml(entry.startDate)}" data-action="update-work-field" data-index="${index}" data-key="startDate" />
        </div>
        <div class="field">
          <label>End Date</label>
          <input type="text" value="${escapeHtml(entry.endDate)}" data-action="update-work-field" data-index="${index}" data-key="endDate" />
        </div>
      </div>
      <label class="checkbox-row">
        <input type="checkbox" data-action="update-work-present" data-index="${index}" ${entry.present ? 'checked' : ''} />
        <span>Current role</span>
      </label>
      <div class="field">
        <label>Highlights</label>
        <textarea data-action="update-work-bullets" data-index="${index}">${escapeHtml(joinListForTextarea(entry.bullets || []))}</textarea>
      </div>
    </article>
  `;
}

function renderEducationSection(entries) {
  return `
    <section class="entry-section">
      <div class="row entry-header">
        <h4>${FORM_LABELS.education}</h4>
        <button class="btn btn-small" data-action="add-education-entry">Add Education</button>
      </div>
      ${entries.length ? entries.map((entry, index) => renderEducationEntry(entry, index)).join('') : '<div class="empty">No education added yet.</div>'}
    </section>
  `;
}

function renderEducationEntry(entry, index) {
  return `
    <article class="entry-card stack">
      <div class="row entry-title">
        <strong>Education ${index + 1}</strong>
        <button class="btn btn-small" data-action="remove-education-entry" data-index="${index}">Remove</button>
      </div>
      <div class="grid-two">
        <div class="field">
          <label>Institution</label>
          <input type="text" value="${escapeHtml(entry.institution)}" data-action="update-education-field" data-index="${index}" data-key="institution" />
        </div>
        <div class="field">
          <label>Degree</label>
          <input type="text" value="${escapeHtml(entry.degree)}" data-action="update-education-field" data-index="${index}" data-key="degree" />
        </div>
        <div class="field">
          <label>Field of Study</label>
          <input type="text" value="${escapeHtml(entry.fieldOfStudy)}" data-action="update-education-field" data-index="${index}" data-key="fieldOfStudy" />
        </div>
        <div class="field">
          <label>Graduation Year</label>
          <input type="text" value="${escapeHtml(entry.graduationYear)}" data-action="update-education-field" data-index="${index}" data-key="graduationYear" />
        </div>
      </div>
    </article>
  `;
}

function renderProjectsSection(entries) {
  return `
    <section class="entry-section">
      <div class="row entry-header">
        <h4>${FORM_LABELS.projects}</h4>
        <button class="btn btn-small" data-action="add-project-entry">Add Project</button>
      </div>
      ${entries.length ? entries.map((entry, index) => renderProjectEntry(entry, index)).join('') : '<div class="empty">No projects added yet.</div>'}
    </section>
  `;
}

function renderProjectEntry(entry, index) {
  return `
    <article class="entry-card stack">
      <div class="row entry-title">
        <strong>Project ${index + 1}</strong>
        <button class="btn btn-small" data-action="remove-project-entry" data-index="${index}">Remove</button>
      </div>
      <div class="grid-two">
        <div class="field">
          <label>Name</label>
          <input type="text" value="${escapeHtml(entry.name)}" data-action="update-project-field" data-index="${index}" data-key="name" />
        </div>
        <div class="field">
          <label>URL</label>
          <input type="text" value="${escapeHtml(entry.url)}" data-action="update-project-field" data-index="${index}" data-key="url" />
        </div>
      </div>
      <div class="field">
        <label>Description</label>
        <textarea data-action="update-project-field" data-index="${index}" data-key="description">${escapeHtml(entry.description)}</textarea>
      </div>
      <div class="field">
        <label>Tags</label>
        <input type="text" value="${escapeHtml(joinListForCsv(entry.tags || []))}" data-action="update-project-tags" data-index="${index}" />
      </div>
    </article>
  `;
}

function renderVersionsView(cvType) {
  return `
    <div class="stack">
      <div class="row">
        <button class="btn btn-primary" data-action="create-version">Save Current State as New Version</button>
      </div>

      ${cvType.versions.length
        ? `
          <table class="table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Created</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${cvType.versions
                .map((version) => {
                  return `
                    <tr>
                      <td>${escapeHtml(version.label)}</td>
                      <td>${escapeHtml(formatDate(version.createdAt))}</td>
                      <td>${cvType.defaultVersionId === version.id ? 'Default' : ''}</td>
                      <td>
                        <div class="row">
                          <button class="btn btn-small" data-action="select-version" data-version-id="${version.id}">View</button>
                          <button class="btn btn-small" data-action="set-default-version" data-version-id="${version.id}">Make Default</button>
                          <button class="btn btn-small" data-action="export-version" data-version-id="${version.id}">Export</button>
                        </div>
                      </td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        `
        : '<div class="empty">No versions yet.</div>'}

      ${renderVersionOverrides(cvType)}
    </div>
  `;
}

function renderVersionOverrides(cvType) {
  const version = getSelectedVersion(cvType);

  if (!version) {
    return '<div class="empty">Select a version to edit field overrides.</div>';
  }

  return `
    <div class="card">
      <h4>${escapeHtml(version.label)} field overrides</h4>
      <div class="visibility-list">
        ${FIELD_KEYS.map((fieldKey) => {
          const value = version.fieldVisibilityOverrides[fieldKey];
          const selected = value === null ? 'inherit' : value ? 'show' : 'hide';
          return `
            <div class="visibility-item">
              <div>${escapeHtml(fieldKey)}</div>
              <select data-action="set-field-override" data-version-id="${version.id}" data-field-key="${fieldKey}">
                <option value="inherit" ${selected === 'inherit' ? 'selected' : ''}>Inherit</option>
                <option value="show" ${selected === 'show' ? 'selected' : ''}>Show</option>
                <option value="hide" ${selected === 'hide' ? 'selected' : ''}>Hide</option>
              </select>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderFieldVisibilityView(cvType) {
  return `
    <div class="stack">
      <h4>Type-level Field Visibility Defaults</h4>
      <div class="visibility-list">
        ${FIELD_KEYS.map((fieldKey) => {
          const checked = cvType.fieldVisibilityDefaults[fieldKey] ? 'checked' : '';
          return `
            <label class="visibility-item">
              <span>${escapeHtml(fieldKey)}</span>
              <input type="checkbox" ${checked} data-action="set-field-default" data-field-key="${fieldKey}" />
            </label>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderExportView(cvType) {
  const versions = cvType.versions || [];
  const selectedVersionId = ui.exportVersionId || versions[0]?.id || '';
  const exports = Object.entries(appState.exportsIndex || {}).filter(([key]) => key.startsWith(`${cvType.id}:`));

  return `
    <div class="stack">
      ${versions.length
        ? `
          <div class="row">
            <select data-action="select-export-version">
              ${versions
                .map((version) => `<option value="${version.id}" ${selectedVersionId === version.id ? 'selected' : ''}>${escapeHtml(version.label)}</option>`)
                .join('')}
            </select>
            <button class="btn btn-primary" data-action="export-selected">Export to Drive</button>
          </div>
        `
        : '<div class="empty">Create a version first.</div>'}

      ${exports.length
        ? `
          <div class="stack">
            ${exports
              .map(([, entry]) => {
                return `
                  <article class="card">
                    <div class="muted">${escapeHtml(entry.updatedAt || '')}</div>
                    <div><a href="${escapeHtml(entry.webViewLink || '')}" target="_blank" rel="noreferrer">${escapeHtml(entry.webViewLink || '')}</a></div>
                    <div class="row"><button class="btn btn-small" data-action="copy-export-link" data-link="${escapeHtml(entry.webViewLink || '')}">Copy Link</button></div>
                  </article>
                `;
              })
              .join('')}
          </div>
        `
        : '<div class="empty">No exports for this type yet.</div>'}
    </div>
  `;
}

function renderLinksDashboard() {
  const links = appState.linksDashboard || [];

  return `
    <div class="page-header">
      <h2>Links Dashboard</h2>
      <button class="btn btn-primary" data-action="add-link">Add Link</button>
    </div>

    <div class="stack">
      ${links.length
        ? links
            .map((entry) => {
              return `
                <article class="card">
                  <div class="grid-two">
                    <div class="field">
                      <label>Label</label>
                      <input type="text" value="${escapeHtml(entry.label)}" data-action="edit-link-label" data-id="${entry.id}" />
                    </div>
                    <div class="field">
                      <label>URL</label>
                      <input type="url" value="${escapeHtml(entry.url)}" data-action="edit-link-url" data-id="${entry.id}" />
                    </div>
                  </div>
                  <div class="row" style="margin-top: 8px;">
                    <button class="btn btn-small" data-action="open-link" data-id="${entry.id}">Open</button>
                    <button class="btn btn-small" data-action="delete-link" data-id="${entry.id}">Delete</button>
                  </div>
                </article>
              `;
            })
            .join('')
        : '<div class="empty">No links saved yet.</div>'}
    </div>
  `;
}

function renderSettings() {
  return `
    <div class="page-header">
      <h2>Settings</h2>
    </div>
    <div class="card stack">
      <div class="muted">Google Drive connected via extension OAuth.</div>
      <div class="row">
        <button class="btn" data-action="sign-out">Sign out</button>
      </div>
    </div>
  `;
}

function renderModal() {
  if (!ui.modal || ui.modal.type !== 'createType') {
    return '';
  }

  return `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal" data-action="modal-surface">
        <div class="page-header">
          <h3>Create CV Type</h3>
          <button class="btn btn-small" data-action="close-modal">Close</button>
        </div>

        <div class="field">
          <label>Name</label>
          <input type="text" data-action="modal-name" value="${escapeHtml(ui.modal.name)}" />
        </div>

        <div class="subnav">
          <button class="btn ${ui.modal.source === 'blank' ? 'btn-primary' : ''}" data-action="modal-source" data-source="blank">Start Blank</button>
          <button class="btn ${ui.modal.source === 'copy' ? 'btn-primary' : ''}" data-action="modal-source" data-source="copy">Copy Existing</button>
          <button class="btn ${ui.modal.source === 'import' ? 'btn-primary' : ''}" data-action="modal-source" data-source="import">Import JSON</button>
        </div>

        ${ui.modal.source === 'copy'
          ? `<div class="field"><label>Copy from</label><select data-action="modal-copy-source">${appState.cvTypes
              .map((type) => `<option value="${type.id}" ${ui.modal.copySourceId === type.id ? 'selected' : ''}>${escapeHtml(type.name)}</option>`)
              .join('')}</select></div>`
          : ''}

        ${ui.modal.source === 'import'
          ? `
            <div class="import-guide">
              <p class="muted">Convert your existing CV file to Corpus JSON in one step, then paste the output below.</p>
              <ol class="import-steps">
                ${IMPORT_FLOW_STEPS.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}
              </ol>
              <div class="row">
                <button class="btn btn-small" data-action="copy-import-prompt">Copy AI Prompt</button>
              </div>
            </div>
            <div class="field">
              <label>Import JSON</label>
              <textarea data-action="modal-import-json" placeholder="Paste AI-generated JSON output here.">${escapeHtml(ui.modal.importJson)}</textarea>
            </div>
          `
          : ''}

        <div class="row" style="justify-content: flex-end;">
          <button class="btn" data-action="close-modal">Cancel</button>
          <button class="btn btn-primary" data-action="create-type-submit">Create</button>
        </div>
      </section>
    </div>
  `;
}

async function onClick(event) {
  const target = event.target.closest('[data-action]');

  if (!target) {
    return;
  }

  const action = target.dataset.action;

  if (action === 'modal-surface') {
    return;
  }

  if (action === 'sign-in') {
    try {
      const data = await sendRuntimeCommand('AUTH_SIGN_IN', {});
      const restoredState = await syncController.restoreDrafts(data.state);
      setAppState(restoredState);
      ui.authRequired = false;
      ensureTypeSelection();
      render();
    } catch (error) {
      showToast(error.message || 'Sign-in failed.');
    }
    return;
  }

  if (action === 'sign-out') {
    await sendRuntimeCommand('AUTH_SIGN_OUT', {});
    ui.authRequired = true;
    appState = null;
    ui.syncStatus = 'saved';
    render();
    return;
  }

  if (action === 'set-main') {
    ui.mainView = target.dataset.view || 'cvTypes';
    render();
    return;
  }

  if (action === 'open-create-modal') {
    ui.modal = {
      type: 'createType',
      source: 'blank',
      name: '',
      copySourceId: appState.cvTypes[0]?.id || '',
      importJson: ''
    };
    render();
    return;
  }

  if (action === 'close-modal') {
    ui.modal = null;
    render();
    return;
  }

  if (action === 'modal-source' && ui.modal) {
    ui.modal.source = target.dataset.source || 'blank';
    render();
    return;
  }

  if (action === 'copy-import-prompt') {
    try {
      await navigator.clipboard.writeText(IMPORT_PROMPT);
      showToast('AI prompt copied.');
    } catch {
      showToast('Clipboard not available.');
    }
    return;
  }

  if (action === 'create-type-submit') {
    await createTypeFromModal();
    return;
  }

  if (action === 'select-type') {
    ui.selectedTypeId = target.dataset.typeId || '';
    ui.selectedVersionId = '';
    ui.exportVersionId = '';
    render();
    return;
  }

  if (action === 'rename-type') {
    const typeId = target.dataset.typeId;
    const cvType = appState.cvTypes.find((item) => item.id === typeId);
    if (!cvType) {
      return;
    }

    const nextName = window.prompt('Rename CV Type', cvType.name);
    if (nextName === null) {
      return;
    }

    const trimmed = nextName.trim();
    if (!trimmed) {
      showToast('Name cannot be empty.');
      return;
    }

    const data = await sendUserCommand('CV_UPDATE_TYPE', { cvTypeId: typeId, name: trimmed });
    setAppState(data.state);
    render();
    return;
  }

  if (action === 'delete-type') {
    const typeId = target.dataset.typeId;
    if (!window.confirm('Delete this CV Type and all versions?')) {
      return;
    }

    const data = await sendUserCommand('CV_DELETE_TYPE', { cvTypeId: typeId });
    setAppState(data.state);
    ensureTypeSelection();
    render();
    return;
  }

  if (action === 'set-cv-sub') {
    ui.cvSubView = target.dataset.subView || 'form';
    render();
    return;
  }

  if (action === 'add-work-entry') {
    const type = getSelectedType();
    if (!type) {
      return;
    }
    type.data.workExperience.push(createEmptyWorkExperience());
    queueTypePersist(type.id);
    render();
    return;
  }

  if (action === 'remove-work-entry') {
    const type = getSelectedType();
    if (!type) {
      return;
    }
    const index = toArrayIndex(target.dataset.index, type.data.workExperience.length);
    if (index < 0) {
      return;
    }
    type.data.workExperience.splice(index, 1);
    queueTypePersist(type.id);
    render();
    return;
  }

  if (action === 'add-education-entry') {
    const type = getSelectedType();
    if (!type) {
      return;
    }
    type.data.education.push(createEmptyEducation());
    queueTypePersist(type.id);
    render();
    return;
  }

  if (action === 'remove-education-entry') {
    const type = getSelectedType();
    if (!type) {
      return;
    }
    const index = toArrayIndex(target.dataset.index, type.data.education.length);
    if (index < 0) {
      return;
    }
    type.data.education.splice(index, 1);
    queueTypePersist(type.id);
    render();
    return;
  }

  if (action === 'add-project-entry') {
    const type = getSelectedType();
    if (!type) {
      return;
    }
    type.data.projects.push(createEmptyProject());
    queueTypePersist(type.id);
    render();
    return;
  }

  if (action === 'remove-project-entry') {
    const type = getSelectedType();
    if (!type) {
      return;
    }
    const index = toArrayIndex(target.dataset.index, type.data.projects.length);
    if (index < 0) {
      return;
    }
    type.data.projects.splice(index, 1);
    queueTypePersist(type.id);
    render();
    return;
  }

  if (action === 'create-version') {
    const type = getSelectedType();
    if (!type) {
      return;
    }
    // Version snapshots should represent the latest user edits, so we flush pending drafts first.
    if (!(await ensureSyncedBeforeCriticalAction('before-version-create'))) {
      return;
    }
    const data = await sendUserCommand('CV_CREATE_VERSION', { cvTypeId: type.id });
    setAppState(data.state);
    ui.selectedVersionId = data.version.id;
    ui.exportVersionId = data.version.id;
    render();
    return;
  }

  if (action === 'select-version') {
    ui.selectedVersionId = target.dataset.versionId || '';
    render();
    return;
  }

  if (action === 'set-default-version') {
    const type = getSelectedType();
    if (!type) {
      return;
    }
    if (!(await ensureSyncedBeforeCriticalAction('before-version-default'))) {
      return;
    }

    const data = await sendUserCommand('CV_SET_DEFAULT_VERSION', {
      cvTypeId: type.id,
      versionId: target.dataset.versionId || ''
    });
    setAppState(data.state);
    render();
    return;
  }

  if (action === 'export-version') {
    const type = getSelectedType();
    if (!type) {
      return;
    }
    // Export must run against Drive-backed state to keep version links deterministic.
    if (!(await ensureSyncedBeforeCriticalAction('before-export'))) {
      return;
    }

    const data = await sendUserCommand('EXPORT_VERSION_TO_DRIVE', {
      cvTypeId: type.id,
      versionId: target.dataset.versionId || ''
    });
    setAppState(data.state);
    ui.cvSubView = 'export';
    render();
    showToast('Export complete.');
    return;
  }

  if (action === 'export-selected') {
    const type = getSelectedType();
    if (!type || !ui.exportVersionId) {
      return;
    }

    if (!(await ensureSyncedBeforeCriticalAction('before-export-selected'))) {
      return;
    }

    const data = await sendUserCommand('EXPORT_VERSION_TO_DRIVE', {
      cvTypeId: type.id,
      versionId: ui.exportVersionId
    });

    setAppState(data.state);
    render();
    showToast('Export complete.');
    return;
  }

  if (action === 'copy-export-link') {
    const link = target.dataset.link || '';
    if (!link) {
      return;
    }
    await navigator.clipboard.writeText(link);
    showToast('Link copied.');
    return;
  }

  if (action === 'add-link') {
    const data = await sendUserCommand('LINKS_UPSERT', {
      entry: {
        label: '',
        url: ''
      }
    });
    setAppState(data.state);
    render();
    return;
  }

  if (action === 'delete-link') {
    const data = await sendUserCommand('LINKS_DELETE', { id: target.dataset.id || '' });
    setAppState(data.state);
    render();
    return;
  }

  if (action === 'open-link') {
    const id = target.dataset.id || '';
    const entry = appState.linksDashboard.find((item) => item.id === id);
    if (!entry?.url) {
      return;
    }

    window.open(normalizeUrl(entry.url), '_blank', 'noopener,noreferrer');
  }
}

function onInput(event) {
  const action = event.target.dataset.action;

  if (!appState || ui.authRequired) {
    return;
  }

  if (typeof action === 'string' && action.startsWith('update-')) {
    // We only mark field-edit actions for latency tracing.
    perf.markInput(action);
  }

  if (action === 'modal-name' && ui.modal) {
    ui.modal.name = event.target.value;
    return;
  }

  if (action === 'modal-import-json' && ui.modal) {
    ui.modal.importJson = event.target.value;
    return;
  }

  if (action === 'update-personal') {
    const type = getSelectedType();
    if (!type) {
      return;
    }

    const key = event.target.dataset.key;
    if (!(key in type.data.personalInfo)) {
      return;
    }

    type.data.personalInfo[key] = event.target.value;
    queueTypePersist(type.id);
    return;
  }

  if (action === 'update-skills') {
    const type = getSelectedType();
    if (!type) {
      return;
    }

    type.data.skills = splitCsvToList(event.target.value);
    queueTypePersist(type.id);
    return;
  }

  if (action === 'update-links') {
    const type = getSelectedType();
    if (!type) {
      return;
    }

    type.data.links = splitLinesToList(event.target.value);
    queueTypePersist(type.id);
    return;
  }

  if (action === 'update-work-field') {
    const type = getSelectedType();
    if (!type) {
      return;
    }
    const index = toArrayIndex(event.target.dataset.index, type.data.workExperience.length);
    if (index < 0) {
      return;
    }

    const key = event.target.dataset.key;
    if (!['company', 'role', 'startDate', 'endDate'].includes(key)) {
      return;
    }

    type.data.workExperience[index][key] = event.target.value;
    queueTypePersist(type.id);
    return;
  }

  if (action === 'update-work-bullets') {
    const type = getSelectedType();
    if (!type) {
      return;
    }
    const index = toArrayIndex(event.target.dataset.index, type.data.workExperience.length);
    if (index < 0) {
      return;
    }

    type.data.workExperience[index].bullets = splitLinesToList(event.target.value);
    queueTypePersist(type.id);
    return;
  }

  if (action === 'update-education-field') {
    const type = getSelectedType();
    if (!type) {
      return;
    }
    const index = toArrayIndex(event.target.dataset.index, type.data.education.length);
    if (index < 0) {
      return;
    }

    const key = event.target.dataset.key;
    if (!['institution', 'degree', 'fieldOfStudy', 'graduationYear'].includes(key)) {
      return;
    }

    type.data.education[index][key] = event.target.value;
    queueTypePersist(type.id);
    return;
  }

  if (action === 'update-project-field') {
    const type = getSelectedType();
    if (!type) {
      return;
    }
    const index = toArrayIndex(event.target.dataset.index, type.data.projects.length);
    if (index < 0) {
      return;
    }

    const key = event.target.dataset.key;
    if (!['name', 'url', 'description'].includes(key)) {
      return;
    }

    type.data.projects[index][key] = event.target.value;
    queueTypePersist(type.id);
    return;
  }

  if (action === 'update-project-tags') {
    const type = getSelectedType();
    if (!type) {
      return;
    }
    const index = toArrayIndex(event.target.dataset.index, type.data.projects.length);
    if (index < 0) {
      return;
    }

    type.data.projects[index].tags = splitCsvToList(event.target.value);
    queueTypePersist(type.id);
    return;
  }

  if (action === 'edit-link-label') {
    updateDashboardDraft(event.target.dataset.id, 'label', event.target.value);
    return;
  }

  if (action === 'edit-link-url') {
    updateDashboardDraft(event.target.dataset.id, 'url', event.target.value);
  }
}

async function onChange(event) {
  const action = event.target.dataset.action;

  if (!appState || ui.authRequired) {
    return;
  }

  if (action === 'modal-source' && ui.modal) {
    ui.modal.source = event.target.dataset.source || 'blank';
    render();
    return;
  }

  if (action === 'modal-copy-source' && ui.modal) {
    ui.modal.copySourceId = event.target.value;
    return;
  }

  if (action === 'update-work-present') {
    const type = getSelectedType();
    if (!type) {
      return;
    }

    const index = toArrayIndex(event.target.dataset.index, type.data.workExperience.length);
    if (index < 0) {
      return;
    }

    type.data.workExperience[index].present = Boolean(event.target.checked);
    queueTypePersist(type.id);
    return;
  }

  if (action === 'set-field-default') {
    const type = getSelectedType();
    if (!type) {
      return;
    }

    const fieldKey = event.target.dataset.fieldKey;
    const checked = Boolean(event.target.checked);

    type.fieldVisibilityDefaults[fieldKey] = checked;

    const data = await sendUserCommand('CV_SET_FIELD_DEFAULTS', {
      cvTypeId: type.id,
      defaults: {
        [fieldKey]: checked
      }
    });

    setAppState(data.state);
    render();
    return;
  }

  if (action === 'set-field-override') {
    const type = getSelectedType();
    if (!type) {
      return;
    }

    const value = event.target.value;
    const fieldKey = event.target.dataset.fieldKey;
    const versionId = event.target.dataset.versionId;

    const override = value === 'inherit' ? null : value === 'show';

    const data = await sendUserCommand('CV_SET_FIELD_OVERRIDES', {
      cvTypeId: type.id,
      versionId,
      overrides: {
        [fieldKey]: override
      }
    });

    setAppState(data.state);
    render();
    return;
  }

  if (action === 'select-export-version') {
    ui.exportVersionId = event.target.value;
    return;
  }

  if (action === 'edit-link-label' || action === 'edit-link-url') {
    const id = event.target.dataset.id;
    const entry = appState.linksDashboard.find((item) => item.id === id);
    if (!entry) {
      return;
    }

    const data = await sendUserCommand('LINKS_UPSERT', { entry });
    setAppState(data.state);
    return;
  }
}

async function createTypeFromModal() {
  if (!ui.modal || ui.modal.type !== 'createType') {
    return;
  }

  try {
    const data = await sendUserCommand('CV_CREATE_TYPE', {
      name: ui.modal.name,
      source: ui.modal.source,
      copySourceId: ui.modal.copySourceId,
      importJson: ui.modal.importJson
    });

    setAppState(data.state);
    ui.selectedTypeId = data.cvType.id;
    ui.modal = null;
    ui.cvSubView = 'form';
    render();
  } catch (error) {
    showToast(error.message || 'Could not create CV type.');
  }
}

function ensureTypeSelection() {
  if (!appState?.cvTypes?.length) {
    ui.selectedTypeId = '';
    ui.selectedVersionId = '';
    ui.exportVersionId = '';
    return;
  }

  if (!appState.cvTypes.some((type) => type.id === ui.selectedTypeId)) {
    ui.selectedTypeId = appState.cvTypes[0].id;
  }

  const type = getSelectedType();

  if (!type) {
    return;
  }

  if (ui.selectedVersionId && !type.versions.some((version) => version.id === ui.selectedVersionId)) {
    ui.selectedVersionId = '';
  }

  if (!ui.selectedVersionId && type.versions.length) {
    ui.selectedVersionId = type.versions[type.versions.length - 1].id;
  }

  if (!ui.exportVersionId && type.versions.length) {
    ui.exportVersionId = type.defaultVersionId || type.versions[0].id;
  }
}

function getSelectedType() {
  return appState?.cvTypes?.find((type) => type.id === ui.selectedTypeId) || null;
}

function getSelectedVersion(cvType) {
  if (!cvType) {
    return null;
  }

  return cvType.versions.find((version) => version.id === ui.selectedVersionId) || null;
}

function queueTypePersist(cvTypeId) {
  const type = appState?.cvTypes?.find((item) => item.id === cvTypeId);
  if (!type) {
    return;
  }

  syncController.scheduleTypeSave(type.id, type.data, appState?.updatedAt || '');
}

async function sendUserCommand(command, payload = {}) {
  return sendRuntimeCommand(command, payload, { interactiveReconnect: true });
}

function setAppState(nextState) {
  appState = nextState || null;

  if (appState) {
    // Pruning happens here so deleted CV types do not leave stale local draft entries.
    syncController.absorbRemoteState(appState);
  }

  ensureTypeSelection();
  updateSyncStatusBadge();
}

async function ensureSyncedBeforeCriticalAction(reason) {
  if (!syncController.hasPendingDrafts() && syncController.getStatus() !== 'error') {
    return true;
  }

  // Critical actions (export/versioning) pay the sync cost up-front for predictable outcomes.
  perf.markSync('flush-start', { reason, status: syncController.getStatus() });
  const result = await syncController.flush(reason);
  perf.markSync('flush-finish', {
    reason,
    status: syncController.getStatus(),
    ok: result.ok
  });

  if (syncController.getStatus() === 'error') {
    showToast('Could not sync latest edits. Please retry after reconnecting.');
    return false;
  }

  return true;
}

function getSyncStatusLabel(status) {
  if (status === 'saving') {
    return 'Saving';
  }

  if (status === 'pending') {
    return 'Pending sync';
  }

  if (status === 'error') {
    return 'Sync error (local draft kept)';
  }

  return 'Saved to Drive';
}

function updateSyncStatusBadge() {
  const badge = document.getElementById('sync-status');
  if (!badge) {
    return;
  }

  const knownStates = ['saved', 'saving', 'pending', 'error'];
  for (const state of knownStates) {
    badge.classList.remove(`sync-status-${state}`);
  }

  badge.classList.add(`sync-status-${ui.syncStatus}`);
  badge.textContent = getSyncStatusLabel(ui.syncStatus);
}

function updateDashboardDraft(id, field, value) {
  const entry = appState.linksDashboard.find((item) => item.id === id);

  if (!entry || !(field in entry)) {
    return;
  }

  entry[field] = value;
}

function toArrayIndex(value, length) {
  const index = Number.parseInt(String(value), 10);
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    return -1;
  }
  return index;
}

function normalizeUrl(value) {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return `https://${value}`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');

  if (ui.toastTimer) {
    clearTimeout(ui.toastTimer);
  }

  ui.toastTimer = window.setTimeout(() => {
    toastEl.classList.remove('show');
  }, 1800);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
