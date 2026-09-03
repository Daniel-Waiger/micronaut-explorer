// Pure Project-review authority. This module deliberately does not parse,
// render, fetch, persist, or write: callers supply already-parsed exact-text
// results and the current session binding, then consume this immutable
// projection to render and (separately) perform an explicit accepted write.
//
// There is exactly one candidate source: the deterministic exact-text scan
// (engine/freetext.js). The in-app model path that once supplied `local` and
// `paste` candidates is gone -- nothing a model produces is parsed back into
// the study, so there is no untrusted write path left to arbitrate between.
// That removed four of the eight lifecycle states (`model-running`,
// `fallback`, `cancelled`, `error`) along with every in-flight race they
// existed to describe. `stale` remains and still matters: editing the
// narrative must invalidate un-accepted candidates from the previous text.

const PROJECT_REVIEW_STATUSES = new Set([
  'idle',
  'scanning',
  'complete',
  'stale',
]);

const PROJECT_REVIEW_SOURCE_ORDER = ['exact'];
const PROJECT_REVIEW_MAX_CANDIDATES = 50;
const PROJECT_REVIEW_MAX_QUESTIONS = 100;
const PROJECT_REVIEW_MAX_ASKS = 12;
const PROJECT_REVIEW_MAX_ISSUES = 12;
const PROJECT_REVIEW_MAX_REPAIRS = 12;
const PROJECT_REVIEW_MAX_TEXT = 500;
const PROJECT_REVIEW_MAX_ADVISORY_TEXT = 300;
const PROJECT_REVIEW_MAX_DISMISSED_ID_CHARS = 4000;

function projectReviewRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value, maxChars, { trim = false } = {}) {
  if (typeof value !== 'string') return null;
  const text = trim ? value.trim() : value;
  return text.length > maxChars ? null : text;
}

