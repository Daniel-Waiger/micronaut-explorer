// CSV renderer over engine/studydoc.js's document model -- a fourth thin
// renderer over the same single model already consumed by the HTML view,
// renderMarkdown, and renderMermaid (see studydoc.js's header for why one
// model / many renderers). Pure function: no DOM, no store.
//
// One row per planned file across every assay in the study, so this is a
// bench-usable manifest: which physical file goes with which condition.
// Crossing factors are flattened into one "factors" column (`name=level;
// name2=level2`) rather than one CSV column per factor name, because
// different assays in the same study can declare different factors --
// a fixed column set would either go ragged across assays or force a
// union-of-all-assays header that is mostly blank for most rows. This
// keeps the CSV rectangular regardless of how many assays/factors exist.
//
// TOTAL: never throws. A malformed/empty document renders as a
// header-only CSV, never a blank string and never a thrown error.

const HEADER = [
  'assay',
  'modality',
  'group',
  'factors',
  'biological_replicate',
  'technical_replicate',
  'planned_filename',
  'error',
];

// RFC 4180 minimal quoting: only quote a field that needs it, so the common
// case (a plain filename) stays readable unquoted.
function csvField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function factorsCell(factorLevels) {
  const entries = factorLevels && typeof factorLevels === 'object' ? Object.entries(factorLevels) : [];
  return entries.map(([name, level]) => `${name}=${level}`).join('; ');
}

export function renderCsv(doc) {
  const assays = doc && Array.isArray(doc.assays) ? doc.assays : [];
  const lines = [HEADER.join(',')];

  for (const assay of assays) {
    const label = assay.label || '';
    const modality = assay.modality || '';
    const filenames = Array.isArray(assay.filenames) ? assay.filenames : [];
    for (const entry of filenames) {
      const row = entry.row || {};
      lines.push(
        [
          csvField(label),
          csvField(modality),
          csvField(row.group ?? ''),
          csvField(factorsCell(row.factorLevels)),
          csvField(row.bioRep ?? ''),
          csvField(row.techRep ?? ''),
          csvField(entry.filename ?? ''),
          csvField(entry.error ?? ''),
        ].join(',')
      );
    }
  }

  // CRLF line endings: the conventional CSV wire format (RFC 4180), so the
  // export opens cleanly in spreadsheet tools that assume it.
  return lines.join('\r\n') + '\r\n';
}
