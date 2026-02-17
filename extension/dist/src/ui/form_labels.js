/*
  This file holds user-facing form label constants.
  It exists to prevent technical wording from leaking into the UI and to keep labels consistent across sections.
  It talks to `app.js`, which reads these values while rendering editor fields.
*/

export const FORM_LABELS = Object.freeze({
  skills: 'Skills',
  links: 'Links',
  workExperience: 'Work Experience',
  education: 'Education',
  projects: 'Projects'
});