function scalarValue(value) {
  if (typeof value === 'string') return value.length <= PROJECT_REVIEW_MAX_TEXT ? value : null;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function projectReviewHasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function valueKey(value) {
  return `${typeof value}:${JSON.stringify(value)}`;
}

function stableCandidateId(path, value) {
  return `proposal:${encodeURIComponent(path)}:${encodeURIComponent(valueKey(value))}`;
}

function emptyReview(status = 'idle') {
  return {
    status,
    narrativeRevision: null,
    assayId: null,
    currentNarrativeRevision: null,
    currentAssayId: null,
    actionable: false,
    nonActionableReason: 'not-ready',
    groups: [],
    candidates: [],
    asks: [],
    repairs: [],
    issues: [],
  };
}

function addIssue(issues, field, message, source = 'review', severity = 'error') {
  if (issues.length >= PROJECT_REVIEW_MAX_ISSUES) return;
  const safeField = boundedString(field, PROJECT_REVIEW_MAX_TEXT, { trim: true }) || 'review';
  const safeMessage = boundedString(message, PROJECT_REVIEW_MAX_ADVISORY_TEXT, { trim: true }) || 'invalid review input';
  issues.push({ source, field: safeField, message: safeMessage, severity: severity === 'fatal' ? 'fatal' : 'error' });
}

function normaliseQuestions(rawQuestions, issues) {
  const byPath = new Map();
  const list = Array.isArray(rawQuestions) ? rawQuestions : [];
  if (list.length > PROJECT_REVIEW_MAX_QUESTIONS) {
    addIssue(issues, 'questions', `more than ${PROJECT_REVIEW_MAX_QUESTIONS} questions were ignored`);
  }
  for (const raw of list.slice(0, PROJECT_REVIEW_MAX_QUESTIONS)) {
    if (!projectReviewRecord(raw)) continue;
    const path = boundedString(raw.field, PROJECT_REVIEW_MAX_TEXT, { trim: true });
    if (!path || byPath.has(path)) continue;
    byPath.set(path, {
      id: boundedString(raw.id, PROJECT_REVIEW_MAX_TEXT, { trim: true }) || path,
      path,
      label: boundedString(raw.label, PROJECT_REVIEW_MAX_TEXT, { trim: true }) || boundedString(raw.prompt, PROJECT_REVIEW_MAX_TEXT, { trim: true }) || path,
      prompt: boundedString(raw.prompt, PROJECT_REVIEW_MAX_TEXT, { trim: true }) || '',
      phase: boundedString(raw.phase, PROJECT_REVIEW_MAX_TEXT, { trim: true }) || null,
    });
  }
  return byPath;
}

function sourceResult(input, source) {
  return projectReviewRecord(input[source]) ? input[source] : {};
}

function projectReviewDismissedIds(input, issues) {
  if (!Object.prototype.hasOwnProperty.call(input, 'dismissedCandidateIds')) return new Set();
  const rawIds = input.dismissedCandidateIds;
  if (!Array.isArray(rawIds)) {
    addIssue(issues, 'dismissedCandidateIds', 'dismissed candidate IDs must be an array');
    return new Set();
  }
  if (rawIds.length > PROJECT_REVIEW_MAX_CANDIDATES) {
    addIssue(issues, 'dismissedCandidateIds', `more than ${PROJECT_REVIEW_MAX_CANDIDATES} dismissed candidate IDs were ignored`);
  }
  const ids = new Set();
  for (const rawId of rawIds.slice(0, PROJECT_REVIEW_MAX_CANDIDATES)) {
    const id = boundedString(rawId, PROJECT_REVIEW_MAX_DISMISSED_ID_CHARS);
    if (!id) {
      addIssue(issues, 'dismissedCandidateIds', 'a dismissed candidate ID was malformed or too large');
      continue;
    }
    ids.add(id);
  }
  return ids;
}

function proposalWarrants(rawProposal, source) {
  const evidences = [];
  const addEvidence = (value) => {
    const evidence = boundedString(value, PROJECT_REVIEW_MAX_TEXT);
    if (evidence && !evidences.includes(evidence)) evidences.push(evidence);
  };
  addEvidence(rawProposal.evidence);
  if (Array.isArray(rawProposal.matches)) {
    for (const match of rawProposal.matches.slice(0, PROJECT_REVIEW_MAX_CANDIDATES)) {
      if (projectReviewRecord(match)) addEvidence(match.evidence);
    }
  }
  return evidences.map((evidence) => ({ source, evidence }));
}

function collectCandidates(input, questionByPath, issues) {
  const accepted = new Map();
  let acceptedCount = 0;

  for (const source of PROJECT_REVIEW_SOURCE_ORDER) {
    const result = sourceResult(input, source);
    const rawProposals = Array.isArray(result.proposals) ? result.proposals : [];
    if (rawProposals.length > PROJECT_REVIEW_MAX_CANDIDATES) {
      addIssue(issues, `${source}.proposals`, `more than ${PROJECT_REVIEW_MAX_CANDIDATES} proposals were ignored`, source);
    }

    for (const rawProposal of rawProposals.slice(0, PROJECT_REVIEW_MAX_CANDIDATES)) {
      if (acceptedCount >= PROJECT_REVIEW_MAX_CANDIDATES) {
        addIssue(issues, 'proposals', `more than ${PROJECT_REVIEW_MAX_CANDIDATES} review candidates were ignored`);
        return accepted;
      }
      if (!projectReviewRecord(rawProposal)) {
        addIssue(issues, `${source}.proposals`, 'proposal is not an object', source);
        continue;
      }
      const path = boundedString(rawProposal.path, PROJECT_REVIEW_MAX_TEXT, { trim: true });
      const question = path ? questionByPath.get(path) : null;
      const value = scalarValue(rawProposal.value);
      const warrants = proposalWarrants(rawProposal, source);
      if (!question) {
        addIssue(issues, path || `${source}.proposals`, 'proposal does not target a supplied question', source);
        continue;
      }
      if (value === null || !projectReviewHasValue(value)) {
        addIssue(issues, path, 'proposal has no supported scalar value', source);
        continue;
      }
      if (warrants.length === 0) {
        addIssue(issues, path, 'proposal has no bounded evidence quote', source);
        continue;
      }

      const key = `${path}\u0000${valueKey(value)}`;
      let candidate = accepted.get(key);
      if (!candidate) {
      candidate = {
        id: stableCandidateId(path, value),
        path,
        destination: path,
        question,
        questionId: question.id,
        questionLabel: question.label,
        questionPrompt: question.prompt,
        phase: question.phase,
          value,
          warrants: [],
          sources: [],
        };
        accepted.set(key, candidate);
        acceptedCount += 1;
      }
      for (const warrant of warrants) {
        if (!candidate.warrants.some((item) => item.source === warrant.source && item.evidence === warrant.evidence)) {
          candidate.warrants.push(warrant);
        }
        if (!candidate.sources.includes(warrant.source)) candidate.sources.push(warrant.source);
      }
    }
  }
  return accepted;
}

function currentValueFor(currentValues, path, issues) {
  if (!projectReviewRecord(currentValues) || !Object.prototype.hasOwnProperty.call(currentValues, path)) {
    return { present: false, value: null };
  }
  const raw = currentValues[path];
  if (!projectReviewHasValue(raw)) return { present: false, value: null };
  const value = scalarValue(raw);
  if (value === null) {
    addIssue(issues, path, 'current value was malformed or too large for review');
    return { present: false, value: null };
  }
  return { present: true, value };
}

function reviewStatus(input, bindingMismatch) {
  const requested = PROJECT_REVIEW_STATUSES.has(input.status) ? input.status : 'idle';
  return bindingMismatch ? 'stale' : requested;
}

function bindingValue(value) {
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

function collectAdvisories(input, kind, limit, issues) {
  const output = [];
  for (const source of PROJECT_REVIEW_SOURCE_ORDER) {
    const items = sourceResult(input, source)[kind];
    if (!Array.isArray(items)) continue;
    if (items.length > limit) addIssue(issues, `${source}.${kind}`, `more than ${limit} ${kind} were ignored`, source);
    for (const raw of items.slice(0, limit)) {
      if (output.length >= limit) return output;
      if (kind === 'asks') {
        if (!projectReviewRecord(raw)) {
          addIssue(issues, `${source}.asks`, 'ask is not an object', source);
          continue;
        }
        const topic = boundedString(raw.topic, PROJECT_REVIEW_MAX_ADVISORY_TEXT, { trim: true });
        const why = raw.why === undefined ? '' : boundedString(raw.why, PROJECT_REVIEW_MAX_ADVISORY_TEXT, { trim: true });
        if (!topic || why === null) {
          addIssue(issues, `${source}.asks`, 'ask is malformed or too large', source);
          continue;
        }
        output.push({ id: `ask:${source}:${output.length}`, source, topic, why });
      } else if (kind === 'repairs') {
        const message = boundedString(typeof raw === 'string' ? raw : raw && raw.message, PROJECT_REVIEW_MAX_ADVISORY_TEXT, { trim: true });
        if (!message) {
          addIssue(issues, `${source}.repairs`, 'repair is malformed or too large', source);
          continue;
        }
        output.push({ id: `repair:${source}:${output.length}`, source, message });
      } else if (projectReviewRecord(raw)) {
        addIssue(issues, raw.field || `${source}.issues`, raw.message || 'model output was rejected', source, raw.severity);
      }
    }
  }
  return output;
}

/**
 * Build the one UI-neutral Project review projection.
 *
 * Input contract:
 * - `exact` is a parser-result object containing any of
 *   `{ proposals, asks, repairs, issues }`. It is the only candidate source.
 * - `questions` is the question-bank list; `currentValues` maps question paths
 *   to the active assay's current structured values.
 * - `narrativeRevision`/`assayId` bind the result; the corresponding `current*`
 *   values are checked at action time and force stale, non-actionable output.
 *
 * TOTAL and pure: malformed inputs become bounded review issues, and no input
 * object is mutated.
 */
export function buildProjectReview(input = {}) {
  try {
    const safeInput = projectReviewRecord(input) ? input : {};
    const issues = [];
    const questionByPath = normaliseQuestions(safeInput.questions, issues);
    const narrativeRevision = bindingValue(safeInput.narrativeRevision);
    const assayId = bindingValue(safeInput.assayId);
    const currentNarrativeRevision = bindingValue(safeInput.currentNarrativeRevision);
    const currentAssayId = bindingValue(safeInput.currentAssayId);
    const hasBinding =
      narrativeRevision !== null || assayId !== null || currentNarrativeRevision !== null || currentAssayId !== null;
    const bindingMatches =
      narrativeRevision !== null &&
      assayId !== null &&
      narrativeRevision === currentNarrativeRevision &&
      assayId === currentAssayId;
    const bindingMismatch = hasBinding && !bindingMatches;
    const status = reviewStatus(safeInput, bindingMismatch);
    const actionable = bindingMatches && status !== 'stale' && status !== 'idle' && status !== 'scanning';
    const candidatesByKey = collectCandidates(safeInput, questionByPath, issues);
    const dismissedIds = projectReviewDismissedIds(safeInput, issues);
    for (const [key, candidate] of candidatesByKey) {
      if (dismissedIds.has(candidate.id)) candidatesByKey.delete(key);
    }
    const grouped = new Map();

    for (const candidate of candidatesByKey.values()) {
      const current = currentValueFor(safeInput.currentValues, candidate.path, issues);
      candidate.warrants.sort((a, b) => a.source.localeCompare(b.source) || a.evidence.localeCompare(b.evidence));
      candidate.sources.sort((a, b) => PROJECT_REVIEW_SOURCE_ORDER.indexOf(a) - PROJECT_REVIEW_SOURCE_ORDER.indexOf(b));
      candidate.sourceKind = candidate.sources.length === 1 ? candidate.sources[0] : 'multiple';
      candidate.evidence = candidate.warrants.map((warrant) => warrant.evidence);
      candidate.currentValue = current.value;
      candidate.currentState = !current.present
        ? 'new'
        : valueKey(current.value) === valueKey(candidate.value)
          ? 'same-as-confirmed'
          : 'different-from-current';
      candidate.narrativeRevision = narrativeRevision;
      candidate.assayId = assayId;
      candidate.actionable = actionable;
      delete candidate.question;

      let group = grouped.get(candidate.path);
      if (!group) {
        const question = questionByPath.get(candidate.path);
        group = {
          id: `destination:${encodeURIComponent(candidate.path)}`,
          path: candidate.path,
          destination: candidate.path,
          questionId: question.id,
          questionLabel: question.label,
          phase: question.phase,
          currentValue: current.value,
          currentState: candidate.currentState,
          conflict: false,
          candidates: [],
        };
        grouped.set(candidate.path, group);
      }
      group.candidates.push(candidate);
    }

    const groups = [...grouped.values()].sort((a, b) => a.path.localeCompare(b.path));
    for (const group of groups) {
      group.candidates.sort((a, b) => a.id.localeCompare(b.id));
      group.conflict = group.candidates.length > 1;
    }
    const candidates = groups.flatMap((group) => group.candidates);
    const asks = collectAdvisories(safeInput, 'asks', PROJECT_REVIEW_MAX_ASKS, issues);
    const repairs = collectAdvisories(safeInput, 'repairs', PROJECT_REVIEW_MAX_REPAIRS, issues);
    collectAdvisories(safeInput, 'issues', PROJECT_REVIEW_MAX_ISSUES, issues);

    return {
      status,
      narrativeRevision,
      assayId,
      currentNarrativeRevision,
      currentAssayId,
      actionable,
      nonActionableReason: bindingMismatch ? 'stale' : actionable ? null : 'not-ready',
      groups,
      candidates,
      asks,
      repairs,
      issues,
    };
  } catch {
    const review = emptyReview('error');
    review.issues.push({ source: 'review', field: 'review', message: 'review input could not be processed', severity: 'error' });
    return review;
  }
}
