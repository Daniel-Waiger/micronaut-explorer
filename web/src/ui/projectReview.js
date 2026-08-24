// DOM-only Project Review renderer. It consumes the pure projection from
// engine/projectReview.js but intentionally imports nothing: request parsing,
// providers, persistence, current-value reads, and accepted writes stay in
// the caller. Every mutable, user-editable fallback control stays mounted
// across update() calls so status refreshes cannot erase a pasted reply or
// steal its focus.

const MAX_RENDERED_GROUPS = 20;
const MAX_RENDERED_CANDIDATES = 30;
const MAX_RENDERED_ASKS = 12;
const MAX_RENDERED_REPAIRS = 12;
const MAX_RENDERED_ISSUES = 12;

const STATUS_TEXT = {
  idle: 'No review yet. Add a description, then choose Review description.',
  scanning: 'Checking exact text matches…',
  'model-running': 'Exact matches are ready. Checking with your local model…',
  complete: 'Review complete. Nothing has been added to your study.',
  fallback: 'The local model could not be reached. Your description is still saved, and nothing was added to the study.',
  stale: 'Description changed — review again before accepting suggestions.',
  cancelled: 'Model review cancelled. Exact matches remain available.',
  error: 'Review needs your attention. Nothing has been added to your study.',
};

const SOURCE_LABELS = {
  exact: 'Exact text match',
  local: 'Local model',
  paste: 'Pasted model response',
};

function projectReviewUiRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function projectReviewUiList(value) {
  return Array.isArray(value) ? value : [];
}

