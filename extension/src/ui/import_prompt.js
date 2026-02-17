/*
  This file stores copy-ready prompt text for the JSON import assistant flow.
  It exists to keep UX copy centralized and testable, instead of hard-coding long prompt strings inside view code.
  It talks to `app.js`, which renders the copy button and guidance steps in the create-type modal.
*/

export const IMPORT_PROMPT = `Convert the uploaded or attached CV/resume file (PDF, DOCX, or Word) into valid JSON for Corpus.

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

3) Keep bullets concise and quantified when possible.
4) If a value is unknown, use an empty string or empty array.
5) Dates can remain plain text (for example: "Jan 2022").
6) Use only information from the uploaded resume file.`;

export const IMPORT_FLOW_STEPS = [
  'Click "Copy AI Prompt".',
  'Open your AI tool (ChatGPT, Claude, Gemini, etc.).',
  'Upload your CV file, paste the prompt, and run it.',
  'Copy the JSON output and paste it into Import JSON.'
];
