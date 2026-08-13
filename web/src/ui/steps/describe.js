import { parseFreeText } from '../../engine/freetext.js';
import {
  answeredQuestions,
  loadQuestions,
  nextQuestions,
  recordAnswer,
  skipQuestion,
  unskipQuestion,
} from '../../engine/interview.js';
import { editTagFor, isProvisional } from '../../core/provenance.js';
import { createAdvicePanel } from '../advice.js';
import { createGuidancePanel } from '../guidance.js';
import { assayView, scopeWrite } from '../../core/assay.js';
import { resolveReadoutCanonical } from '../../engine/controls.js';
import { buildStudyDocument } from '../../engine/studydoc.js';
import { BASE_TEMPLATE, NAMING_CONFIG } from './naming.js';
import { buildProposalSchema } from '../../engine/llmschema.js';
import { parseLlmProposals } from '../../engine/llmproposals.js';
import { buildDraftExperiment } from '../../core/draft.js';
import { createOllamaProvider } from '../../llm/ollama.js';
import { loadLlmConfig } from '../../llm/config.js';
import { stashDraft } from '../../core/persist.js';

const INTERVIEW_LIMIT = 8;

/**
 * Render a value for display in a proposal row -- markers proposals carry
 * a joined canonical string, everything else is a plain scalar.
 */
function displayValue(value) {
  return value === undefined || value === null ? '' : String(value);
}

// Sentinel <option> value meaning "the user picked Other" -- internal only,
// never written to the store (getValue() below always resolves it to the
// free-text box's actual content, or '' if that box is still empty).
const OTHER_OPTION_VALUE = '__other__';

/**
 * Build the control for a question, pre-filled with `initialValue`. Returns
 * `{element, getValue()}` rather than a bare element: a choice question with
 * `allowOther` composes a <select> + a free-text fallback, and the two need
 * one seam a plain element's native `.value` can't express.
 *
 * Shared by the "ask" list and the "your answers" list so the two can never
 * drift apart -- an editable answer must offer exactly the same choices (and
 * the same Other escape hatch) the original question did, or editing
 * silently becomes a different question.
 */
function buildQuestionControl(question, initialValue) {
  if (question.type === 'choice' || question.type === 'multi') {
    const select = document.createElement('select');
    select.className = 'question-control';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '-- choose --';
    select.appendChild(blank);
    for (const option of question.options || []) {
      const opt = document.createElement('option');
      opt.value = option;
      opt.textContent = option;
      select.appendChild(opt);
    }

    if (!question.allowOther) {
      if (initialValue !== undefined && initialValue !== null) select.value = initialValue;
      return { element: select, getValue: () => select.value };
    }

    // allowOther: a generic escape hatch for ANY choice question, not
    // special-cased to modality. Picking "Other..." reveals a free-text box;
    // getValue() always resolves through it, never the sentinel itself, so a
    // saved answer is the user's own text, indistinguishable from having
    // typed it into a plain text question.
    const otherOpt = document.createElement('option');
    otherOpt.value = OTHER_OPTION_VALUE;
    otherOpt.textContent = 'Other...';
    select.appendChild(otherOpt);

    const otherInput = document.createElement('input');
    otherInput.type = 'text';
    otherInput.className = 'question-control question-other-input';
    otherInput.placeholder = 'Type it in';
    otherInput.hidden = true;

    function syncOtherVisibility() {
      otherInput.hidden = select.value !== OTHER_OPTION_VALUE;
    }
    select.addEventListener('change', syncOtherVisibility);

    // A previously-saved value that is NOT one of the curated options means
    // the user already typed a custom answer -- reopen as Other with that
    // text prefilled, rather than silently failing to preselect anything
    // (a bare <select>.value = 'unknown option' just leaves it blank).
    if (initialValue !== undefined && initialValue !== null) {
      if ((question.options || []).includes(initialValue)) {
        select.value = initialValue;
      } else {
        select.value = OTHER_OPTION_VALUE;
        otherInput.value = initialValue;
      }
    }
    syncOtherVisibility();

    const wrapper = document.createElement('div');
    wrapper.className = 'question-control-group';
    wrapper.appendChild(select);
    wrapper.appendChild(otherInput);

    return {
      element: wrapper,
      getValue: () => (select.value === OTHER_OPTION_VALUE ? otherInput.value : select.value),
    };
  }

  const input = document.createElement('input');
  input.type = question.type === 'number' ? 'number' : 'text';
  input.className = 'question-control';
  if (initialValue !== undefined && initialValue !== null) {
    input.value = initialValue;
  }
  return { element: input, getValue: () => input.value };
}

