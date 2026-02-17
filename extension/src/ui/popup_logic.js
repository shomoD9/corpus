export function sortVersionsForPopup(versions, defaultVersionId) {
  const list = Array.isArray(versions) ? [...versions] : [];

  return list.sort((a, b) => {
    if (a.id === defaultVersionId) {
      return -1;
    }

    if (b.id === defaultVersionId) {
      return 1;
    }

    return String(a.label).localeCompare(String(b.label), undefined, { numeric: true });
  });
}

export function buildVersionActionModel({ cvTypeId, versionId, exportsIndex }) {
  const key = `${cvTypeId}:${versionId}`;
  const entry = exportsIndex?.[key] || null;

  return {
    exportKey: key,
    hasExport: Boolean(entry?.driveFileId),
    link: entry?.webViewLink || '',
    driveFileId: entry?.driveFileId || ''
  };
}
