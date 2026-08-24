import { parseFreeText } from '../../engine/freetext.js';
import { loadQuestions, nextQuestions, phaseQuestions, unskipQuestion } from '../../engine/interview.js';
import { editTagFor } from '../../core/provenance.js';
import { getPath } from '../../core/paths.js';
import { assayView, scopeWrite } from '../../core/assay.js';
import { resolveReadoutCanonical } from '../../engine/controls.js';
import { buildProposalSchema } from '../../engine/llmschema.js';
import { parseLlmAsks, parseLlmProposals } from '../../engine/llmproposals.js';
import { buildProjectReview } from '../../engine/projectReview.js';
import { renderProposalRequestPrompt, PROPOSAL_SYSTEM_PROMPT } from '../../engine/render/llmdraftprompt.js';
import { extractJsonReply } from '../../engine/llmreply.js';
import { createOllamaProvider } from '../../llm/ollama.js';
import { localEndpointCallsAvailable } from '../../llm/availability.js';
import { recordOllamaRequest } from '../../llm/rateLimit.js';
import { createAdvicePanel } from '../advice.js';
import { createProjectModelOptions } from '../projectModelOptions.js';
import { createProjectReview } from '../projectReview.js';
import { rateLimitLabel } from '../rateLimitLabel.js';
import { startModelProgress } from '../llmStatus.js';
import { copyToClipboard } from '../clipboard.js';
import { renderFieldInterview } from '../fieldInterview.js';
import { coerceAnswer } from '../questionControl.js';

const OLLAMA_PROPOSAL_SYSTEM_PROMPT = `${PROPOSAL_SYSTEM_PROMPT}\n- Return JSON matching the supplied schema and nothing else.`;
const MAX_DISMISSED_CANDIDATES = 50;

function issue(field, message) {
  return { field, message, severity: 'error' };
}

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