/** Coerce a control's raw string back to the question's declared type. */
function coerceAnswer(question, raw) {
  return question.type === 'number' ? Number(raw) : raw;
}

/**
 * The `readout` question (web/kb/questions.json) is the one question that
 * needs a SECOND write alongside its own field: `field: 'readoutText'`
 * stores the user's verbatim pick (curated option or Other free text), and
 * `readout` stores the canonical id engine/controls.js's rules key on --
 * see docs/plans/planner-web-assay-tier.md Decision 5 ("readout is a
 * controlled vocabulary, and 'unknown' is never silence"). This is a
 * one-off special case, not a generic multi-field-question mechanism: no
 * other question needs it, and inventing one for a single caller would be
 * exactly the kind of premature abstraction this codebase avoids elsewhere.
 * Canonicalization happens HERE, at answer time, not as a runtime derivation
 * inside assayView -- core/assay.js is a pure leaf with no KB imports, and
 * this is the one place both the readouts KB and a live write are in scope
 * together.
 */
function writeReadoutCanonicalIfNeeded(store, question, readoutText, tag, assayId, kb) {
  if (question.id !== 'readout') return;
  const canonical = resolveReadoutCanonical(readoutText, kb.readouts) || '';
  const { path, slotKey } = scopeWrite(store.get(), 'readout', assayId);
  store.setPath(path, canonical, tag, { slotKey });
}

// The system prompt for study-drafting (Wave B). Separate from
// engine/render/llmprompt.js's GUIDANCE_PREAMBLE because the roles differ:
// guidance NARRATES and must never answer for the user, this one answers
// exactly the supplied questions and nothing else. The schema
// (engine/llmschema.js) is what actually enforces the vocabulary; this text
// only explains the job, and every returned value is re-checked against the
// options anyway (engine/llmproposals.js).
const DRAFT_SYSTEM_PROMPT = [
  'You are filling in a microscopy experiment plan from the researcher’s own description.',
  '',
  'Rules:',
  '- Answer ONLY the questions supplied, using ONLY the options offered for each.',
  '- Omit any question the description does not actually answer. An omission is',
  '  correct and expected; a guess is not. Do not infer a value to be helpful.',
  '- Never invent a marker, filter, control, instrument setting, or option that is',
  '  not in the list you were given.',
  '- Return JSON matching the supplied schema and nothing else.',
].join('\n');

