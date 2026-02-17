/*
  This file computes effective field visibility and filtered CV payloads.
  It exists to keep visibility semantics centralized, because form editing, preview/export, and
  version overrides all depend on the same merge/filter logic.
  It talks to schema constants for known field keys and empty-data constructors.
*/

import { FIELD_KEYS, SECTION_FIELD_MAP, createEmptyCvData } from './schema.js';

export function mergeFieldVisibility(defaults, overrides) {
  const merged = {};

  for (const fieldKey of FIELD_KEYS) {
    const base = defaults?.[fieldKey];
    merged[fieldKey] = base === true || base === false ? base : true;

    const override = overrides?.[fieldKey];
    if (override === true || override === false) {
      merged[fieldKey] = override;
    }
  }

  return merged;
}

export function sectionHasVisibleFields(sectionKey, effectiveVisibility) {
  const fields = SECTION_FIELD_MAP[sectionKey] || [];
  return fields.some((fieldKey) => effectiveVisibility?.[fieldKey] === true);
}

export function filterCvDataByVisibility(data, effectiveVisibility) {
  const output = createEmptyCvData();
  const source = data || createEmptyCvData();

  // Personal info is copied field-by-field so hidden values are wiped instead of leaked.
  for (const key of Object.keys(output.personalInfo)) {
    const fieldKey = `personalInfo.${key}`;
    output.personalInfo[key] = effectiveVisibility?.[fieldKey] ? source.personalInfo?.[key] || '' : '';
  }

  output.workExperience = Array.isArray(source.workExperience)
    ? source.workExperience.map((entry) => ({
        company: effectiveVisibility?.['workExperience.company'] ? entry.company || '' : '',
        role: effectiveVisibility?.['workExperience.role'] ? entry.role || '' : '',
        startDate: effectiveVisibility?.['workExperience.startDate'] ? entry.startDate || '' : '',
        endDate: effectiveVisibility?.['workExperience.endDate'] ? entry.endDate || '' : '',
        present: effectiveVisibility?.['workExperience.present'] ? Boolean(entry.present) : false,
        bullets: effectiveVisibility?.['workExperience.bullets']
          ? Array.isArray(entry.bullets)
            ? entry.bullets.filter(Boolean)
            : []
          : []
      }))
    : [];

  output.education = Array.isArray(source.education)
    ? source.education.map((entry) => ({
        institution: effectiveVisibility?.['education.institution'] ? entry.institution || '' : '',
        degree: effectiveVisibility?.['education.degree'] ? entry.degree || '' : '',
        fieldOfStudy: effectiveVisibility?.['education.fieldOfStudy'] ? entry.fieldOfStudy || '' : '',
        graduationYear: effectiveVisibility?.['education.graduationYear'] ? entry.graduationYear || '' : ''
      }))
    : [];

  output.skills = effectiveVisibility?.['skills.items']
    ? Array.isArray(source.skills)
      ? source.skills.filter(Boolean)
      : []
    : [];

  output.projects = Array.isArray(source.projects)
    ? source.projects.map((entry) => ({
        name: effectiveVisibility?.['projects.name'] ? entry.name || '' : '',
        url: effectiveVisibility?.['projects.url'] ? entry.url || '' : '',
        description: effectiveVisibility?.['projects.description'] ? entry.description || '' : '',
        tags: effectiveVisibility?.['projects.tags']
          ? Array.isArray(entry.tags)
            ? entry.tags.filter(Boolean)
            : []
          : []
      }))
    : [];

  output.links = effectiveVisibility?.['links.url']
    ? Array.isArray(source.links)
      ? source.links.filter(Boolean)
      : []
    : [];

  return output;
}
