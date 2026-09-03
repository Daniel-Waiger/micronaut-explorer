// "Export for your own LLM" (Wave 2D, alpha-pilot-readiness): builds a
// copy-paste block -- an instruction preamble, the study JSON, and a few
// suggested questions -- for whatever model the user already has open.
//
// This is now the ONLY model path in the app, and it is one-way. Micronaut
// briefly also called a local Ollama endpoint and parsed pasted model JSON
// back into study fields; that path is gone. The rule this module exists to
// keep true -- the model never originates a domain fact -- is therefore
// enforced by construction again, and by the strongest possible means: there
// is no write path for a model's output to travel down. Nothing a model says
// re-enters the study except by the researcher typing it.
//
// That also changes what this block should be FOR. Filling in fields was
// never the valuable part; the researcher has to check every suggestion
// anyway, which costs about what typing it costs. What a bench scientist
// genuinely cannot do alone is know which questions to ask about their own
// design -- so the block below carries the decisions the deterministic
// engines already know are still open (engine/conformance.js via
// engine/decisionTriage.js) and points the model at those specifically.
//
// The preamble is written AT the model, in the imperative, and states the
// constraints that actually matter for this domain: reason over the
// supplied data, never invent a marker/setting/control, say when something
// is missing rather than filling it in. A user pasting this into a chat
// gets a review, not a hallucinated protocol.
//
// Pure function: no DOM, no network. Takes the studydoc model (engine/
// studydoc.js) and reuses render/json.js for the payload, so the JSON a
// model sees is byte-identical to the JSON the "Download raw data" button
// produces -- one serialization, not two that could drift.

import { renderJson } from './json.js';

const PREAMBLE = [
  'You are reviewing a microscopy experiment plan produced by Micronaut Planner.',
  'The JSON below is the complete plan: measurements, readouts, modality, design axes,',
  'recommended controls (each with the reason it was recommended), the fluorophore',
  'panel, and every planned filename.',
  'A measurement is one observation or analysis used to answer the study question; some disciplines call it an assay.',
  'For compatibility, the machine-readable JSON keeps its measurements under the "assays" key.',
  '',
  'Ground rules for your answer:',
  '- Reason ONLY over what the JSON actually contains. Do not invent a marker, a',
  '  filter set, an instrument setting, a control, or a citation.',
  '- If something needed to answer is missing from the JSON, say that it is missing',
  '  and name it. Do not fill the gap with a plausible-sounding default.',
  '- The spectral values in this plan are drafted from common published references',
  '  and are NOT yet reviewed by a microscopy specialist. Treat exact peak numbers',
  '  as approximate, and say so if an answer depends on one.',
  '- This is a planning aid, not a validated instrument model. Real acquisition',
  '  settings must be confirmed at the microscope.',
].join('\n');

const DECISION_TIER_LABELS = {
  'study-shape': 'Study shape',
  'measurement-design': 'Measurement design',
  'before-acquisition': 'Before acquisition',
  later: 'Can be assigned later',
};

const MAX_PROMPT_DECISIONS_PER_TIER = 8;

// Turn the triage projection into a short, plainly-worded section. Bounded and
// TOTAL: a malformed or absent triage simply contributes no section rather
// than throwing inside a clipboard handler.
function renderOpenDecisions(decisions) {
  const groups = decisions && Array.isArray(decisions.groups) ? decisions.groups : [];
  const lines = [];
  for (const group of groups) {
    if (!group || !Array.isArray(group.items) || group.items.length === 0) continue;
    if (group.tier === 'later') continue; // Not worth a model's attention yet.
    const heading = DECISION_TIER_LABELS[group.tier] || 'Open decisions';
    const items = group.items
      .slice(0, MAX_PROMPT_DECISIONS_PER_TIER)
      .map((item) => {
        const label = typeof item?.label === 'string' && item.label.trim() ? item.label.trim() : null;
        if (!label) return null;
        const reason = typeof item?.reason === 'string' && item.reason.trim() ? ` -- ${item.reason.trim()}` : '';
        return `- ${label}${reason}`;
      })
      .filter(Boolean);
    if (items.length === 0) continue;
    lines.push(`${heading}:`, ...items, '');
  }
  if (lines.length === 0) return [];
  return [
    '--- DECISIONS THIS PLAN HAS NOT MADE YET ---',
    'Micronaut detected these deterministically. Prioritise them in your answer:',
    '',
    ...lines,
  ];
}

const SUGGESTED_QUESTIONS = [
  'What is missing from my controls for the claims this design could support?',
  'Is the replication structure adequate for the comparison I am actually making?',
  'Which two channels in this panel are most likely to be confounded, and what would you change first?',
  'If I could only run half of these conditions as a pilot, which half answers the most?',
];

/**
 * `doc` is engine/studydoc.js's buildStudyDocument output. `decisions` is an
 * optional engine/decisionTriage.js result; when supplied, the open decisions
 * it names are included so the model reviews the real gaps rather than
 * guessing at what matters. Returns one plain-text block ready for the
 * clipboard.
 *
 * TOTAL: never throws -- a malformed/missing document still produces a valid
 * block whose JSON section is `null`, which is honest (the model sees there is
 * no plan) rather than a broken paste, and a malformed triage simply omits its
 * section.
 */
export function renderLlmPrompt(doc, decisions) {
  return [
    PREAMBLE,
    '',
    '--- STUDY PLAN (JSON) ---',
    renderJson(doc),
    '',
    ...renderOpenDecisions(decisions),
    '--- QUESTIONS TO CONSIDER ---',
    ...SUGGESTED_QUESTIONS.map((q) => `- ${q}`),
    '',
    'Answer the questions above, or whatever I ask next, under the ground rules.',
  ].join('\n');
}
