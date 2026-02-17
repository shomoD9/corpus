/*
  This file contains pure domain helpers for the legacy web CV Studio implementation.
  It exists separately from UI rendering so data-shape and validation rules can be tested in isolation.
  It talks to `app.js`, which consumes these functions while handling modal and form operations.
*/

export const SECTION_KEYS = [
  'personalInfo',
  'workExperience',
  'education',
  'skills',
  'projects',
  'links'
];

export function createDefaultVisibility() {
  const visibility = {};

  for (const key of SECTION_KEYS) {
    // Sections default to visible so first exports are complete unless user hides content explicitly.
    visibility[key] = true;
  }

  return visibility;
}

export function createEmptyVisibilityOverrides() {
  const overrides = {};

  for (const key of SECTION_KEYS) {
    overrides[key] = null;
  }

  return overrides;
}

export function createEmptyCvData() {
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

export function sanitizeCvData(data) {
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

export function buildCvTypeFromModal({ modal, existingTypes, makeId }) {
  const name = safeString(modal?.name).trim();

  if (!name) {
    return { ok: false, error: 'Give the CV type a name.', cvType: null };
  }

  const safeTypes = Array.isArray(existingTypes) ? existingTypes : [];

  if (safeTypes.some((type) => safeString(type?.name).toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: 'A CV type with that name already exists.', cvType: null };
  }

  const source = modal?.source || 'blank';
  let cvData = createEmptyCvData();

  if (source === 'copy') {
    const sourceType = safeTypes.find((type) => type.id === modal?.copySourceId);

    if (!sourceType) {
      return { ok: false, error: 'Select a CV type to copy from.', cvType: null };
    }

    cvData = deepClone(sourceType.data || createEmptyCvData());
  }

  if (source === 'import') {
    const importJson = safeString(modal?.importJson).trim();

    if (!importJson) {
      return { ok: false, error: 'Paste JSON to import.', cvType: null };
    }

    try {
      const parsed = JSON.parse(importJson);
      cvData = sanitizeCvData(parsed);
    } catch {
      return {
        ok: false,
        error: 'JSON import failed. Check formatting and try again.',
        cvType: null
      };
    }
  }

  const cvType = {
    id: typeof makeId === 'function' ? makeId('type') : `type_${Date.now()}`,
    name,
    data: cvData,
    visibilityDefaults: createDefaultVisibility(),
    versions: [],
    defaultVersionId: null
  };

  return { ok: true, error: null, cvType };
}

export function makeVersionRecord({
  existingVersions,
  data,
  makeId,
  nowIso = () => new Date().toISOString()
}) {
  const safeVersions = Array.isArray(existingVersions) ? existingVersions : [];

  return {
    id: typeof makeId === 'function' ? makeId('ver') : `ver_${Date.now()}`,
    label: `v${safeVersions.length + 1}`,
    createdAt: nowIso(),
    snapshot: deepClone(data || createEmptyCvData()),
    visibilityOverrides: createEmptyVisibilityOverrides()
  };
}

export function mergeVisibility({ defaults, overrides }) {
  const merged = createDefaultVisibility();

  for (const key of SECTION_KEYS) {
    const baseValue = defaults?.[key];
    merged[key] = typeof baseValue === 'boolean' ? baseValue : true;

    const overrideValue = overrides?.[key];

    if (overrideValue === true || overrideValue === false) {
      merged[key] = overrideValue;
    }
  }

  return merged;
}

export function resolveActionableElement(event) {
  const target = event?.target;
  const element = toElementLike(target);

  if (!element) {
    return null;
  }

  return element.closest('[data-action]');
}

function toElementLike(target) {
  if (target && typeof target.closest === 'function') {
    return target;
  }

  if (target?.parentElement && typeof target.parentElement.closest === 'function') {
    return target.parentElement;
  }

  return null;
}

function safeString(value) {
  return typeof value === 'string' ? value : '';
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}
