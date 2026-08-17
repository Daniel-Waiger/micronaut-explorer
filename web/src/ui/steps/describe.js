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
import { parseLlmProposals, parseLlmAsks } from '../../engine/llmproposals.js';
import { buildDraftExperiment } from '../../core/draft.js';
import { createOllamaProvider } from '../../llm/ollama.js';
import { loadLlmConfig, saveLlmConfig } from '../../llm/config.js';
import { stashDraft } from '../../core/persist.js';
import { startElapsedLabel } from '../llmStatus.js';
import { PROPOSAL_SYSTEM_PROMPT, renderQuestionLines, renderProposalRequestPrompt } from '../../engine/render/llmdraftprompt.js';
import { extractJsonReply } from '../../engine/llmreply.js';
import { CHAT_TARGETS, buildChatUrl } from '../../llm/chatTargets.js';
import { copyToClipboard } from '../clipboard.js';
import { buildQuestionControl, coerceAnswer } from '../questionControl.js';

const INTERVIEW_LIMIT = 8;

/**
 * Render a value for display in a proposal row -- markers proposals carry
 * a joined canonical string, everything else is a plain scalar.
 */
function displayValue(value) {
  return value === undefined || value === null ? '' : String(value);
}

// buildQuestionControl/coerceAnswer moved to ../questionControl.js
// (zen-planner Phase 1): naming.js needed them too, and importing them FROM
// this file would have closed an import cycle since this file already
// imports naming.js's NAMING_CONFIG/BASE_TEMPLATE -- see that module's own
// header for the full reasoning.

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