export function createDescribeStep(kb) {
  const { questions: questionBank, issues: questionIssues } = loadQuestions(kb.questions);
  if (questionIssues.length > 0) {
    // The question bank is committed, curated data -- if it somehow ships
    // broken, fail loudly to the console rather than silently asking fewer
    // questions than intended. Never throws: the interview simply runs with
    // whatever subset of questions DID load.
    console.error('Question bank issues:', questionIssues);
  }

  return {
    id: 'describe',
    title: 'Describe',
    render(main, store, { showToast, advisor } = {}) {
      main.textContent = '';

      // Commit 1 of the assay tier (schema v3): every experiment has
      // exactly one assay and no switcher exists yet, so the active assay
      // never changes for the lifetime of one render -- caching its id once
      // here is safe, matching design.js/naming.js's identical idiom.
      const assayId = store.get().activeAssayId;

      const heading = document.createElement('h1');
      heading.className = 'step-heading';
      heading.textContent = 'Describe what you did';
      main.appendChild(heading);

      const textarea = document.createElement('textarea');
      textarea.className = 'describe-textarea';
      textarea.placeholder =
        'Paste or type a paragraph describing this experiment -- e.g. "Confocal of mouse cortex at 63x, stained with DAPI and Alexa 488, n=3, comparing WT vs KO."';
      textarea.value = store.getPath('narrative.text') || '';
      main.appendChild(textarea);

      const readButton = document.createElement('button');
      readButton.type = 'button';
      readButton.className = 'read-button';
      readButton.textContent = 'Read it';
      main.appendChild(readButton);

      // Only offered when a local model is actually configured -- the draft
      // flow needs schema-constrained decoding, which the manual-paste
      // provider cannot do (a human pasting a reply back by hand has no
      // `format` field). Showing a button that can only fail would be worse
      // than not showing one.
      const draftButton = document.createElement('button');
      draftButton.type = 'button';
      draftButton.className = 'draft-button';
      draftButton.textContent = 'Draft a study from this (new tab)';
      draftButton.title =
        'Sends this description to your local model and opens the drafted study in a NEW tab. This study is not touched.';
      draftButton.hidden = !loadLlmConfig().enabled;
      main.appendChild(draftButton);

      // advisor may be undefined (a caller that hasn't wired it, or a KB
      // that failed to load) -- createAdvicePanel([], ...) is completely
      // inert, not a missing-argument crash. Guidance sits above the
      // Proposals section: something worth knowing before you start
      // answering, not after.
      const advicePanel = createAdvicePanel(advisor || [], 'describe');
      main.appendChild(advicePanel.element);
      function updateAdvice() {
        advicePanel.update(assayView(store.get(), assayId));
      }

      // Guidance (local-llm-guidance): read-only, opt-in "ask about this
      // step" panel. `currentAskable` is refreshed by renderInterview below
      // on every call, so getContext() always reflects whatever the user is
      // actually looking at, not a snapshot from when the panel mounted.
      let currentAskable = [];
      const guidancePanel = createGuidancePanel(() => ({
        doc: buildStudyDocument(store.get(), kb, NAMING_CONFIG, BASE_TEMPLATE),
        questions: currentAskable,
      }));
      main.appendChild(guidancePanel.element);

      const proposalsHeading = document.createElement('div');
      proposalsHeading.className = 'proposals-heading';
      proposalsHeading.textContent = 'Proposals';
      main.appendChild(proposalsHeading);

      const proposalsList = document.createElement('div');
      proposalsList.className = 'proposals-list';
      main.appendChild(proposalsList);

      const interviewHeading = document.createElement('div');
      interviewHeading.className = 'interview-heading';
      interviewHeading.textContent = 'Questions';
      main.appendChild(interviewHeading);

      const interviewList = document.createElement('div');
      interviewList.className = 'interview-list';
      main.appendChild(interviewList);

      const answeredHeading = document.createElement('div');
      answeredHeading.className = 'interview-heading';
      answeredHeading.textContent = 'Your answers';
      main.appendChild(answeredHeading);

      const answeredList = document.createElement('div');
      answeredList.className = 'interview-list answered-list';
      main.appendChild(answeredList);

      // Proposals are held here (not written to the store) until the user
      // explicitly Accepts one -- a proposal is a suggestion, never applied
      // automatically. This repo has already shipped a silent-auto-apply
      // defect once (the T10 describer-override work); the fix here is
      // structural, not a reminder.
      let pendingProposals = [];

      function renderProposals() {
        proposalsList.textContent = '';
        if (pendingProposals.length === 0) {
          const empty = document.createElement('p');
          empty.className = 'proposals-empty';
          empty.textContent = textarea.value
            ? 'Click "Read it" to scan the paragraph above.'
            : 'Nothing to scan yet.';
          proposalsList.appendChild(empty);
          return;
        }
        for (const proposal of pendingProposals) {
          const row = document.createElement('div');
          row.className = 'proposal-row';

          const text = document.createElement('div');
          text.className = 'proposal-text';
          const valueSpan = document.createElement('strong');
          valueSpan.textContent = displayValue(proposal.value);
          text.appendChild(valueSpan);
          const evidenceSpan = document.createElement('span');
          evidenceSpan.className = 'proposal-evidence';
          // A markers proposal can carry several distinct hits (e.g.
          // ATTO647N + ATTO647) folded into one joined `value` -- show
          // every match's evidence, not just the first, so the user can see
          // what actually justified each part of the proposed value.
          const evidenceText = Array.isArray(proposal.matches)
            ? proposal.matches.map((m) => `"${m.evidence}"`).join(', ')
            : `"${proposal.evidence}"`;
          evidenceSpan.textContent = ` -- from ${evidenceText}`;
          text.appendChild(evidenceSpan);
          row.appendChild(text);

          const actions = document.createElement('div');
          actions.className = 'proposal-actions';

          const acceptBtn = document.createElement('button');
          acceptBtn.type = 'button';
          acceptBtn.className = 'proposal-accept';
          acceptBtn.textContent = 'Accept';
          acceptBtn.addEventListener('click', () => {
            // proposal.path is a v2-shaped path from engine/freetext.js
            // (e.g. 'naming.fields.markers') -- assay-scoped like every
            // question field, so it needs scopeWrite too.
            const { path, slotKey } = scopeWrite(store.get(), proposal.path, assayId);
            const applied = store.setPath(path, proposal.value, proposal.tag, { slotKey });
            pendingProposals = pendingProposals.filter((p) => p !== proposal);
            renderProposals();
            renderInterview();
            renderAnswered();
            // setPath's return value is the ONLY signal that a write was
            // refused (a stronger value already occupies that slot) -- a
            // refused Accept must not look identical to a successful one.
            if (!applied && showToast) {
              showToast(
                `Couldn't apply "${displayValue(proposal.value)}" -- a stronger value is already set there.`
              );
            }
          });
          actions.appendChild(acceptBtn);

          const dismissBtn = document.createElement('button');
          dismissBtn.type = 'button';
          dismissBtn.className = 'proposal-dismiss';
          dismissBtn.textContent = 'Dismiss';
          dismissBtn.addEventListener('click', () => {
            pendingProposals = pendingProposals.filter((p) => p !== proposal);
            renderProposals();
          });
          actions.appendChild(dismissBtn);

          row.appendChild(actions);
          proposalsList.appendChild(row);
        }
      }

      function renderInterview() {
        // Called from both renderInterview and renderAnswered below (they
        // are always called in pairs at every call site today) rather than
        // at each individual call site -- fewer places to maintain, and it
        // stays correct even if a future call site calls only one of the two.
        updateAdvice();
        interviewList.textContent = '';
        // assayView() also carries the study-level provenance.skipped array
        // through unchanged (see core/assay.js's projectProvenance), so
        // nextQuestions' isSkipped check is unaffected by the assay scoping
        // below -- only the per-question field paths need it.
        const askable = nextQuestions(questionBank, assayView(store.get(), assayId), INTERVIEW_LIMIT);
        currentAskable = askable;
        if (askable.length === 0) {
          const done = document.createElement('p');
          done.className = 'interview-empty';
          done.textContent = 'No more questions right now.';
          interviewList.appendChild(done);
          return;
        }

        for (const question of askable) {
          const row = document.createElement('div');
          row.className = 'question-row';

          const prompt = document.createElement('div');
          prompt.className = 'question-prompt';
          prompt.textContent = question.prompt;
          row.appendChild(prompt);

          const why = document.createElement('div');
          why.className = 'question-why';
          why.textContent = question.why;
          row.appendChild(why);

          // A pre-filled answer must never look like one the user gave. The
          // control below is populated either way (that is the point of
          // suggestedDefault), so the ONLY thing distinguishing a model's
          // guess from a confirmed answer is this badge -- without it, the
          // provisional tier would be invisible exactly where it matters.
          if (question.suggestedTag && isProvisional(question.suggestedTag)) {
            const badge = document.createElement('div');
            badge.className = 'question-provisional';
            badge.textContent = 'Suggested by the model — confirm or change it';
            row.appendChild(badge);
          }

          const control = buildQuestionControl(question, question.suggestedDefault);
          row.appendChild(control.element);

          const actions = document.createElement('div');
          actions.className = 'question-actions';

          const answerBtn = document.createElement('button');
          answerBtn.type = 'button';
          answerBtn.className = 'question-answer';
          answerBtn.textContent = 'Answer';
          answerBtn.addEventListener('click', () => {
            const raw = control.getValue();
            if (!raw) return;
            const descriptor = recordAnswer(store.get(), question, coerceAnswer(question, raw));
            const { path, slotKey } = scopeWrite(store.get(), descriptor.path, assayId);
            // Confirming a PRE-FILLED question (a freetext parse or an LLM
            // draft) is the user CORRECTING a machine-sourced guess, which
            // provenance.js's editTagFor documents as 'user_edited' -- and
            // repo lesson E8 requires be distinguishable from a value typed
            // fresh. recordAnswer's own tag is always the question bank's
            // plain 'user', which is right only for a first-ever entry, so
            // the two cases have to be told apart here, exactly as the
            // answered-list's Update button below already does.
            const existingTag = store.get().provenance?.slots?.[slotKey]?.tag ?? null;
            const tag = existingTag ? editTagFor(existingTag) : descriptor.tag;
            store.setPath(path, descriptor.value, tag, { slotKey });
            writeReadoutCanonicalIfNeeded(store, question, descriptor.value, tag, assayId, kb);
            renderInterview();
            renderAnswered();
          });
          actions.appendChild(answerBtn);

          const skipBtn = document.createElement('button');
          skipBtn.type = 'button';
          skipBtn.className = 'question-skip';
          skipBtn.textContent = 'Skip';
          skipBtn.addEventListener('click', () => {
            skipQuestion(store.get(), question.id);
            store.patch({}); // no-op patch: triggers notify/autosave for the skip mutation above
            renderInterview();
            renderAnswered();
          });
          actions.appendChild(skipBtn);

          row.appendChild(actions);
          interviewList.appendChild(row);
        }
      }

      /**
       * The review list: everything already answered or skipped, each editable
       * in place. nextQuestions drops a question as soon as its slot goes
       * STRONG, so without this list an answer is write-once and invisible.
       */
      function renderAnswered() {
        updateAdvice(); // see the matching comment in renderInterview above
        answeredList.textContent = '';
        const reviewable = answeredQuestions(questionBank, assayView(store.get(), assayId));
        if (reviewable.length === 0) {
          const empty = document.createElement('p');
          empty.className = 'interview-empty';
          empty.textContent = 'Nothing answered yet.';
          answeredList.appendChild(empty);
          return;
        }

        for (const question of reviewable) {
          const row = document.createElement('div');
          row.className = 'question-row answered-row';

          const prompt = document.createElement('div');
          prompt.className = 'question-prompt';
          prompt.textContent = question.prompt;
          row.appendChild(prompt);

          const current = document.createElement('div');
          current.className = 'question-current';
          current.textContent =
            question.status === 'skipped'
              ? 'Skipped'
              : `Currently: ${displayValue(question.currentValue)}`;
          row.appendChild(current);

          const control = buildQuestionControl(question, question.currentValue);
          row.appendChild(control.element);

          const actions = document.createElement('div');
          actions.className = 'question-actions';

          const saveBtn = document.createElement('button');
          saveBtn.type = 'button';
          saveBtn.className = 'question-answer';
          saveBtn.textContent = question.status === 'skipped' ? 'Answer it' : 'Update';
          saveBtn.addEventListener('click', () => {
            const raw = control.getValue();
            if (!raw) return;
            // A revised answer is 'user_edited' when it overwrites a weaker or
            // provisional value and plain 'user' otherwise -- same rule the
            // naming step uses, so provenance stays consistent no matter which
            // surface the correction was made from.
            const { path, slotKey } = scopeWrite(store.get(), question.field, assayId);
            const existingTag = store.get().provenance?.slots?.[slotKey]?.tag ?? null;
            // Un-skip first: a skipped question being answered here must stop
            // being skipped, or it stays out of the ask list forever.
            unskipQuestion(store.get(), question.id);
            const coerced = coerceAnswer(question, raw);
            const tag = editTagFor(existingTag);
            store.setPath(path, coerced, tag, { slotKey });
            writeReadoutCanonicalIfNeeded(store, question, coerced, tag, assayId, kb);
            renderInterview();
            renderAnswered();
          });
          actions.appendChild(saveBtn);

          // Re-asking clears the answer's STRONG tag by removing the slot, so
          // the question returns to the ask list above rather than lingering
          // here with a value the user no longer stands behind.
          const reaskBtn = document.createElement('button');
          reaskBtn.type = 'button';
          reaskBtn.className = 'question-skip';
          reaskBtn.textContent = 'Ask me again';
          reaskBtn.addEventListener('click', () => {
            const experiment = store.get();
            unskipQuestion(experiment, question.id);
            const { slotKey } = scopeWrite(experiment, question.field, assayId);
            if (experiment.provenance?.slots) {
              delete experiment.provenance.slots[slotKey];
            }
            store.patch({}); // notify/autosave for the in-place mutations above
            renderInterview();
            renderAnswered();
          });
          actions.appendChild(reaskBtn);

          row.appendChild(actions);
          answeredList.appendChild(row);
        }
      }

      textarea.addEventListener('input', () => {
        store.setPath('narrative.text', textarea.value, 'user');
        // narrative.text has no dedicated renderX() of its own -- without
        // this call, a rule keyed on the narrative would never update while
        // the user is actually typing it.
        updateAdvice();
      });

      // Wave B: prose -> schema-constrained proposals -> a fresh study in a
      // new tab. Every value is re-validated against the question's own
      // options (engine/llmproposals.js) even though the schema should have
      // made an out-of-vocabulary answer impossible, and lands PROVISIONAL +
      // needsReview (core/draft.js) so nothing in the draft can pass as a
      // value the user chose.
      draftButton.addEventListener('click', async () => {
        const cfg = loadLlmConfig();
        const provider = createOllamaProvider({ endpoint: cfg.endpoint, model: cfg.model });
        if (!provider.isAvailable()) {
          if (showToast) showToast('Set a local model endpoint and name first (in "Ask about this step").');
          return;
        }
        const text = textarea.value.trim();
        if (!text) {
          if (showToast) showToast('Describe the experiment above first.');
          return;
        }

        draftButton.disabled = true;
        draftButton.textContent = 'Drafting...';
        try {
          const schema = buildProposalSchema(questionBank);
          const result = await provider.complete({
            system: DRAFT_SYSTEM_PROMPT,
            user: `--- QUESTIONS ---\n${questionBank
              .map((q) => {
                const options = Array.isArray(q.options) ? ` [options: ${q.options.join(', ')}]` : '';
                return `- ${q.field}: ${q.prompt}${options}`;
              })
              .join('\n')}\n\n--- DESCRIPTION ---\n${text}`,
            schema,
          });

          const { proposals, issues } = parseLlmProposals(result.json, questionBank);
          if (issues.length > 0) {
            // Not a failure: a dropped proposal is this tier working. Logged
            // rather than toasted so a partial draft still opens, with the
            // detail available to whoever is debugging the model's output.
            console.warn('Dropped LLM proposals:', issues);
          }
          if (proposals.length === 0) {
            if (showToast) showToast('The model did not fill in anything usable from that description.');
            return;
          }

          const { experiment: draft } = buildDraftExperiment(proposals);
          draft.narrative = { ...draft.narrative, text };
          if (!stashDraft(draft)) {
            if (showToast) showToast("Couldn't stash the draft (storage full?). Nothing was changed.");
            return;
          }
          const opened = window.open(window.location.href, '_blank');
          if (showToast) {
            showToast(
              opened
                ? `Drafted ${proposals.length} answer(s) -- opened in a new tab. This study is unchanged.`
                : 'Draft ready, but the browser blocked the new tab. Allow pop-ups and try again.'
            );
          }
        } catch (err) {
          if (showToast) showToast(`Couldn't reach the local model (${err.message}). Nothing was changed.`);
        } finally {
          draftButton.disabled = false;
          draftButton.textContent = 'Draft a study from this (new tab)';
        }
      });

      readButton.addEventListener('click', () => {
        const result = parseFreeText(textarea.value, kb.index);
        pendingProposals = result.proposals;
        renderProposals();
        updateAdvice();
        if (showToast) {
          showToast(
            pendingProposals.length > 0
              ? `Found ${pendingProposals.length} proposal(s) to review.`
              : 'Nothing recognizable found in that text.'
          );
        }
      });

      renderProposals();
      renderInterview();
      renderAnswered();
    },
  };
}
