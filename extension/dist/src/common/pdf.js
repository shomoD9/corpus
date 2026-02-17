import { filterCvDataByVisibility, sectionHasVisibleFields } from './visibility.js';

export function buildPdfLines({ cvTypeName, versionLabel, snapshot, effectiveFieldVisibility, createdAt }) {
  const data = filterCvDataByVisibility(snapshot, effectiveFieldVisibility);
  const lines = [
    `${cvTypeName} | ${versionLabel}`,
    `Generated: ${new Date(createdAt || Date.now()).toISOString()}`,
    ''
  ];

  if (sectionHasVisibleFields('personalInfo', effectiveFieldVisibility)) {
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

  if (sectionHasVisibleFields('workExperience', effectiveFieldVisibility)) {
    lines.push('WORK EXPERIENCE');
    if (!data.workExperience.length) {
      lines.push('- None');
    }
    for (const entry of data.workExperience) {
      lines.push(`- ${entry.role || '-'} at ${entry.company || '-'}`);
      lines.push(`  ${entry.startDate || '-'} to ${entry.present ? 'Present' : entry.endDate || '-'}`);
      for (const bullet of entry.bullets || []) {
        lines.push(`  * ${bullet}`);
      }
    }
    lines.push('');
  }

  if (sectionHasVisibleFields('education', effectiveFieldVisibility)) {
    lines.push('EDUCATION');
    if (!data.education.length) {
      lines.push('- None');
    }
    for (const entry of data.education) {
      lines.push(`- ${entry.degree || '-'} ${entry.fieldOfStudy || '-'}`.trim());
      lines.push(`  ${entry.institution || '-'} (${entry.graduationYear || '-'})`);
    }
    lines.push('');
  }

  if (sectionHasVisibleFields('skills', effectiveFieldVisibility)) {
    lines.push('SKILLS');
    lines.push(data.skills.length ? data.skills.join(', ') : '- None');
    lines.push('');
  }

  if (sectionHasVisibleFields('projects', effectiveFieldVisibility)) {
    lines.push('PROJECTS');
    if (!data.projects.length) {
      lines.push('- None');
    }
    for (const project of data.projects) {
      lines.push(`- ${project.name || '-'}`);
      lines.push(`  ${project.description || '-'}`);
      if (project.url) {
        lines.push(`  URL: ${project.url}`);
      }
      if (project.tags.length) {
        lines.push(`  Tags: ${project.tags.join(', ')}`);
      }
    }
    lines.push('');
  }

  if (sectionHasVisibleFields('links', effectiveFieldVisibility)) {
    lines.push('LINKS');
    if (!data.links.length) {
      lines.push('- None');
    }
    for (const link of data.links) {
      lines.push(`- ${link}`);
    }
  }

  return lines;
}

export function createSimplePdf(lines) {
  const safeLines = lines
    .map((line) => String(line).slice(0, 110))
    .map((line) => escapePdfText(line))
    .slice(0, 50);

  let content = 'BT\\n/F1 10 Tf\\n72 760 Td\\n';

  safeLines.forEach((line, index) => {
    if (index > 0) {
      content += '0 -14 Td\\n';
    }
    content += `(${line}) Tj\\n`;
  });

  content += 'ET';

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\\nstream\\n${content}\\nendstream`
  ];

  let pdf = '%PDF-1.4\\n';
  const offsets = [0];

  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\\n${body}\\nendobj\\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\\n0 ${objects.length + 1}\\n`;
  pdf += '0000000000 65535 f \\n';

  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \\n`;
  }

  pdf += `trailer\\n<< /Size ${objects.length + 1} /Root 1 0 R >>\\nstartxref\\n${xrefOffset}\\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

export function buildPdfBytesFromVersion({ cvType, version, effectiveFieldVisibility }) {
  const lines = buildPdfLines({
    cvTypeName: cvType.name,
    versionLabel: version.label,
    snapshot: version.snapshot,
    effectiveFieldVisibility,
    createdAt: version.createdAt
  });

  return createSimplePdf(lines);
}

function escapePdfText(value) {
  return value
    .replace(/\\\\/g, '\\\\\\\\')
    .replace(/\(/g, '\\\\(')
    .replace(/\)/g, '\\\\)')
    .replace(/\r?\n/g, ' ');
}
