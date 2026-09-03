import { parseFreeText } from '../../engine/freetext.js';
import { loadQuestions, phaseQuestions, unskipQuestion } from '../../engine/interview.js';
import { editTagFor } from '../../core/provenance.js';
import { getPath } from '../../core/paths.js';
import { assayView, scopeWrite } from '../../core/assay.js';
import { resolveReadoutCanonical } from '../../engine/controls.js';
import { buildProjectReview } from '../../engine/projectReview.js';
import { createAdvicePanel } from '../advice.js';
import { createProjectReview } from '../projectReview.js';
import { renderFieldInterview } from '../fieldInterview.js';
import { coerceAnswer } from '../questionControl.js';

const MAX_DISMISSED_CANDIDATES = 50;

function currentValues(questions, experiment) {
  const values = {};
  for (const question of questions) values[question.field] = getPath(experiment, question.field);
  return values;
}

function writeReadoutCanonicalIfNeeded(store, question, value, tag, assayId, kb) {
  if (question.id !== 'readout') return true;
  const canonical = resolveReadoutCanonical(value, kb.readouts) || '';
  const { path, slotKey } = scopeWrite(store.get(), 'readout', assayId);
  return store.setPath(path, canonical, tag, { slotKey });
}

/**
 * Research brief's one workspace: a narrative, an always-present review, and
 * the active measurement's field grid.
 *
 * The review is a DETERMINISTIC EXACT-TEXT SCAN and nothing else. It reads
 * marker aliases, biological-replicate counts, magnification, and unambiguous
 * ISO dates straight out of the saved description, quotes the text it matched,
 * and waits for an explicit Accept. Everything it did not match stays narrative
 * -- the page never claims to have understood the whole description.
 *
 * There is no in-app model. Micronaut used to offer a local Ollama call and a
 * copy/paste round trip that parsed a model's JSON back into study fields, and
 * that path carried the entire request lifecycle: abort controllers, request
 * generations, rate limits, availability probes, evidence falsification checks.
 * It bought a researcher a few seconds of typing in exchange for reviewing
 * every suggestion anyway, and only worked for the few who had Ollama
 * installed. The model conversation worth having is about the science, and it
 * lives on Review as a one-way "Copy prompt for your own LLM" export -- nothing
 * a model writes is parsed back in, which is why nothing here has to defend
 * against it.
 *
 * Review state stays session-only and bound to the exact narrative text and
 * measurement id that produced it.
 */
