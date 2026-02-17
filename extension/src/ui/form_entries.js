/*
  This file provides helper constructors and text/list conversion utilities for editor entries.
  It exists so section-editing behavior stays consistent across work experience, education, and projects.
  It talks to `app.js`, which uses these helpers while rendering and parsing user input.
*/

export function createEmptyWorkExperience() {
  return {
    company: '',
    role: '',
    startDate: '',
    endDate: '',
    present: false,
    bullets: []
  };
}

export function createEmptyEducation() {
  return {
    institution: '',
    degree: '',
    fieldOfStudy: '',
    graduationYear: ''
  };
}

export function createEmptyProject() {
  return {
    name: '',
    url: '',
    description: '',
    tags: []
  };
}

export function splitLinesToList(value) {
  // Blank lines are intentionally dropped so textarea spacing does not create empty list items.
  return String(value || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function splitCsvToList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function joinListForTextarea(values) {
  return Array.isArray(values) ? values.join('\n') : '';
}

export function joinListForCsv(values) {
  return Array.isArray(values) ? values.join(', ') : '';
}