// The system prompt for study-drafting (Wave B), against Ollama specifically.
// PROPOSAL_SYSTEM_PROMPT (engine/render/llmdraftprompt.js) carries the rules
// shared with the chat-LLM copy-out path; this appends the one instruction
// that ONLY applies here, because only Ollama gets a `format` schema
// (engine/llmschema.js) to match against. Separate from engine/render/
// llmprompt.js's GUIDANCE_PREAMBLE because the roles differ: guidance
// NARRATES and must never answer for the user, this one answers exactly the
// supplied questions and nothing else. Every returned value is re-checked
// against the options anyway (engine/llmproposals.js) even though the schema
// should already have made an out-of-vocabulary answer impossible.
const OLLAMA_PROPOSAL_SYSTEM_PROMPT = `${PROPOSAL_SYSTEM_PROMPT}\n- Return JSON matching the supplied schema and nothing else.`;

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
    // Retitled 'Project' (zen-planner Phase 1's reframe): this is the
    // preliminary, project-level questioning -- the biological question,
    // organism, hypothesis -- asked BEFORE any microscope is chosen. The id
    // stays 'describe' (it addresses this step in the URL hash and every
    // existing render() call site) -- only the user-facing label changed.
    title: 'Project',
    render(main, store, { showToast, advisor } = {}) {
      main.textContent = '';

      // Commit 1 of the assay tier (schema v3): every experiment has
      // exactly one assay and no switcher exists yet, so the active assay
      // never changes for the lifetime of one render -- caching its id once
      // here is safe, matching design.js/naming.js's identical idiom.
      const assayId = store.get().activeAssayId;

      const heading = document.createElement('h1');
      heading.className = 'step-heading';
      heading.textContent = 'Describe your project';
      main.appendChild(heading);

      const subheading = document.createElement('p');
      subheading.className = 'proposals-empty';
      subheading.textContent =
        'Start with the experiment itself -- the question, the organism, why you’re running it -- before any microscope decision. Study & Groups and Microscopy come next.';
      main.appendChild(subheading);

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

      // Progressive disclosure (zen-planner Phase 1's declutter pass): every
      // LLM-related control -- the two Ollama-specific buttons below, plus
      // the chat-LLM round-trip section further down -- collapses behind
      // ONE reveal instead of exploding across the page by default. Closed
      // by default: nothing about the deterministic "Read it" scan above
      // needs it, and a first-time visitor with no local model configured
      // has no reason to see three LLM options before they've typed a
      // sentence. `open` is never forced true by anything below -- once the
      // user opens it, JS never closes it back (no code here sets
      // aiHelpDetails.open), so their choice survives every re-render this
      // function itself does NOT trigger a fresh mount for.
      const aiHelpDetails = document.createElement('details');
      aiHelpDetails.className = 'reveal';
      const aiHelpSummary = document.createElement('summary');
      aiHelpSummary.className = 'reveal-summary';
      aiHelpSummary.textContent = 'Get AI help (optional)';
      aiHelpDetails.appendChild(aiHelpSummary);
      main.appendChild(aiHelpDetails);

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
      aiHelpDetails.appendChild(draftButton);

      // Wave C: the same model, aimed at THIS study instead of a new one.
      // The two are different moments, not redundant buttons -- drafting is
      // for starting from nothing, this is for finishing something already
      // underway, and only this one can collide with existing answers.
      const suggestButton = document.createElement('button');
      suggestButton.type = 'button';
      suggestButton.className = 'draft-button';
      suggestButton.textContent = 'Suggest answers for what is left';
      suggestButton.title =
        "Asks your local model to answer only the questions you haven't decided yet, as proposals you review one by one.";
      aiHelpDetails.appendChild(suggestButton);

      // Both buttons above are Ollama-specific (they need schema-constrained
      // decoding -- see draftButton's title). Their visibility used to be
      // set ONCE here from loadLlmConfig().enabled at render() time, so
      // ticking the checkbox in the guidance panel below did not reveal them
      // until the step re-rendered -- a real, user-reported bug. This is
      // called at initial render AND from guidancePanel's onConfigChange
      // below, so it stays correct without a full re-render (which would
      // lose the narrative textarea's caret mid-typing).
      function syncLlmButtons() {
        const enabled = loadLlmConfig().enabled;
        draftButton.hidden = !enabled;
        suggestButton.hidden = !enabled;
        // The empty-proposals message also branches on this flag (see
        // renderProposals below), so it can go stale the same way.
        renderProposals();
      }

      // Phase 1 (chat-LLM round trip): the zero-setup alternative to the two
      // Ollama-specific buttons above. ALWAYS visible -- unlike Draft/
      // Suggest, this needs no local server, so hiding it behind the same
      // `loadLlmConfig().enabled` flag would defeat the entire point of
      // having it. Placed here (after the Ollama buttons, before the advice
      // panel) so reading order matches data flow: describe -> get an
      // answer, by whichever means -> see proposals below.
      const chatSection = document.createElement('div');
      chatSection.className = 'chatllm-section';

      const chatHeading = document.createElement('div');
      chatHeading.className = 'chatllm-heading';
      chatHeading.textContent = 'Use any chat LLM';
      chatSection.appendChild(chatHeading);

      const chatHint = document.createElement('p');
      chatHint.className = 'chatllm-hint';
      chatHint.textContent =
        'No local model? Copy this prompt into ChatGPT, Claude, or whatever you already have open, then paste its reply back below.';
      chatSection.appendChild(chatHint);

      // Scope selects which QUESTIONS go into the prompt (not what a pasted
      // reply is validated against -- that is always the full bank, below,
      // matching Suggest's own rationale: the model is never invited to
      // second-guess a value the user already chose).
      const chatScope = document.createElement('select');
      chatScope.className = 'chatllm-scope';
      const scopeOpen = document.createElement('option');
      scopeOpen.value = 'open';
      scopeOpen.textContent = "Only what's left";
      const scopeAll = document.createElement('option');
      scopeAll.value = 'all';
      scopeAll.textContent = 'Every question';
      chatScope.appendChild(scopeOpen);
      chatScope.appendChild(scopeAll);
      chatSection.appendChild(chatScope);

      function scopedQuestions() {
        return chatScope.value === 'all' ? questionBank : currentAskable;
      }

      const copyPromptButton = document.createElement('button');
      copyPromptButton.type = 'button';
      copyPromptButton.className = 'chatllm-copy';
      copyPromptButton.textContent = 'Copy prompt';
      chatSection.appendChild(copyPromptButton);

      // readOnly, same idiom as guidance.js's pasteBox: shows exactly what
      // was copied, so a failed clipboard write (file://, permissions
      // policy) is never a dead end -- the text is still selectable here.
      const chatPromptBox = document.createElement('textarea');
      chatPromptBox.className = 'chatllm-prompt-box';
      chatPromptBox.readOnly = true;
      chatPromptBox.hidden = true;
      chatSection.appendChild(chatPromptBox);

      copyPromptButton.addEventListener('click', async () => {
        const text = textarea.value.trim();
        if (!text) {
          if (showToast) showToast('Describe the experiment above first.');
          return;
        }
        const prompt = renderProposalRequestPrompt(scopedQuestions(), text);
        chatPromptBox.value = prompt;
        chatPromptBox.hidden = false;
        const ok = await copyToClipboard(prompt);
        if (showToast) showToast(ok ? 'Prompt copied.' : "Couldn't copy automatically -- select the text below and copy it.");
      });

      // Link-outs put the study's narrative into a third-party URL -- a real
      // change from this app's "nothing leaves your network unless you opt
      // in" posture (see llm/ollama.js's header), so they get their own
      // explicit, persisted opt-in rather than riding along with the
      // Ollama-enabled flag, which means something narrower. Copying the
      // prompt above needs no opt-in: it sends nothing anywhere.
      const linkOutLabel = document.createElement('label');
      linkOutLabel.className = 'chatllm-linkout-label';
      const linkOutCheckbox = document.createElement('input');
      linkOutCheckbox.type = 'checkbox';
      linkOutCheckbox.checked = loadLlmConfig().linkOuts;
      linkOutLabel.appendChild(linkOutCheckbox);
      linkOutLabel.appendChild(
        document.createTextNode(' Let me open a chat website with this prompt in the link')
      );
      chatSection.appendChild(linkOutLabel);

      const linkOutWarning = document.createElement('p');
      linkOutWarning.className = 'chatllm-linkout-warning';
      linkOutWarning.textContent =
        'This opens a third-party website with your description in the address bar. Nothing is sent until you click one of the buttons below.';
      chatSection.appendChild(linkOutWarning);

      const linkOutRow = document.createElement('div');
      linkOutRow.className = 'chatllm-linkout-row';
      chatSection.appendChild(linkOutRow);

      function syncLinkOutVisibility() {
        const on = linkOutCheckbox.checked;
        linkOutWarning.hidden = !on;
        linkOutRow.hidden = !on;
      }
      linkOutCheckbox.addEventListener('change', () => {
        saveLlmConfig({ linkOuts: linkOutCheckbox.checked });
        syncLinkOutVisibility();
      });
      syncLinkOutVisibility();

      for (const target of CHAT_TARGETS) {
        const targetButton = document.createElement('button');
        targetButton.type = 'button';
        targetButton.className = 'chatllm-target';
        targetButton.textContent = target.label;
        targetButton.addEventListener('click', async () => {
          const text = textarea.value.trim();
          if (!text) {
            if (showToast) showToast('Describe the experiment above first.');
            return;
          }
          const prompt = renderProposalRequestPrompt(scopedQuestions(), text);
          chatPromptBox.value = prompt;
          chatPromptBox.hidden = false;
          // window.open() FIRST, synchronously in this handler, before any
          // await: a popup opened after an async gap can lose the browser's
          // "this came from a real click" transient activation and get
          // silently blocked -- exactly what happened to the Draft button
          // earlier this session (a 13s+ Ollama call in between). A
          // clipboard write is normally much faster than that window, but
          // there's no reason to rely on winning a race when opening first
          // costs nothing.
          const { url, prefilled } = buildChatUrl(target, prompt);
          window.open(url, '_blank', 'noopener');
          const copied = await copyToClipboard(prompt);
          if (showToast) {
            showToast(
              prefilled
                ? `Opened ${target.label} with the prompt pre-filled.`
                : copied
                  ? `Opened ${target.label} -- the prompt is on your clipboard, paste it in.`
                  : `Opened ${target.label} -- copy the prompt below and paste it in.`
            );
          }
        });
        linkOutRow.appendChild(targetButton);
      }

      const chatReplyLabel = document.createElement('div');
      chatReplyLabel.className = 'chatllm-reply-label';
      chatReplyLabel.textContent = "Paste the model's reply here:";
      chatSection.appendChild(chatReplyLabel);

      const chatReplyBox = document.createElement('textarea');
      chatReplyBox.className = 'chatllm-reply-box';
      chatReplyBox.placeholder = 'Paste the model’s reply here -- code fences and extra prose are fine.';
      chatSection.appendChild(chatReplyBox);

      const readReplyButton = document.createElement('button');
      readReplyButton.type = 'button';
      readReplyButton.className = 'chatllm-read-reply';
      readReplyButton.textContent = 'Read the reply';
      chatSection.appendChild(readReplyButton);

      // Separate from chatIssues on purpose: a repair (e.g. "removed a
      // trailing comma") is engine/llmreply.js SUCCEEDING at something odd,
      // not a problem -- rendering it under .issue-error would make a
      // successful paste look like it failed.
      const chatRepairs = document.createElement('div');
      chatRepairs.className = 'chatllm-repairs';
      chatRepairs.hidden = true;
      chatSection.appendChild(chatRepairs);

      const chatIssues = document.createElement('div');
      chatIssues.className = 'chatllm-issues';
      chatIssues.hidden = true;
      chatSection.appendChild(chatIssues);

      const chatAsks = document.createElement('div');
      chatAsks.className = 'chatllm-asks';
      chatAsks.hidden = true;
      chatSection.appendChild(chatAsks);

      // Caps rendered rows so a hostile or malfunctioning reply can pad
      // `issues`/`asks` without padding the DOM in lockstep -- the parsers
      // (llmreply.js, llmproposals.js) already cap what they return, this
      // is a second, independent cap at the render boundary.
      const MAX_RENDERED_ROWS = 12;

      function renderMessageList(container, items, formatItem, rowClassName) {
        container.textContent = '';
        const shown = items.slice(0, MAX_RENDERED_ROWS);
        for (const item of shown) {
          const row = document.createElement('p');
          if (rowClassName) row.className = rowClassName;
          row.textContent = formatItem(item);
          container.appendChild(row);
        }
        if (items.length > shown.length) {
          const more = document.createElement('p');
          more.textContent = `+${items.length - shown.length} more`;
          container.appendChild(more);
        }
        container.hidden = items.length === 0;
      }

      readReplyButton.addEventListener('click', () => {
        const pasted = chatReplyBox.value;
        const { json, issues: extractIssues, repairs } = extractJsonReply(pasted, { requireKey: 'proposals' });

        if (!json) {
          // .issue/.issue-error: this IS the app's existing validation-output
          // vocabulary (styles/app.css), not a new one -- a paste that failed
          // to parse is exactly what those classes already mean.
          renderMessageList(chatIssues, extractIssues, (issue) => issue.message, 'issue issue-error');
          if (showToast) showToast("Couldn't find a JSON object in that paste.");
          return;
        }

        // Validated against the FULL question bank, never scopedQuestions():
        // if the user copied with "Only what's left" and then answered a
        // question before pasting back, that path must still be recognized
        // -- the safety property is bank membership plus the vocabulary
        // check (engine/llmproposals.js), not the ask-list used to build
        // the prompt.
        const { proposals, issues: proposalIssues } = parseLlmProposals(json, questionBank);
        const { asks, issues: askIssues } = parseLlmAsks(json);

        const allIssues = [...extractIssues, ...proposalIssues, ...askIssues];
        renderMessageList(chatRepairs, repairs, (r) => `Repaired the paste: ${r}.`);
        renderMessageList(chatIssues, allIssues, (issue) => issue.message, 'issue issue-error');
        renderMessageList(chatAsks, asks, (ask) => (ask.why ? `${ask.topic} -- ${ask.why}` : ask.topic));

        if (proposals.length === 0) {
          if (showToast) showToast('No usable proposals in that reply.' + (asks.length > 0 ? ' See what it flagged below.' : ''));
          return;
        }
        mergeProposals(proposals, { sourceLabel: 'an earlier suggestion' });
      });

      aiHelpDetails.appendChild(chatSection);

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
      const guidancePanel = createGuidancePanel(
        () => ({
          doc: buildStudyDocument(store.get(), kb, NAMING_CONFIG, BASE_TEMPLATE),
          questions: currentAskable,
        }),
        { onConfigChange: () => syncLlmButtons() }
      );
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

      // Collapsed by default, same reveal idiom as aiHelpDetails above: a
      // review list of everything already answered is valuable once there
      // is something to review, but is pure clutter above the fold on a
      // step that has not been touched yet -- see the declutter comment on
      // aiHelpDetails for the full rationale.
      const answeredDetails = document.createElement('details');
      answeredDetails.className = 'reveal';
      const answeredSummary = document.createElement('summary');
      answeredSummary.className = 'reveal-summary';
      answeredSummary.textContent = 'Your answers';
      answeredDetails.appendChild(answeredSummary);
      main.appendChild(answeredDetails);

      const answeredList = document.createElement('div');
      answeredList.className = 'interview-list answered-list';
      answeredDetails.appendChild(answeredList);

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
            ? loadLlmConfig().enabled
              ? 'Click "Read it" to scan the paragraph above, or "Suggest answers for what is left".'
              : 'Click "Read it" to scan the paragraph above.'
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

          // WHICH TIER PROPOSED THIS. The two are not equally trustworthy and
          // must not look alike: the deterministic scan matched literal text
          // the user wrote, while the model INFERRED a value from the same
          // prose. Derived from the provenance tag rather than a separate
          // display field, so the badge can never disagree with what an
          // Accept would actually write.
          const source = document.createElement('span');
          source.className = isProvisional(proposal.tag) ? 'proposal-source proposal-source-llm' : 'proposal-source';
          source.textContent = isProvisional(proposal.tag) ? 'model' : 'text scan';
          text.appendChild(source);

          // Accept is now a STRONG write, so it CAN replace an existing
          // value. That makes showing what is about to be lost a
          // requirement, not a nicety -- a silent replacement is exactly the
          // failure the provenance gate used to prevent for us.
          const { path: currentPath } = scopeWrite(store.get(), proposal.path, assayId);
          const currentValue = store.getPath(currentPath);
          if (currentValue !== undefined && currentValue !== null && currentValue !== '') {
            const replaces = document.createElement('div');
            replaces.className = 'proposal-replaces';
            replaces.textContent = `Replaces the current value: ${displayValue(currentValue)}`;
            row.appendChild(replaces);
          }

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
            // Accept is the USER endorsing this value, so it is written with a
            // STRONG tag -- NOT the proposal's own WEAK 'freetext' /
            // PROVISIONAL 'llm_freetext'. Writing the source tag (what this
            // did before) left an accepted value still flagged needsReview,
            // which reads as "unreviewed" about the one value the user
            // explicitly just reviewed, and left it clobberable by the next
            // re-parse. editTagFor is the same rule the interview's own
            // Answer/Update buttons use: 'user_edited' when endorsing a
            // machine-sourced guess (its docstring names an LLM suggestion
            // outright), plain 'user' for a slot that held nothing.
            const existingTag = store.get().provenance?.slots?.[slotKey]?.tag ?? null;
            const tag = editTagFor(existingTag);
            const applied = store.setPath(path, proposal.value, tag, { slotKey });
            writeReadoutCanonicalIfNeeded(store, { id: proposal.questionId }, proposal.value, tag, assayId, kb);
            pendingProposals = pendingProposals.filter((p) => p !== proposal);
            renderProposals();
            renderInterview();
            renderAnswered();
            // setPath's return value is the ONLY signal that a write was
            // refused -- a refused Accept must not look identical to a
            // successful one. With a STRONG tag this should no longer be
            // reachable, so it is kept as a genuine invariant check rather
            // than an expected path.
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

      /**
       * Merge freshly proposed values into `pendingProposals`, re-render, and
       * toast a summary. Shared by the Ollama-suggest handler and the
       * chat-LLM paste-back handler -- both feed the same review list, so
       * both must merge (never replace) the same way: a deterministic scan
       * or an earlier proposal may already be sitting on a path, and
       * silently discarding it because a second source answered it too
       * would lose work the user has not judged yet. A later proposal never
       * displaces an earlier one for the same path.
       *
       * `sourceLabel` names what "already proposed" means in the toast --
       * the two callers lose to different things (the text scan vs. an
       * earlier suggestion).
       */
      function mergeProposals(proposals, { sourceLabel }) {
        const takenPaths = new Set(pendingProposals.map((p) => p.path));
        const added = proposals.filter((p) => !takenPaths.has(p.path));
        pendingProposals = pendingProposals.concat(added);
        renderProposals();
        updateAdvice();
        if (showToast) {
          const skipped = proposals.length - added.length;
          showToast(
            `${added.length} suggestion(s) to review.` +
              (skipped > 0 ? ` ${skipped} skipped -- already proposed by ${sourceLabel}.` : '')
          );
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
        const askable = nextQuestions(questionBank, assayView(store.get(), assayId), INTERVIEW_LIMIT, {
          phase: 'project',
        });
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
        const reviewable = answeredQuestions(questionBank, assayView(store.get(), assayId), {
          phase: 'project',
        });
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
        const stopTicking = startElapsedLabel(draftButton, 'Drafting');
        try {
          const schema = buildProposalSchema(questionBank);
          const result = await provider.complete({
            system: OLLAMA_PROPOSAL_SYSTEM_PROMPT,
            user: `--- QUESTIONS ---\n${renderQuestionLines(questionBank)}\n\n--- DESCRIPTION ---\n${text}`,
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
          stopTicking();
          draftButton.disabled = false;
          draftButton.textContent = 'Draft a study from this (new tab)';
        }
      });

      // Wave C: model proposals into the CURRENT study, reviewed one slot at
      // a time through the same list the deterministic scan already feeds.
      //
      // Deliberately scoped to `currentAskable` (nextQuestions' output: slots
      // NOT already carrying a STRONG tag) rather than the whole question
      // bank. Three reasons, in order of importance: the model is never
      // invited to second-guess a value the user actually chose; the schema
      // and prompt stay small, which matters because every call re-sends this
      // context; and a proposal therefore almost never has anything to
      // replace, keeping Accept boring.
      suggestButton.addEventListener('click', async () => {
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
        if (currentAskable.length === 0) {
          if (showToast) showToast('Nothing left to suggest -- every question is answered or skipped.');
          return;
        }

        suggestButton.disabled = true;
        const stopTicking = startElapsedLabel(suggestButton, 'Asking');
        try {
          const schema = buildProposalSchema(currentAskable);
          const result = await provider.complete({
            system: OLLAMA_PROPOSAL_SYSTEM_PROMPT,
            user: `--- QUESTIONS STILL OPEN ---\n${renderQuestionLines(currentAskable)}\n\n--- DESCRIPTION ---\n${text}`,
            schema,
          });

          const { proposals, issues } = parseLlmProposals(result.json, currentAskable);
          if (issues.length > 0) {
            // A dropped proposal is this tier working as designed, not a
            // failure -- logged, so the surviving ones still render.
            console.warn('Dropped LLM proposals:', issues);
          }
          if (proposals.length === 0) {
            if (showToast) showToast('The model did not suggest anything usable for the open questions.');
            return;
          }

          mergeProposals(proposals, { sourceLabel: 'the text scan' });
        } catch (err) {
          if (showToast) showToast(`Couldn't reach the local model (${err.message}). Nothing was changed.`);
        } finally {
          stopTicking();
          suggestButton.disabled = false;
          suggestButton.textContent = 'Suggest answers for what is left';
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

      syncLlmButtons(); // also calls renderProposals()
      renderInterview();
      renderAnswered();
    },
  };
}
