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
