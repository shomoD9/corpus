export const FIELD_KEYS = [
  'personalInfo.name',
  'personalInfo.title',
  'personalInfo.email',
  'personalInfo.phone',
  'personalInfo.location',
  'personalInfo.linkedinUrl',
  'personalInfo.githubUrl',
  'personalInfo.website',
  'workExperience.company',
  'workExperience.role',
  'workExperience.startDate',
  'workExperience.endDate',
  'workExperience.present',
  'workExperience.bullets',
  'education.institution',
  'education.degree',
  'education.fieldOfStudy',
  'education.graduationYear',
  'skills.items',
  'projects.name',
  'projects.url',
  'projects.description',
  'projects.tags',
  'links.url'
];

export const SECTION_FIELD_MAP = {
  personalInfo: [
    'personalInfo.name',
    'personalInfo.title',
    'personalInfo.email',
    'personalInfo.phone',
    'personalInfo.location',
    'personalInfo.linkedinUrl',
    'personalInfo.githubUrl',
    'personalInfo.website'
  ],
  workExperience: [
    'workExperience.company',
    'workExperience.role',
    'workExperience.startDate',
    'workExperience.endDate',
    'workExperience.present',
    'workExperience.bullets'
  ],
  education: [
    'education.institution',
    'education.degree',
    'education.fieldOfStudy',
    'education.graduationYear'
  ],
  skills: ['skills.items'],
  projects: ['projects.name', 'projects.url', 'projects.description', 'projects.tags'],
  links: ['links.url']
};

export const STATE_FILE_NAME = 'corpus-state-v2.json';

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

export function createFieldVisibilityDefaults(defaultValue = true) {
  return Object.fromEntries(FIELD_KEYS.map((key) => [key, Boolean(defaultValue)]));
}

export function createFieldVisibilityOverrides() {
  return Object.fromEntries(FIELD_KEYS.map((key) => [key, null]));
}

export function createInitialState(nowIso = () => new Date().toISOString()) {
  return {
    schemaVersion: 2,
    updatedAt: nowIso(),
    cvTypes: [],
    linksDashboard: [],
    settings: {
      driveRootFolderId: '',
      driveCvsFolderId: ''
    },
    exportsIndex: {}
  };
}

export function sanitizeCvData(data) {
  const source = isObject(data) ? data : {};
  const personal = isObject(source.personalInfo) ? source.personalInfo : {};

  return {
    personalInfo: {
      name: safeString(personal.name),
      title: safeString(personal.title),
      email: safeString(personal.email),
      phone: safeString(personal.phone),
      location: safeString(personal.location),
      linkedinUrl: safeUrlString(personal.linkedinUrl),
      githubUrl: safeUrlString(personal.githubUrl),
      website: safeUrlString(personal.website)
    },
    workExperience: normalizeWorkExperience(source.workExperience),
    education: normalizeEducation(source.education),
    skills: normalizeStringArray(source.skills),
    projects: normalizeProjects(source.projects),
    links: normalizeUrlArray(source.links)
  };
}

export function sanitizeState(candidate, nowIso = () => new Date().toISOString()) {
  const fallback = createInitialState(nowIso);

  if (!isObject(candidate)) {
    return fallback;
  }

  const cvTypes = Array.isArray(candidate.cvTypes)
    ? candidate.cvTypes.map((type) => sanitizeCvType(type, nowIso)).filter(Boolean)
    : [];

  const linksDashboard = Array.isArray(candidate.linksDashboard)
    ? candidate.linksDashboard.map((entry) => sanitizeDashboardEntry(entry)).filter(Boolean)
    : [];

  const exportsIndex = isObject(candidate.exportsIndex) ? sanitizeExportsIndex(candidate.exportsIndex) : {};

  return {
    schemaVersion: 2,
    updatedAt: safeString(candidate.updatedAt) || nowIso(),
    cvTypes,
    linksDashboard,
    settings: {
      driveRootFolderId: safeString(candidate?.settings?.driveRootFolderId),
      driveCvsFolderId: safeString(candidate?.settings?.driveCvsFolderId)
    },
    exportsIndex
  };
}

export function makeId(prefix = 'id') {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeCvType(type, nowIso) {
  if (!isObject(type)) {
    return null;
  }

  const versions = Array.isArray(type.versions)
    ? type.versions.map((version, index) => sanitizeVersion(version, index, nowIso)).filter(Boolean)
    : [];

  const defaultVersionId = safeString(type.defaultVersionId);

  return {
    id: safeString(type.id) || makeId('type'),
    name: safeString(type.name) || 'Untitled CV',
    data: sanitizeCvData(type.data),
    fieldVisibilityDefaults: sanitizeFieldVisibilityDefaults(type.fieldVisibilityDefaults),
    versions,
    defaultVersionId: versions.some((version) => version.id === defaultVersionId)
      ? defaultVersionId
      : versions[0]?.id || null
  };
}

function sanitizeVersion(version, index, nowIso) {
  if (!isObject(version)) {
    return null;
  }

  return {
    id: safeString(version.id) || makeId('ver'),
    label: safeString(version.label) || `v${index + 1}`,
    createdAt: safeString(version.createdAt) || nowIso(),
    snapshot: sanitizeCvData(version.snapshot),
    fieldVisibilityOverrides: sanitizeFieldVisibilityOverrides(version.fieldVisibilityOverrides)
  };
}

function sanitizeDashboardEntry(entry) {
  if (!isObject(entry)) {
    return null;
  }

  const label = safeString(entry.label);
  const url = safeString(entry.url);

  if (!label && !url) {
    return null;
  }

  return {
    id: safeString(entry.id) || makeId('link'),
    label,
    url
  };
}

function sanitizeExportsIndex(index) {
  const clean = {};

  for (const [key, value] of Object.entries(index)) {
    if (!isObject(value)) {
      continue;
    }

    clean[key] = {
      driveFileId: safeString(value.driveFileId),
      webViewLink: safeString(value.webViewLink),
      folderId: safeString(value.folderId),
      updatedAt: safeString(value.updatedAt)
    };
  }

  return clean;
}

function sanitizeFieldVisibilityDefaults(candidate) {
  const defaults = createFieldVisibilityDefaults(true);

  if (!isObject(candidate)) {
    return defaults;
  }

  for (const fieldKey of FIELD_KEYS) {
    const value = candidate[fieldKey];
    if (value === true || value === false) {
      defaults[fieldKey] = value;
    }
  }

  return defaults;
}

function sanitizeFieldVisibilityOverrides(candidate) {
  const overrides = createFieldVisibilityOverrides();

  if (!isObject(candidate)) {
    return overrides;
  }

  for (const fieldKey of FIELD_KEYS) {
    const value = candidate[fieldKey];
    if (value === true || value === false) {
      overrides[fieldKey] = value;
    }
  }

  return overrides;
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
    url: safeUrlString(entry?.url),
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

function normalizeUrlArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => safeUrlString(value))
    .filter((value) => value.length > 0);
}

function safeString(value) {
  return typeof value === 'string' ? value : '';
}

function safeUrlString(value) {
  const text = safeString(value).trim();
  if (!text) {
    return '';
  }

  return unwrapMarkdownLink(text);
}

function unwrapMarkdownLink(value) {
  const markdownLink = value.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (markdownLink) {
    return markdownLink[2].trim();
  }

  const wrapped = value.match(/^\[([^\]]+)\]$/);
  if (wrapped) {
    return wrapped[1].trim();
  }

  return value;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
