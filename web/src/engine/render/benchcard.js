// The bench card: a compact, print-oriented SINGLE-ASSAY summary -- the
// thing that goes next to the microscope, as opposed to render/markdown.js's
// whole-study walkthrough. Deliberately deferred out of the original
// Exports pass (docs/plans/planner-web-exports.md) because it needed real
// UX/content design, not just another renderer over the existing model;
// this is that design, done minimally: modality/specimen/readout, the
// channel table (target/fluorophore/ex-em/detection filter, from
// studydoc.js's panelRows --
// see its header for why that array exists), the recommended controls with
// their reasons (never a bare checklist -- see controls.json's own
// discipline: "a control the user does not understand is a control they
// will delete"), the condition count, and two worked filename examples.
//
// Markdown output, same format family as render/markdown.js, so it opens
// and prints cleanly from any editor/browser with zero new dependencies.
//
// Pure function: no DOM. Takes ONE assay from a studydoc (engine/
// studydoc.js's buildStudyDocument), not the whole document -- see this
// module's own name. TOTAL: a missing/malformed assay renders a one-line
// explanatory string, never throws.

// Prefixed `cardX` rather than the bare `heading`/`controlsSection`
// render/markdown.js already uses: the single-file build concatenates every
// module into ONE scope, so two top-level symbols of the same name across
// web/src is a hard build error (tools/build_single_file.py). These are
// deliberately NOT shared with markdown.js -- that renderer's own
// controlsSection produces a different, whole-study shape; only the names
// collided, not the behavior.
function cardHeading(level, text) {
  return `${'#'.repeat(level)} ${text}`;
}

function channelsTable(panelRows) {
  const rows = Array.isArray(panelRows) ? panelRows : [];
  if (rows.length === 0) {
    return '_No channels declared yet -- fill in the markers field or the structured panel on the Color panel step._';
  }
  const lines = [
    '| Target | Fluorophore | Ex/Em (nm) | Detection filter (center/bandwidth nm) |',
    '| --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    const target = row.target && row.target.trim() ? row.target.trim() : '--';
    const fluorophore = row.fluorophore && row.fluorophore.trim() ? row.fluorophore.trim() : '_(not named)_';
    const exEm = row.excitationPeakNm != null && row.emissionPeakNm != null ? `${row.excitationPeakNm}/${row.emissionPeakNm}` : '_(unresolved)_';
    const hasFilter =
      typeof row.filterCenterNm === 'number' &&
      Number.isFinite(row.filterCenterNm) &&
      typeof row.filterBandwidthNm === 'number' &&
      Number.isFinite(row.filterBandwidthNm) &&
      row.filterBandwidthNm > 0;
    const detectionFilter = hasFilter ? `${row.filterCenterNm}/${row.filterBandwidthNm}` : '_(not set)_';
    lines.push(`| ${target} | ${fluorophore} | ${exEm} | ${detectionFilter} |`);
  }
  return lines.join('\n');
}

function cardControlsSection(controls) {
  const all = [...((controls && controls.panel) || []), ...((controls && controls.readout) || [])];
  if (all.length === 0) return '_No controls recommended yet -- answer the readout and markers fields to see them._';
  return all.map((c) => `- **${c.title}** -- ${c.why}`).join('\n');
}

/**
 * `assay` is ONE entry from `studydoc.assays` (buildStudyDocument's output),
 * not the whole document -- callers pass `doc.assays.find(a => a.id ===
 * assayId)`. Returns a one-line explanatory string (never throws) if
 * `assay` is missing or malformed.
 */
export function renderBenchCard(assay) {
  if (!assay || typeof assay !== 'object') {
    return '_No such measurement -- nothing to show on a bench card._';
  }

  const specimenBits = [
    assay.specimen && assay.specimen.organism,
    assay.specimen && assay.specimen.sampleType,
    assay.specimen && assay.specimen.preparation,
  ].filter(Boolean);

  const lines = [
    cardHeading(1, `Measurement bench card -- ${assay.label || 'Untitled measurement'}`),
    '',
    `**Readout:** ${(assay.readout && assay.readout.text) || 'not answered yet'}`,
    `**Modality:** ${assay.modality || 'not answered yet'}`,
    `**Specimen:** ${specimenBits.length > 0 ? specimenBits.join(', ') : 'not answered yet'}`,
    `**Conditions:** ${(assay.design && assay.design.conditionCount) || 0} planned row(s)`,
    '',
    cardHeading(2, 'Channels'),
    channelsTable(assay.panelRows),
    '',
    cardHeading(2, 'Controls'),
    cardControlsSection(assay.controls),
    '',
    cardHeading(2, 'Filename pattern'),
  ];

  const examples = (Array.isArray(assay.filenames) ? assay.filenames : []).filter((f) => f.filename).slice(0, 2);
  if (examples.length === 0) {
    lines.push('_No planned filenames yet -- see the issues on the Samples & design step._');
  } else {
    for (const entry of examples) lines.push(`\`${entry.filename}\``);
  }

  return lines.join('\n') + '\n';
}
