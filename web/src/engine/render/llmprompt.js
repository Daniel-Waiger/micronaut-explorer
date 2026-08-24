// "Export for your own LLM" (Wave 2D, alpha-pilot-readiness): builds a
// copy-paste block -- an instruction preamble, the study JSON, and a few
// suggested questions -- for whatever model the user already has open.
//
// UPDATE (local-llm-guidance): the app can now ALSO call a model directly,
// through web/src/llm/'s provider seam (manual-paste and opt-in local
// Ollama adapters). That seam was deliberately deferred when this file was
// first written -- see git history for the "never calls a model" version of
// this comment -- and is now open. What has NOT changed is the rule this
// module exists to keep true: the model never originates a domain fact; it
// may only emit IDs/values from a vocabulary the app supplies. Today that
// is enforced by construction (copy-paste, no write path exists). With the
// Ollama adapter it is enforced by JSON-schema constrained decoding
// (engine/llmschema.js builds an `enum` per question straight from that
// question's own options) PLUS provenance (a model's write lands tagged
// `llm`/`llm_freetext`, PROVISIONAL, and core/provenance.js's canOverwrite
// refuses to let it clobber anything the user actually set).
//
// The manual-paste path stays exactly as it was: opt-in, LAN-only when the
// Ollama adapter is used instead, no API key stored, and nothing leaves the
// user's own network unless they opt in and configure an endpoint
// themselves. Nothing here defaults to calling out anywhere.
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

const SUGGESTED_QUESTIONS = [
  'What is missing from my controls for the claims this design could support?',
  'Is the replication structure adequate for the comparison I am actually making?',
  'Which two channels in this panel are most likely to be confounded, and what would you change first?',
  'If I could only run half of these conditions as a pilot, which half answers the most?',
];

/**
 * `doc` is engine/studydoc.js's buildStudyDocument output. Returns one
 * plain-text block ready for the clipboard. TOTAL: never throws -- a
 * malformed/missing document still produces a valid block whose JSON
 * section is `null`, which is honest (the model sees there is no plan)
 * rather than a broken paste.
 */
export function renderLlmPrompt(doc) {
  return [
    PREAMBLE,
    '',
    '--- STUDY PLAN (JSON) ---',
    renderJson(doc),
    '',
    '--- QUESTIONS TO CONSIDER ---',
    ...SUGGESTED_QUESTIONS.map((q) => `- ${q}`),
    '',
    'Answer the questions above, or whatever I ask next, under the ground rules.',
  ].join('\n');
}