export function createDescribeStep(kb) {
  const { questions: questionBank, issues: questionIssues } = loadQuestions(kb.questions);
  if (questionIssues.length) console.error('Question bank issues:', questionIssues);

  let session = null;

  return {
    id: 'describe',
    title: 'Research brief',
    render(main, store, { showToast, advisor, experience } = {}) {
      main.textContent = '';

      const renderAssayId = store.get().activeAssayId;
      const workspace = document.createElement('section');
      workspace.className = 'project-workspace';
      main.appendChild(workspace);

      const narrativeCard = document.createElement('section');
      narrativeCard.className = 'project-description-card';
      workspace.appendChild(narrativeCard);

      const heading = document.createElement('h1');
      heading.className = 'step-heading';
      heading.textContent = 'Research brief';
      narrativeCard.appendChild(heading);

      const scope = document.createElement('p');
      scope.className = 'project-description-help';
      scope.textContent = 'Shared across the whole study. Suggestions are never applied automatically.';
      narrativeCard.appendChild(scope);

      const intro = document.createElement('p');
      intro.className = 'proposals-empty supporting-description';
      intro.textContent = 'Describe the whole study -- its question, system or material, and purpose -- before planning individual measurement details.';
      narrativeCard.appendChild(intro);

      const descriptionLabel = document.createElement('label');
      descriptionLabel.htmlFor = 'project-description';
      descriptionLabel.textContent = 'Study description';
      narrativeCard.appendChild(descriptionLabel);

      const textarea = document.createElement('textarea');
      textarea.id = 'project-description';
      textarea.className = 'describe-textarea';
      textarea.placeholder = 'Write the question, organism, groups, samples, and relevant imaging context in your own words.';
      textarea.value = store.getPath('narrative.text') || '';
      textarea.setAttribute('aria-describedby', 'project-description-help project-description-save-state');
      narrativeCard.appendChild(textarea);

      const help = document.createElement('p');
      help.id = 'project-description-help';
      help.className = 'project-description-help';
      help.textContent = 'Write this in your own words. Micronaut saves the full description with this study; only suggestions you accept become structured fields.';
      narrativeCard.appendChild(help);

      const saveState = document.createElement('p');
      saveState.id = 'project-description-save-state';
      saveState.className = 'project-description-save-state';
      saveState.setAttribute('role', 'status');
      saveState.setAttribute('aria-live', 'polite');
      saveState.textContent = 'Description is saved with this study.';
      narrativeCard.appendChild(saveState);

      const emptyAlert = document.createElement('p');
      emptyAlert.id = 'project-description-empty-error';
      emptyAlert.className = 'project-description-empty-error';
      emptyAlert.setAttribute('role', 'alert');
      emptyAlert.hidden = true;
      narrativeCard.appendChild(emptyAlert);

      const reviewButton = document.createElement('button');
      reviewButton.type = 'button';
      reviewButton.className = 'read-button project-review-button';
      reviewButton.textContent = 'Review description';
      narrativeCard.appendChild(reviewButton);

      function syncReviewButton() {
        reviewButton.disabled = !textarea.value.trim();
      }

      const reviewHost = document.createElement('div');
      reviewHost.className = 'project-review-host';
      workspace.appendChild(reviewHost);

      const details = document.createElement('section');
      details.className = 'project-details';
      const detailsHeading = document.createElement('h2');
      detailsHeading.className = 'project-details-heading';
      const renderAssays = Array.isArray(store.get().assays) ? store.get().assays : [];
      const activeAssayIndex = renderAssays.findIndex((assay) => assay && assay.id === renderAssayId);
      const activeAssay = activeAssayIndex === -1 ? null : renderAssays[activeAssayIndex];
      const activeAssayLabel = activeAssay?.label || `Measurement ${Math.max(0, activeAssayIndex) + 1}`;
      detailsHeading.textContent = `Measurement details — ${activeAssayLabel}`;
      details.appendChild(detailsHeading);
      const assayBinding = document.createElement('p');
      assayBinding.className = 'project-details-assay-binding';
      assayBinding.textContent = `Accepted measurement details will apply only to: ${activeAssayLabel}.`;
      details.appendChild(assayBinding);
      const fieldHost = document.createElement('div');
      fieldHost.className = 'project-details-fields';
      details.appendChild(fieldHost);
      workspace.appendChild(details);

      function freshBinding() {
        const experiment = store.get();
        return {
          narrative: typeof experiment.narrative?.text === 'string' ? experiment.narrative.text : '',
          assayId: experiment.activeAssayId,
        };
      }

      function reviewState() {
        const binding = freshBinding();
        const view = assayView(store.get(), binding.assayId);
        if (!session) {
          return buildProjectReview({ status: 'idle', questions: questionBank, currentValues: currentValues(questionBank, view) });
        }
        return buildProjectReview({
          status: session.status,
          questions: questionBank,
          currentValues: currentValues(questionBank, view),
          narrativeRevision: session.revision,
          assayId: session.assayId,
          currentNarrativeRevision: binding.narrative,
          currentAssayId: binding.assayId,
          exact: session.exact,
          dismissedCandidateIds: session.dismissedCandidateIds,
        });
      }

      const advicePanel = createAdvicePanel(advisor || [], 'describe');
      const review = createProjectReview({
        state: reviewState(),
        onAcceptCandidate: acceptCandidate,
        onDismissCandidate: dismissCandidate,
      });
      reviewHost.appendChild(review.element);
      review.planningNotesHost.appendChild(advicePanel.element);

      function updateAdvice() {
        advicePanel.update(assayView(store.get(), store.get().activeAssayId));
        review.setPlanningNotesVisible(!advicePanel.element.hidden);
      }

      function renderReview() {
        review.update(reviewState(), {
          onAcceptCandidate: acceptCandidate,
          onDismissCandidate: dismissCandidate,
        });
        updateAdvice();
      }

      function renderFields() {
        const live = store.get();
        const assayId = live.activeAssayId;
        renderFieldInterview(fieldHost, {
          questions: phaseQuestions(questionBank, assayView(live, assayId), 'project'),
          experience,
          onCommit(question, rawValue) {
            const value = coerceAnswer(question, rawValue);
            if (value === '' || value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return;
            const experiment = store.get();
            const activeId = experiment.activeAssayId;
            const view = assayView(experiment, activeId);
            const tag = editTagFor(view.provenance?.slots?.[question.field]?.tag || null);
            const address = scopeWrite(experiment, question.field, activeId);
            if (!store.setPath(address.path, value, tag, { slotKey: address.slotKey })) return;
            if (!writeReadoutCanonicalIfNeeded(store, question, value, tag, activeId, kb)) {
              if (showToast) showToast('The linked readout value could not be saved. The measurement field remains visible.');
              return;
            }
            unskipQuestion(store.get(), question.id);
            store.patch({});
            renderFields();
            renderReview();
          },
        });
      }

      function addSessionIssue(message) {
        if (!session) return;
        session.exact = session.exact || { proposals: [], issues: [] };
        session.exact.issues = Array.isArray(session.exact.issues) ? session.exact.issues : [];
        session.exact.issues.push({ field: 'review', message, severity: 'error' });
      }

      function focusAfterCandidateAction(previousIndex) {
        const candidates = [...review.element.querySelectorAll('.project-review-candidate')];
        const next = candidates
          .slice(previousIndex + 1)
          .map((row) => row.querySelector('.project-review-accept:not([disabled]), .project-review-dismiss:not([disabled])'))
          .find(Boolean);
        if (next) next.focus();
        else if (typeof review.focusHeading === 'function') review.focusHeading();
      }

      function focusAfterDismissal(previousIndex) {
        const candidates = [...review.element.querySelectorAll('.project-review-candidate')];
        const nextCandidate = candidates[previousIndex] || candidates[candidates.length - 1];
        const next = nextCandidate?.querySelector(
          '.project-review-accept:not([disabled]), .project-review-dismiss:not([disabled])'
        );
        if (next) next.focus();
        else if (typeof review.focusHeading === 'function') review.focusHeading();
      }

      function dismissCandidate(candidateId) {
        const state = reviewState();
        const candidateIndex = state.candidates.findIndex((candidate) => candidate.id === candidateId);
        const candidate = candidateIndex === -1 ? null : state.candidates[candidateIndex];
        const binding = freshBinding();
        if (
          !session ||
          !candidate ||
          candidate.actionable !== true ||
          binding.narrative !== session.narrative ||
          binding.assayId !== session.assayId
        ) {
          return;
        }
        const dismissed = Array.isArray(session.dismissedCandidateIds)
          ? [...new Set(session.dismissedCandidateIds.filter((id) => typeof id === 'string'))]
          : [];
        if (dismissed.includes(candidate.id)) return;
        session.dismissedCandidateIds = [...dismissed, candidate.id].slice(0, MAX_DISMISSED_CANDIDATES);
        renderReview();
        focusAfterDismissal(candidateIndex);
      }

      function acceptCandidate(candidateId) {
        const state = reviewState();
        const candidateIndex = state.candidates.findIndex((item) => item.id === candidateId);
        const candidate = candidateIndex === -1 ? null : state.candidates[candidateIndex];
        const binding = freshBinding();
        if (!session || !candidate || !candidate.actionable || binding.narrative !== session.narrative || binding.assayId !== session.assayId) {
          addSessionIssue('This suggestion is no longer bound to the current description and measurement. Review again before accepting it.');
          if (session) session.status = 'stale';
          renderReview();
          return;
        }
        const question = questionBank.find((item) => item.field === candidate.path);
        if (!question) {
          addSessionIssue('This suggestion no longer maps to a supported Research brief field.');
          renderReview();
          return;
        }
        const experiment = store.get();
        const view = assayView(experiment, binding.assayId);
        const tag = editTagFor(view.provenance?.slots?.[question.field]?.tag || null);
        let address;
        try {
          address = scopeWrite(experiment, question.field, binding.assayId);
        } catch {
          addSessionIssue('The active measurement changed before this suggestion could be saved.');
          session.status = 'stale';
          renderReview();
          return;
        }
        if (!store.setPath(address.path, candidate.value, tag, { slotKey: address.slotKey })) {
          addSessionIssue('Micronaut could not save this suggestion. It remains here for review.');
          renderReview();
          return;
        }
        if (!writeReadoutCanonicalIfNeeded(store, question, candidate.value, tag, binding.assayId, kb)) {
          addSessionIssue('Micronaut could not save the linked readout value. This suggestion remains visible.');
          renderReview();
          return;
        }
        unskipQuestion(store.get(), question.id);
        store.patch({});
        renderFields();
        renderReview();
        focusAfterCandidateAction(candidateIndex);
      }

      // Synchronous by construction: there is no request to await, so the scan
      // cannot be stale, cancelled, or half-finished at the moment it renders.
      function startReview() {
        const text = textarea.value;
        if (!text.trim()) {
          textarea.focus();
          emptyAlert.textContent = 'Add a study description before reviewing it.';
          emptyAlert.hidden = false;
          return;
        }
        emptyAlert.hidden = true;
        const binding = freshBinding();
        const exactResult = parseFreeText(binding.narrative, kb.index);
        session = {
          narrative: binding.narrative,
          revision: binding.narrative,
          assayId: binding.assayId,
          exact: { proposals: exactResult.proposals, issues: [] },
          dismissedCandidateIds: [],
          status: 'complete',
        };
        renderReview();
      }

      textarea.addEventListener('input', () => {
        // Do not normalize text: it is the evidence source for every candidate
        // and must remain byte-for-byte what the user typed.
        store.setPath('narrative.text', textarea.value, 'user');
        saveState.textContent = 'Description is saved with this study.';
        emptyAlert.hidden = true;
        syncReviewButton();
        if (session && textarea.value !== session.narrative) {
          session.status = 'stale';
          renderReview();
        }
      });
      reviewButton.addEventListener('click', startReview);

      syncReviewButton();
      renderFields();
      updateAdvice();
    },
  };
}