function safeModelFailureDetail(error) {
  const name = typeof error?.name === 'string' ? error.name : 'Error';
  const message = typeof error?.message === 'string' ? error.message : 'The local model request failed.';
  const raw = `${name}: ${message}`;
  const redacted = raw
    .replace(/\b(?:https?|wss?):\/\/[^\s'"`]+/gi, '[endpoint redacted]')
    .replace(/\b(?:authorization|bearer|token|api[_ -]?key)\b\s*[:=]?\s*[^\s,;]+/gi, '[credential redacted]');
  return redacted.slice(0, 300);
}

/**
 * Project's one workspace: a narrative, an always-present review, and the
 * active assay's Project field grid. Review state is session-only and bound
 * to the exact narrative text and assay id that produced it.
 */
export function createDescribeStep(kb) {
  const { questions: questionBank, issues: questionIssues } = loadQuestions(kb.questions);
  if (questionIssues.length) console.error('Question bank issues:', questionIssues);

  let session = null;
  let activeRequest = null;
  let generation = 0;
  let stopElapsed = null;
  let elapsedHost = null;

  function stopElapsedLabel() {
    if (stopElapsed) stopElapsed();
    stopElapsed = null;
    if (elapsedHost) elapsedHost.textContent = '';
  }

  function stopRequest(reason = 'cancelled') {
    generation += 1;
    if (activeRequest) activeRequest.abort();
    activeRequest = null;
    stopElapsedLabel();
    if (session && (session.status === 'scanning' || session.status === 'model-running')) session.status = reason;
  }

  return {
    id: 'describe',
    title: 'Research brief',
    render(main, store, { showToast, advisor, experience } = {}) {
      // Route/assay rendering replaces the DOM. Invalidate any old request so
      // it cannot mutate this persistent session after a newer render starts.
      stopRequest('cancelled');
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
        reviewButton.disabled = !textarea.value.trim() || activeRequest !== null;
      }

      const modelOptions = createProjectModelOptions();
      narrativeCard.appendChild(modelOptions.element);

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

      function sessionPrompt() {
        return session ? renderProposalRequestPrompt(session.openQuestions, session.narrative) : '';
      }

      function reviewState() {
        const binding = freshBinding();
        const view = assayView(store.get(), binding.assayId);
        if (!session) {
          return buildProjectReview({ status: 'idle', questions: questionBank, currentValues: currentValues(questionBank, view) });
        }
        const projection = buildProjectReview({
          status: session.status,
          questions: questionBank,
          currentValues: currentValues(questionBank, view),
          narrativeRevision: session.revision,
          assayId: session.assayId,
          currentNarrativeRevision: binding.narrative,
          currentAssayId: binding.assayId,
          exact: session.exact,
          local: session.local,
          paste: session.paste,
          dismissedCandidateIds: session.dismissedCandidateIds,
        });
        // Rendering may name a model, but the pure review authority remains
        // concerned only with candidates, bindings, and actionability.
        return {
          ...projection,
          exactOnly: session.exactOnly === true,
          modelLabel: session.modelLabel || '',
        };
      }

      const advicePanel = createAdvicePanel(advisor || [], 'describe');
      const review = createProjectReview({
        state: reviewState(),
        fallbackPrompt: sessionPrompt(),
        onAcceptCandidate: acceptCandidate,
        onDismissCandidate: dismissCandidate,
        onPasteReply: reviewPastedReply,
        onCancelReview: cancelReview,
        onCopyPrompt: copyPrompt,
      });
      reviewHost.appendChild(review.element);
      elapsedHost = review.elapsedHost;
      review.planningNotesHost.appendChild(advicePanel.element);

      function updateAdvice() {
        advicePanel.update(assayView(store.get(), store.get().activeAssayId));
        review.setPlanningNotesVisible(!advicePanel.element.hidden);
      }

      function renderReview() {
        review.update(reviewState(), {
          fallbackPrompt: sessionPrompt(),
          onAcceptCandidate: acceptCandidate,
          onDismissCandidate: dismissCandidate,
          onPasteReply: reviewPastedReply,
          onCancelReview: cancelReview,
          onCopyPrompt: copyPrompt,
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
        session.local = session.local || { proposals: [], asks: [], issues: [] };
        session.local.issues = Array.isArray(session.local.issues) ? session.local.issues : [];
        session.local.issues.push(issue('review', message));
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

      async function copyPrompt(prompt) {
        const ok = await copyToClipboard(typeof prompt === 'string' ? prompt : sessionPrompt());
        const message = ok ? 'Review prompt copied.' : 'Could not copy automatically. Select the prompt and copy it.';
        saveState.textContent = message;
        if (showToast) showToast(message);
      }

      function cancelReview() {
        if (!session || !activeRequest) return;
        generation += 1;
        activeRequest.abort();
        activeRequest = null;
        stopElapsedLabel();
        session.status = 'cancelled';
        syncReviewButton();
        renderReview();
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

      function reviewPastedReply(text) {
        if (!session) return;
        const binding = freshBinding();
        if (binding.narrative !== session.narrative || binding.assayId !== session.assayId) {
          session.status = 'stale';
          renderReview();
          return;
        }
        const extracted = extractJsonReply(text, { requireKey: 'proposals' });
        const parsed = parseLlmProposals(extracted.json, session.openQuestions, { narrative: session.narrative });
        const asks = parseLlmAsks(extracted.json);
        session.paste = {
          proposals: parsed.proposals,
          asks: asks.asks,
          repairs: extracted.repairs,
          issues: [...extracted.issues, ...parsed.issues, ...asks.issues],
        };
        session.exactOnly = false;
        session.status = 'complete';
        renderReview();
      }

      async function startReview() {
        const text = textarea.value;
        if (!text.trim()) {
          textarea.focus();
          emptyAlert.textContent = 'Add a study description before reviewing it.';
          emptyAlert.hidden = false;
          return;
        }
        emptyAlert.hidden = true;
        stopRequest('cancelled');
        const binding = freshBinding();
        const openQuestions = nextQuestions(questionBank, assayView(store.get(), binding.assayId), questionBank.length);
        const exactResult = parseFreeText(binding.narrative, kb.index);
        session = {
          narrative: binding.narrative,
          revision: binding.narrative,
          assayId: binding.assayId,
          openQuestions,
          exact: { proposals: exactResult.proposals, issues: [] },
          local: { proposals: [], asks: [], issues: [] },
          paste: { proposals: [], asks: [], issues: [] },
          dismissedCandidateIds: [],
          status: 'scanning',
          exactOnly: true,
          modelLabel: '',
        };
        renderReview(); // Exact matches render before a provider request starts.

        const config = modelOptions.getConfig();
        const limit = rateLimitLabel();
        if (!config.enabled) {
          session.status = 'complete';
          renderReview();
          return;
        }
        if (!localEndpointCallsAvailable()) {
          session.status = 'fallback';
          addSessionIssue('Local model calls are unavailable in this environment. Use copy and paste instead.');
          renderReview();
          return;
        }
        if (limit.atLimit) {
          session.status = 'fallback';
          addSessionIssue(`${limit.text}. Use copy and paste instead.`);
          renderReview();
          return;
        }
        const provider = createOllamaProvider(config);
        if (!provider.isAvailable()) {
          session.status = 'fallback';
          addSessionIssue('The local model is not configured. Use copy and paste instead.');
          renderReview();
          return;
        }

        const requestGeneration = ++generation;
        const controller = new AbortController();
        activeRequest = controller;
        session.status = 'model-running';
        session.modelLabel = config.model || 'your local model';
        reviewButton.disabled = true;
        stopElapsedLabel();
        stopElapsed = startModelProgress(review.elapsedHost, review.progressActivityHost, session.modelLabel);
        renderReview();
        try {
          recordOllamaRequest();
          const result = await provider.complete({
            system: OLLAMA_PROPOSAL_SYSTEM_PROMPT,
            user: renderProposalRequestPrompt(openQuestions, binding.narrative),
            schema: buildProposalSchema(openQuestions),
            signal: controller.signal,
          });
          if (requestGeneration !== generation || activeRequest !== controller) return;
          if (!result || !result.json) {
            session.status = 'fallback';
            addSessionIssue('The local model returned no valid JSON. Use copy and paste instead.');
            renderReview();
            return;
          }
          const parsed = parseLlmProposals(result.json, openQuestions, { narrative: binding.narrative });
          const asks = parseLlmAsks(result.json);
          session.local = { proposals: parsed.proposals, asks: asks.asks, issues: [...parsed.issues, ...asks.issues] };
          session.exactOnly = false;
          session.status = 'complete';
          renderReview();
        } catch (error) {
          if (requestGeneration !== generation || activeRequest !== controller) return;
          session.status = controller.signal.aborted ? 'cancelled' : 'fallback';
          if (!controller.signal.aborted) {
            addSessionIssue(`The local model could not be reached. ${safeModelFailureDetail(error)}`);
          }
          renderReview();
        } finally {
          if (requestGeneration === generation && activeRequest === controller) {
            activeRequest = null;
            stopElapsedLabel();
            syncReviewButton();
          }
        }
      }

      textarea.addEventListener('input', () => {
        // Do not normalize text: it is the evidence source for every model
        // interpretation and must remain byte-for-byte what the user typed.
        store.setPath('narrative.text', textarea.value, 'user');
        saveState.textContent = 'Description is saved with this study.';
        emptyAlert.hidden = true;
        syncReviewButton();
        if (session && textarea.value !== session.narrative) {
          stopRequest('stale');
          session.status = 'stale';
          syncReviewButton();
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
