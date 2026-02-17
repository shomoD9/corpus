/*
  This file renders and controls the compact extension popup.
  It exists as a dedicated deployment utility surface where users quickly download/export/open CV versions
  without entering the full editor.
  It talks to runtime commands for state/export actions and to common PDF/visibility helpers for local downloads.
*/

import { buildPdfBytesFromVersion } from '../common/pdf.js';
import { mergeFieldVisibility } from '../common/visibility.js';
import { sortVersionsForPopup, buildVersionActionModel } from './popup_logic.js';
import { sendRuntimeCommand } from './runtime.js';

const root = document.getElementById('popup-root');

const ui = {
  authRequired: false,
  state: null,
  expandedTypeIds: new Set(),
  toastTimer: null
};

root.addEventListener('click', handleClick);

init();

async function init() {
  await refreshState(false);
}

async function refreshState(interactiveReconnect = false) {
  try {
    const data = await sendRuntimeCommand('POPUP_REFRESH', {}, { interactiveReconnect });
    ui.state = data.state;
    ui.authRequired = false;
  } catch (error) {
    if (error.code === 'AUTH_REQUIRED') {
      ui.authRequired = true;
      ui.state = null;
    } else {
      console.error(error);
    }
  }

  render();
}

function render() {
  if (ui.authRequired) {
    root.innerHTML = `
      <div class="card stack">
        <h3>Sign in required</h3>
        <p class="muted">Sign in with Google to load your CVs.</p>
        <div class="row">
          <button class="btn btn-primary" data-action="sign-in">Sign in</button>
          <button class="btn" data-action="open-editor">Open Editor</button>
        </div>
      </div>
    `;
    return;
  }

  const state = ui.state;
  const cvTypes = state?.cvTypes || [];

  root.innerHTML = `
    <div class="popup-head">
      <strong>Corpus</strong>
      <div class="row">
        <button class="btn btn-small" data-action="refresh">Refresh</button>
        <button class="btn btn-small" data-action="open-editor">Editor</button>
      </div>
    </div>
    ${cvTypes.length ? cvTypes.map((type) => renderCvType(type)).join('') : '<div class="empty">No CVs found.</div>'}
  `;
}

function renderCvType(cvType) {
  const expanded = ui.expandedTypeIds.has(cvType.id);
  const versions = sortVersionsForPopup(cvType.versions || [], cvType.defaultVersionId);

  return `
    <section class="popup-type">
      <button data-action="toggle-type" data-type-id="${cvType.id}">${escapeHtml(cvType.name)}</button>
      ${expanded
        ? versions.length
          ? versions.map((version) => renderVersion(cvType, version)).join('')
          : '<div class="popup-version muted">No versions yet.</div>'
        : ''}
    </section>
  `;
}

function renderVersion(cvType, version) {
  const model = buildVersionActionModel({
    cvTypeId: cvType.id,
    versionId: version.id,
    exportsIndex: ui.state.exportsIndex
  });

  return `
    <div class="popup-version">
      <div class="row" style="justify-content: space-between;">
        <strong>${escapeHtml(version.label)}</strong>
        ${cvType.defaultVersionId === version.id ? '<span class="tag">default</span>' : ''}
      </div>
      <div class="row" style="margin-top: 6px;">
        <button class="btn btn-small" data-action="download" data-type-id="${cvType.id}" data-version-id="${version.id}">Download</button>
        <button class="btn btn-small" data-action="copy-link" data-type-id="${cvType.id}" data-version-id="${version.id}">Copy Link</button>
        <button class="btn btn-small" data-action="open-drive" data-type-id="${cvType.id}" data-version-id="${version.id}">Open</button>
      </div>
      ${model.hasExport ? `<div class="muted" style="margin-top:4px; font-size:11px;">Drive link ready</div>` : ''}
    </div>
  `;
}

async function handleClick(event) {
  const target = event.target.closest('[data-action]');

  if (!target) {
    return;
  }

  const action = target.dataset.action;

  if (action === 'refresh') {
    await refreshState(true);
    return;
  }

  if (action === 'sign-in') {
    try {
      const data = await sendRuntimeCommand('AUTH_SIGN_IN', {});
      ui.state = data.state;
      ui.authRequired = false;
      render();
    } catch (error) {
      showToast(error.message || 'Sign-in failed.');
    }
    return;
  }

  if (action === 'open-editor') {
    const url = chrome.runtime.getURL('src/ui/app.html');
    chrome.tabs.create({ url });
    return;
  }

  if (action === 'toggle-type') {
    const typeId = target.dataset.typeId;
    if (ui.expandedTypeIds.has(typeId)) {
      ui.expandedTypeIds.delete(typeId);
    } else {
      ui.expandedTypeIds.add(typeId);
    }
    render();
    return;
  }

  if (action === 'download') {
    await downloadVersion(target.dataset.typeId, target.dataset.versionId);
    return;
  }

  if (action === 'copy-link') {
    const link = await ensureExportLink(target.dataset.typeId, target.dataset.versionId);
    await navigator.clipboard.writeText(link);
    showToast('Link copied.');
    return;
  }

  if (action === 'open-drive') {
    const link = await ensureExportLink(target.dataset.typeId, target.dataset.versionId);
    chrome.tabs.create({ url: link });
  }
}

async function ensureExportLink(cvTypeId, versionId) {
  const key = `${cvTypeId}:${versionId}`;
  const existing = ui.state?.exportsIndex?.[key];

  // We reuse stable links whenever possible to avoid needless Drive writes.
  if (existing?.webViewLink) {
    return existing.webViewLink;
  }

  const data = await sendRuntimeCommand('EXPORT_VERSION_TO_DRIVE', {
    cvTypeId,
    versionId
  }, { interactiveReconnect: true });

  ui.state = data.state;
  render();
  return data.export.webViewLink;
}

async function downloadVersion(cvTypeId, versionId) {
  const cvType = ui.state.cvTypes.find((type) => type.id === cvTypeId);
  const version = cvType?.versions?.find((item) => item.id === versionId);

  if (!cvType || !version) {
    showToast('Version not found.');
    return;
  }

  const effectiveFieldVisibility = mergeFieldVisibility(
    cvType.fieldVisibilityDefaults,
    version.fieldVisibilityOverrides
  );

  const bytes = buildPdfBytesFromVersion({
    cvType,
    version,
    effectiveFieldVisibility
  });

  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${cvType.name} - ${version.label}.pdf`;
  anchor.click();

  URL.revokeObjectURL(url);
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'card';
  toast.style.marginTop = '8px';
  toast.textContent = message;

  const existing = root.querySelector('[data-toast]');
  if (existing) {
    existing.remove();
  }

  toast.dataset.toast = 'true';
  root.appendChild(toast);

  if (ui.toastTimer) {
    clearTimeout(ui.toastTimer);
  }

  ui.toastTimer = window.setTimeout(() => {
    toast.remove();
  }, 1600);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
