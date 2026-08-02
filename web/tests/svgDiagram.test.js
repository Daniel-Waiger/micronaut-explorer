import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDiagramLayout } from '../src/engine/render/svgDiagram.js';

// A minimal studydoc-shaped fixture -- buildDiagramLayout reads only the
// fields asserted here, and is TOTAL over anything missing.
function docWith(assays, study = {}) {
  return { study, assays };
}

function assay(overrides = {}) {
  return {
    index: 1,
    label: 'Bacterial viability',
    readout: { state: 'known', label: 'Bacterial viability', text: 'viability' },
    modality: 'confocal',
    design: { arms: ['CTL', 'OPP'], factors: [{ name: 'species', levels: ['A', 'B'] }] },
    controls: { panel: [{ id: 'p1' }], readout: [{ id: 'r1' }, { id: 'r2' }] },
    filenames: [{ filename: 'a' }, { filename: 'b' }, { filename: 'c' }, { filename: 'd' }],
    ...overrides,
  };
}

test('one assay produces the study node plus a 6-node column', () => {
  const layout = buildDiagramLayout(docWith([assay()], { title: 'My study' }));
  // 1 study + 6 rows (assay + readout/modality/design/controls/files).
  assert.equal(layout.nodes.length, 1 + 6);
  assert.equal(layout.nodes.filter((n) => n.type === 'study').length, 1);
  assert.equal(layout.nodes.filter((n) => n.type === 'assay').length, 1);
});

test('edges = per assay: 1 study->assay fan + 5 chain links', () => {
  const layout = buildDiagramLayout(docWith([assay(), assay(), assay()]));
  assert.equal(layout.edges.length, 3 * 6);
  // Every study->assay edge starts at the study node's bottom.
  const fanEdges = layout.edges.filter((e) => e.from === 'study');
  assert.equal(fanEdges.length, 3);
});

test('node captions and values carry the real content', () => {
  const [studyNode, assayNode, readoutNode, , designNode, controlsNode, filesNode] =
    buildDiagramLayout(docWith([assay()], { title: 'Oregano study' })).nodes;
  assert.equal(studyNode.value, 'Oregano study');
  assert.equal(assayNode.value, 'Bacterial viability');
  assert.equal(readoutNode.value, 'Bacterial viability');
  assert.match(designNode.value, /arm/);
  assert.equal(controlsNode.value, '3 control(s)'); // 1 panel + 2 readout
  assert.equal(filesNode.value, '4 planned');
});

test('study title falls back to research question then a default', () => {
  assert.equal(
    buildDiagramLayout(docWith([], { researchQuestion: 'Does X?' })).nodes[0].value,
    'Does X?'
  );
  assert.equal(buildDiagramLayout(docWith([], {})).nodes[0].value, 'Study');
});

test('long values are truncated with an ellipsis', () => {
  const long = 'A'.repeat(80);
  const node = buildDiagramLayout(docWith([], { title: long })).nodes[0];
  assert.ok(node.value.length < long.length);
  assert.ok(node.value.endsWith('…'));
});

test('TOTAL: an empty study yields just the study node, no edges, positive canvas', () => {
  const layout = buildDiagramLayout(docWith([]));
  assert.equal(layout.nodes.length, 1);
  assert.equal(layout.edges.length, 0);
  assert.ok(layout.width > 0 && layout.height > 0);
});

test('TOTAL: a malformed doc does not throw', () => {
  assert.doesNotThrow(() => buildDiagramLayout(undefined));
  assert.doesNotThrow(() => buildDiagramLayout({}));
  assert.doesNotThrow(() => buildDiagramLayout({ assays: [{}] }));
});

test('readout states render distinctly', () => {
  const known = buildDiagramLayout(docWith([assay({ readout: { state: 'known', label: 'ROS' } })]));
  const unanswered = buildDiagramLayout(docWith([assay({ readout: { state: 'unanswered' } })]));
  const readoutOf = (l) => l.nodes.find((n) => n.type === 'readout').value;
  assert.equal(readoutOf(known), 'ROS');
  assert.match(readoutOf(unanswered), /not answered/);
});

test('canvas width grows with the assay count', () => {
  const one = buildDiagramLayout(docWith([assay()])).width;
  const four = buildDiagramLayout(docWith([assay(), assay(), assay(), assay()])).width;
  assert.ok(four > one);
});

test('nodes never overflow the reported canvas', () => {
  const layout = buildDiagramLayout(docWith([assay(), assay(), assay(), assay()]));
  for (const n of layout.nodes) {
    assert.ok(n.x >= 0 && n.x + n.w <= layout.width, `node ${n.id} within width`);
    assert.ok(n.y >= 0 && n.y + n.h <= layout.height, `node ${n.id} within height`);
  }
});
