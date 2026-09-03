// DOM-only Project Review renderer. It consumes the pure projection from
// engine/projectReview.js but intentionally imports nothing: parsing,
// persistence, current-value reads, and accepted writes stay in the caller.
//
// Every candidate here comes from the deterministic exact-text scan. The
// progress bar, elapsed timer, cancel control, model disclosure, and the
// copy-prompt/paste-reply round trip all belonged to an in-app model path that
// no longer exists -- see ui/steps/describe.js's header for why. What is left
// renders synchronously and cannot be mid-flight.

const MAX_RENDERED_GROUPS = 20;
const MAX_RENDERED_CANDIDATES = 30;
const MAX_RENDERED_ASKS = 12;
const MAX_RENDERED_REPAIRS = 12;
const MAX_RENDERED_ISSUES = 12;

const STATUS_TEXT = {
  idle: 'No review yet. Add a description, then choose Review description.',
  scanning: 'Checking exact text matches…',
  complete: 'Exact-text review complete. Micronaut kept everything else as narrative, not structured data.',
  stale: 'Description changed — review again before accepting suggestions.',
};

const SOURCE_LABELS = {
  exact: 'Exact text match',
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
  return STATUS_TEXT[state && state.status] || STATUS_TEXT.idle;
}

/**
 * Create the always-present Review renderer.
 *
 * `state` is a buildProjectReview(...) result. The caller supplies callbacks:
 * - `onAcceptCandidate(id)` receives only the stable candidate identity;
 * - `onDismissCandidate(id)` receives only the stable candidate identity.
 *
 * `update(state, options)` refreshes review content; options may replace
 * either callback.
 */
export function createProjectReview({
  state = {},
  onAcceptCandidate,
  onDismissCandidate,
} = {}) {
  let handlers = { onAcceptCandidate, onDismissCandidate };

  const element = document.createElement('section');
  element.className = 'project-review';
  element.setAttribute('aria-label', 'Review');

  const heading = appendText(element, 'h2', 'project-review-heading', 'Review');
  heading.tabIndex = -1;
  const status = appendText(element, 'p', 'project-review-status', STATUS_TEXT.idle);
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  appendText(
    element,
    'p',
    'project-review-session-disclosure',
    'Suggestions stay in this tab until you change the description or switch measurements. Accept a suggestion to save it.'
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

    status.textContent = statusText(safeState);
    status.dataset.state = typeof safeState.status === 'string' ? safeState.status : 'idle';
    renderCandidates(safeState);
    renderAsks(safeState);
    renderNotConverted(safeState);
  }

  update(state);

  return {
    element,
    update,
    statusHost: status,
    focusHeading: () => heading.focus(),
    planningNotesHost,
    setPlanningNotesVisible: (visible) => {
      planningDetails.hidden = !visible;
      if (!visible) planningDetails.open = false;
    },
  };
}