function appendText(parent, tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function displayValue(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '—';
}

function sourceLabel(source) {
  return SOURCE_LABELS[source] || 'Review source';
}

function boundedRows(items, cap) {
  return projectReviewUiList(items).slice(0, cap);
}

function candidateActionLabel(candidate) {
  const label = candidate.questionLabel || candidate.destination || 'field';
  const destination = candidate.destination || candidate.path || 'unknown field';
  const value = displayValue(candidate.value);
  if (candidate.currentState === 'different-from-current') {
    return `Replace current value for ${label} (${destination}) with ${value}`;
  }
  if (candidate.currentState === 'same-as-confirmed') {
    return `Accept already confirmed ${label} (${destination}): ${value}`;
  }
  return `Accept ${label} (${destination}): ${value}`;
}

function candidateDismissLabel(candidate) {
  const label = candidate.questionLabel || candidate.destination || 'field';
  const destination = candidate.destination || candidate.path || 'unknown field';
  return `Dismiss suggestion for ${label} (${destination}): ${displayValue(candidate.value)}`;
}

function statusText(state) {
  if (state && state.status === 'model-running') {
    return `Exact matches are ready. Checking with ${state.modelLabel || 'your local model'}…`;
  }
  const candidates = projectReviewUiList(state && state.candidates);
  const exactOnly =
    state &&
    state.status === 'complete' &&
    (state.exactOnly === true ||
      (candidates.length > 0 &&
        candidates.every((candidate) => projectReviewUiList(candidate && candidate.sources).every((source) => source === 'exact'))));
  if (exactOnly) {
    return 'Exact-text review complete. Micronaut kept everything else as narrative, not structured data.';
  }
  return STATUS_TEXT[state && state.status] || STATUS_TEXT.idle;
}

/**
 * Create the always-present Review renderer.
 *
 * `state` is a buildProjectReview(...) result. The caller supplies callbacks:
 * - `onAcceptCandidate(id)` receives only the stable candidate identity;
 * - `onDismissCandidate(id)` receives only the stable candidate identity;
 * - `onPasteReply(text)` receives a submitted fallback reply;
 * - `onPasteInput(text)` receives edits without the component storing them.
 *
 * `fallbackPrompt` is shown in a selectable read-only textarea. `update(state,
 * options)` refreshes review content while preserving the fallback reply's
 * value and focus; options may replace callbacks and/or fallbackPrompt.
 */
export function createProjectReview({
  state = {},
  fallbackPrompt = '',
  onAcceptCandidate,
  onDismissCandidate,
  onPasteReply,
  onPasteInput,
  onCancelReview,
  onCopyPrompt,
} = {}) {
  let handlers = { onAcceptCandidate, onDismissCandidate, onPasteReply, onPasteInput, onCancelReview, onCopyPrompt };

  const element = document.createElement('section');
  element.className = 'project-review';
  element.setAttribute('aria-label', 'Review');

  const heading = appendText(element, 'h2', 'project-review-heading', 'Review');
  heading.tabIndex = -1;
  const status = appendText(element, 'p', 'project-review-status', STATUS_TEXT.idle);
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  const elapsed = appendText(element, 'p', 'project-review-elapsed', '');
  elapsed.hidden = true;
  const progressRegion = document.createElement('div');
  progressRegion.className = 'project-review-progress';
  progressRegion.hidden = true;
  const progress = document.createElement('progress');
  progress.className = 'project-review-progress-bar';
  progress.setAttribute('aria-label', 'Local model review in progress');
  progressRegion.appendChild(progress);
  const progressActivity = appendText(progressRegion, 'p', 'project-review-progress-activity', '');
  progressActivity.setAttribute('role', 'status');
  progressActivity.setAttribute('aria-live', 'polite');
  element.appendChild(progressRegion);
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'project-review-cancel';
  cancelButton.textContent = 'Cancel model review';
  cancelButton.hidden = true;
  cancelButton.disabled = true;
  cancelButton.addEventListener('click', () => {
    if (!cancelButton.disabled && typeof handlers.onCancelReview === 'function') handlers.onCancelReview();
  });
  element.appendChild(cancelButton);
  appendText(
    element,
    'p',
    'project-review-session-disclosure',
    'Suggestions stay in this tab until you change the description or switch measurements. Accept a suggestion to save it.'
  );
  appendText(
    element,
    'p',
    'project-review-model-disclosure',
    'Model suggestions are interpretations, not facts. Review the quoted evidence before accepting one.'
  );

  const suggestions = document.createElement('section');
  suggestions.className = 'project-review-suggestions';
  suggestions.setAttribute('aria-labelledby', 'project-review-suggested-fields');
  appendText(suggestions, 'h3', 'project-review-section-heading', 'Suggested fields').id = 'project-review-suggested-fields';
  const suggestionsBody = document.createElement('div');
  suggestionsBody.className = 'project-review-suggestions-body';
  suggestions.appendChild(suggestionsBody);
  element.appendChild(suggestions);

  const decisions = document.createElement('section');
  decisions.className = 'project-review-decisions';
  decisions.setAttribute('aria-labelledby', 'project-review-needs-decision');
  appendText(decisions, 'h3', 'project-review-section-heading', 'Needs your decision').id = 'project-review-needs-decision';
  const decisionsBody = document.createElement('div');
  decisionsBody.className = 'project-review-decisions-body';
  decisions.appendChild(decisionsBody);
  element.appendChild(decisions);

  const notConverted = document.createElement('section');
  notConverted.className = 'project-review-not-converted';
  notConverted.setAttribute('aria-labelledby', 'project-review-not-converted');
  appendText(notConverted, 'h3', 'project-review-section-heading', 'Not converted').id = 'project-review-not-converted';
  appendText(
    notConverted,
    'p',
    'project-review-noncoverage',
    'Micronaut does not treat the rest of this description as structured data. It remains in the saved narrative.'
  );
  const notConvertedBody = document.createElement('div');
  notConvertedBody.className = 'project-review-not-converted-body';
  notConverted.appendChild(notConvertedBody);
  const technicalErrors = document.createElement('details');
  technicalErrors.className = 'project-review-technical-errors reveal';
  technicalErrors.hidden = true;
  const technicalErrorsSummary = document.createElement('summary');
  technicalErrorsSummary.className = 'reveal-summary';
  technicalErrorsSummary.textContent = 'Technical details';
  technicalErrors.appendChild(technicalErrorsSummary);
  const technicalErrorsBody = document.createElement('ul');
  technicalErrorsBody.className = 'project-review-issues';
  technicalErrors.appendChild(technicalErrorsBody);
  notConverted.appendChild(technicalErrors);
  element.appendChild(notConverted);

  const fallbackDetails = document.createElement('details');
  fallbackDetails.className = 'project-review-fallback reveal';
  const fallbackSummary = document.createElement('summary');
  fallbackSummary.className = 'reveal-summary';
  fallbackSummary.textContent = 'Use copy and paste instead';
  fallbackDetails.appendChild(fallbackSummary);
  const fallbackHint = appendText(
    fallbackDetails,
    'p',
    'project-review-fallback-hint',
    'Copy the prompt into a model you choose, then paste only its reply here. Pasting never changes your study by itself.'
  );
  fallbackHint.id = 'project-review-fallback-hint';

  const promptLabel = document.createElement('label');
  promptLabel.htmlFor = 'project-review-copy-prompt';
  promptLabel.textContent = 'Prompt to copy';
  fallbackDetails.appendChild(promptLabel);
  const promptBox = document.createElement('textarea');
  promptBox.id = 'project-review-copy-prompt';
  promptBox.className = 'project-review-copy-prompt';
  promptBox.readOnly = true;
  promptBox.setAttribute('aria-describedby', fallbackHint.id);
  promptBox.value = typeof fallbackPrompt === 'string' ? fallbackPrompt : '';
  fallbackDetails.appendChild(promptBox);
  const copyPromptButton = document.createElement('button');
  copyPromptButton.type = 'button';
  copyPromptButton.className = 'project-review-copy-prompt-button';
  copyPromptButton.textContent = 'Copy review prompt';
  copyPromptButton.addEventListener('click', () => {
    if (typeof handlers.onCopyPrompt === 'function') handlers.onCopyPrompt(promptBox.value);
  });
  fallbackDetails.appendChild(copyPromptButton);

  const replyLabel = document.createElement('label');
  replyLabel.htmlFor = 'project-review-pasted-reply';
  replyLabel.textContent = 'Paste the model response';
  fallbackDetails.appendChild(replyLabel);
  const replyBox = document.createElement('textarea');
  replyBox.id = 'project-review-pasted-reply';
  replyBox.className = 'project-review-pasted-reply';
  replyBox.setAttribute('aria-describedby', fallbackHint.id);
  fallbackDetails.appendChild(replyBox);

  const pasteButton = document.createElement('button');
  pasteButton.type = 'button';
  pasteButton.className = 'project-review-paste-submit';
  pasteButton.textContent = 'Review pasted response';
  fallbackDetails.appendChild(pasteButton);
  element.appendChild(fallbackDetails);

  const planningDetails = document.createElement('details');
  planningDetails.className = 'project-review-planning-notes reveal';
  const planningSummary = document.createElement('summary');
  planningSummary.className = 'reveal-summary';
  planningSummary.textContent = 'Planning notes';
  planningDetails.appendChild(planningSummary);
  const planningNotesHost = document.createElement('div');
  planningNotesHost.className = 'project-review-planning-notes-host';
  planningDetails.appendChild(planningNotesHost);
  element.appendChild(planningDetails);

  replyBox.addEventListener('input', () => {
    if (typeof handlers.onPasteInput === 'function') handlers.onPasteInput(replyBox.value);
  });
  pasteButton.addEventListener('click', () => {
    if (typeof handlers.onPasteReply === 'function') handlers.onPasteReply(replyBox.value);
  });

  function renderCandidates(nextState) {
    suggestionsBody.textContent = '';
    const groups = boundedRows(nextState.groups, MAX_RENDERED_GROUPS);
    let renderedCandidates = 0;

    if (groups.length === 0) {
      appendText(suggestionsBody, 'p', 'project-review-empty', 'No structured suggestions found. Your full description is still saved as narrative.');
      return;
    }

    for (const group of groups) {
      if (!projectReviewUiRecord(group) || renderedCandidates >= MAX_RENDERED_CANDIDATES) break;
      const groupElement = document.createElement('section');
      groupElement.className = 'project-review-group';
      const groupLabel = group.questionLabel || group.destination || group.path || 'Suggested field';
      appendText(groupElement, 'h4', 'project-review-destination-label', groupLabel);
      appendText(groupElement, 'p', 'project-review-destination', `Destination: ${group.destination || group.path || 'unknown field'}`);
      if (group.phase) appendText(groupElement, 'p', 'project-review-phase', `Project phase: ${group.phase}`);
      if (group.conflict) {
        appendText(groupElement, 'p', 'project-review-conflict', 'Two interpretations disagree. Choose one; neither has been applied.');
      }

      for (const candidate of boundedRows(group.candidates, MAX_RENDERED_CANDIDATES - renderedCandidates)) {
        if (!projectReviewUiRecord(candidate)) continue;
        renderedCandidates += 1;
        const row = document.createElement('article');
        row.className = 'project-review-candidate';
        appendText(row, 'p', 'project-review-value', `Suggested value: ${displayValue(candidate.value)}`);
        appendText(row, 'p', 'project-review-sources', `Source: ${projectReviewUiList(candidate.sources).map(sourceLabel).join(', ') || sourceLabel(candidate.sourceKind)}`);

        const warrants = boundedRows(candidate.warrants, MAX_RENDERED_ISSUES);
        if (warrants.length > 0) {
          const warrantList = document.createElement('ul');
          warrantList.className = 'project-review-warrants';
          for (const warrant of warrants) {
            const item = document.createElement('li');
            const quote = projectReviewUiRecord(warrant) && typeof warrant.evidence === 'string' ? warrant.evidence : 'Unavailable evidence';
            const source = projectReviewUiRecord(warrant) ? sourceLabel(warrant.source) : 'Review source';
            item.textContent = `${source} evidence: “${quote}”`;
            warrantList.appendChild(item);
          }
          row.appendChild(warrantList);
        }

        if (candidate.currentState === 'same-as-confirmed') {
          appendText(row, 'p', 'project-review-current same', `Already confirmed: ${displayValue(candidate.currentValue)}`);
        } else if (candidate.currentState === 'different-from-current') {
          appendText(row, 'p', 'project-review-current differs', `Current value: ${displayValue(candidate.currentValue)}`);
        } else {
          appendText(row, 'p', 'project-review-current new', 'No current value is set for this field.');
        }

        if (candidate.currentState !== 'same-as-confirmed') {
          const accept = document.createElement('button');
          accept.type = 'button';
          accept.className = 'project-review-accept';
          accept.textContent = candidate.currentState === 'different-from-current' ? 'Replace current value' : 'Accept suggestion';
          accept.dataset.candidateId = candidate.id;
          accept.setAttribute('aria-label', candidateActionLabel(candidate));
          accept.disabled = candidate.actionable !== true;
          accept.addEventListener('click', () => {
            if (candidate.actionable === true && typeof handlers.onAcceptCandidate === 'function') {
              handlers.onAcceptCandidate(candidate.id);
            }
          });
          row.appendChild(accept);
        }
        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.className = 'project-review-dismiss';
        dismiss.textContent = 'Dismiss suggestion';
        dismiss.dataset.candidateId = candidate.id;
        dismiss.setAttribute('aria-label', candidateDismissLabel(candidate));
        dismiss.disabled = candidate.actionable !== true;
        dismiss.addEventListener('click', () => {
          if (candidate.actionable === true && typeof handlers.onDismissCandidate === 'function') {
            handlers.onDismissCandidate(candidate.id);
          }
        });
        row.appendChild(dismiss);
        groupElement.appendChild(row);
      }
      suggestionsBody.appendChild(groupElement);
    }

    if (projectReviewUiList(nextState.groups).length > groups.length || renderedCandidates < projectReviewUiList(nextState.candidates).length) {
      appendText(suggestionsBody, 'p', 'project-review-truncated', 'Showing a bounded set of suggestions. Review the description again to refresh this list.');
    }
  }

  function renderAsks(nextState) {
    decisionsBody.textContent = '';
    const asks = boundedRows(nextState.asks, MAX_RENDERED_ASKS);
    if (asks.length === 0) {
      appendText(decisionsBody, 'p', 'project-review-empty', 'No additional decisions were identified.');
      return;
    }
    const askList = document.createElement('ul');
    askList.className = 'project-review-asks';
    for (const ask of asks) {
      const item = document.createElement('li');
      const source = projectReviewUiRecord(ask) ? sourceLabel(ask.source) : 'Review source';
      const topic = projectReviewUiRecord(ask) && typeof ask.topic === 'string' ? ask.topic : 'Unspecified decision';
      const why = projectReviewUiRecord(ask) && typeof ask.why === 'string' && ask.why ? ` — ${ask.why}` : '';
      item.textContent = `${source}: ${topic}${why}`;
      askList.appendChild(item);
    }
    decisionsBody.appendChild(askList);
  }

  function renderNotConverted(nextState) {
    notConvertedBody.textContent = '';
    const repairs = boundedRows(nextState.repairs, MAX_RENDERED_REPAIRS);
    const issues = boundedRows(nextState.issues, MAX_RENDERED_ISSUES);
    if (repairs.length === 0 && issues.length === 0) {
      appendText(notConvertedBody, 'p', 'project-review-empty', 'No rejected model output or repairs to show.');
    } else if (repairs.length === 0) {
      appendText(
        notConvertedBody,
        'p',
        'project-review-rejected-output',
        'Some model output could not be mapped to supported fields and was not applied.'
      );
    } else {
      appendText(notConvertedBody, 'h4', 'project-review-subheading', 'Repairs');
      const repairList = document.createElement('ul');
      repairList.className = 'project-review-repairs';
      for (const repair of repairs) {
        const item = document.createElement('li');
        item.textContent = projectReviewUiRecord(repair) && typeof repair.message === 'string' ? repair.message : 'Repair detail unavailable';
        repairList.appendChild(item);
      }
      notConvertedBody.appendChild(repairList);
    }
    technicalErrorsBody.textContent = '';
    technicalErrors.hidden = issues.length === 0;
    technicalErrors.open = issues.length > 0;
    if (issues.length > 0) {
      for (const issue of issues) {
        const item = document.createElement('li');
        const source = projectReviewUiRecord(issue) ? sourceLabel(issue.source) : 'Review source';
        const field = projectReviewUiRecord(issue) && typeof issue.field === 'string' ? issue.field : 'review';
        const message = projectReviewUiRecord(issue) && typeof issue.message === 'string' ? issue.message : 'Rejected output';
        item.textContent = `${source}, ${field}: ${message}`;
        technicalErrorsBody.appendChild(item);
      }
    }
  }

  function update(nextState = {}, options = {}) {
    const safeState = projectReviewUiRecord(nextState) ? nextState : {};
    const safeOptions = projectReviewUiRecord(options) ? options : {};
    if ('onAcceptCandidate' in safeOptions) handlers.onAcceptCandidate = safeOptions.onAcceptCandidate;
    if ('onDismissCandidate' in safeOptions) handlers.onDismissCandidate = safeOptions.onDismissCandidate;
    if ('onPasteReply' in safeOptions) handlers.onPasteReply = safeOptions.onPasteReply;
    if ('onPasteInput' in safeOptions) handlers.onPasteInput = safeOptions.onPasteInput;
    if ('onCancelReview' in safeOptions) handlers.onCancelReview = safeOptions.onCancelReview;
    if ('onCopyPrompt' in safeOptions) handlers.onCopyPrompt = safeOptions.onCopyPrompt;
    if ('fallbackPrompt' in safeOptions) promptBox.value = typeof safeOptions.fallbackPrompt === 'string' ? safeOptions.fallbackPrompt : '';

    status.textContent = statusText(safeState);
    status.dataset.state = typeof safeState.status === 'string' ? safeState.status : 'idle';
    const modelRunning = safeState.status === 'model-running';
    if (modelRunning) element.setAttribute('aria-busy', 'true');
    else element.removeAttribute('aria-busy');
    elapsed.hidden = !modelRunning;
    progressRegion.hidden = !modelRunning;
    if (!modelRunning) progressActivity.textContent = '';
    cancelButton.hidden = !modelRunning;
    cancelButton.disabled = !modelRunning;
    if (safeState.status === 'fallback' || safeState.status === 'error') fallbackDetails.open = true;
    renderCandidates(safeState);
    renderAsks(safeState);
    renderNotConverted(safeState);
  }

  update(state);

  return {
    element,
    update,
    statusHost: status,
    elapsedHost: elapsed,
    progressActivityHost: progressActivity,
    focusHeading: () => heading.focus(),
    planningNotesHost,
    setPlanningNotesVisible: (visible) => {
      planningDetails.hidden = !visible;
      if (!visible) planningDetails.open = false;
    },
    fallback: {
      details: fallbackDetails,
      prompt: promptBox,
      reply: replyBox,
      submit: () => {
        if (typeof handlers.onPasteReply === 'function') return handlers.onPasteReply(replyBox.value);
        return undefined;
      },
      getReply: () => replyBox.value,
      setReply: (value) => {
        replyBox.value = typeof value === 'string' ? value : '';
      },
      focusReply: () => replyBox.focus(),
    },
  };
}
