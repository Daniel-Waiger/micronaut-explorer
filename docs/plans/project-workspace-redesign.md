# Project workspace redesign

## Outcome

Replace the current Describe/Project page's collection of parallel journeys with
one coherent workspace:

1. one study-level narrative that is visibly saved as written;
2. one primary action, **Review description**;
3. one always-present **Review** area where exact matches, optional model
   interpretations, conflicts, omissions, errors, and manual copy/paste all land;
4. one **Project details for {active assay}** field grid for the structured facts
   the user has actually confirmed.

The page must never imply that arbitrary project prose has been fully parsed.
Deterministic recognition remains deliberately narrow. Model output is a
reviewable interpretation backed by a quoted span, not a fact, and nothing from
either tier becomes structured study data until the user explicitly accepts it.

## Ground truth from the current source

- `web/src/ui/steps/describe.js` is 997 lines and owns four competing model
  journeys inside one disclosure: read-only **Ask about this step**, **Draft a
  study from this (new tab)**, **Suggest answers for what is left**, and a
  copy/link-out/paste round trip under **Use any chat LLM**. Each has its own
  controls, results, and failure language.
- **Ask** accepts an empty question. In that case `guidance.js` sends the current
  question bank and a serialized copy of the study, so the user sees their own
  prose repeated without having asked anything. Its reply is intentionally
  read-only and cannot advance the Project form.
- **Draft** performs the potentially long Ollama request before calling
  `window.open()`. That loses the browser's transient click activation and makes
  popup blocking a live, source-proven hazard. The code first writes a one-shot
  `draftHandoff` localStorage value, then reports the blocked tab through a
  short-lived toast. This is a credible mechanism for “the button did nothing,”
  and the separate-study/new-tab mental model competes with the current study
  even when the popup succeeds.
- `buildProposalSchema()` permits only `proposals`, while the shared proposal
  prompt explicitly requests an `asks` list. Ollama constrained decoding
  therefore forbids one part of the contract the prompt tells it to return;
  pasted chat replies can carry it, so local and manual review are observably
  asymmetric.
- `parseLlmProposals()` currently labels the question prompt as model
  “evidence.” That is not evidence from the user's narrative. The UI then
  renders it after “from,” making an inference look better grounded than it is.
- `parseFreeText()` honestly recognizes only marker aliases, replicate counts,
  magnification, and ISO dates. It cannot determine which arbitrary sentences
  are unsupported, and the redesign must not invent a coverage map it cannot
  compute.
- Proposal state is a local variable inside a single `render()` call. Route or
  assay re-renders discard unaccepted results, while toasts disappear. The page
  has no durable-in-the-current-tab review record.
- The Project screen separately renders **Proposals**, **Questions**, and a
  collapsed **Your answers** list. The shared `renderFieldInterview()` already
  provides a calmer, single-grid model with explicit confirmation state and can
  replace the latter two surfaces.
- `narrative.text` is study-level and shared by all assays. Proposal destinations
  are mostly assay-scoped through `scopeWrite()`. Every result and accept action
  therefore has to name and retain the active assay identity; a request started
  for one assay must never land in another.
- The full JavaScript baseline is green before implementation: `777` tests
  passed with `node --test web/tests/*.test.js` on 2026-08-23.

## Protected input

The worktree already contains two user-approved copy edits. They are input to
this plan, not cleanup and not changes to revert:

- `web/src/ui/steps/home.js` must retain exactly:
  `Plan your microscopy study step by step. Describe the research question, groups, samples, imaging setup, and naming rules; Micronaut turns those choices into a checked study plan and ready-to-use file names.`
- `web/src/ui/steps/describe.js` must retain exactly:
  `Start with the experiment itself -- the question, the organism, why you’re running it -- before any microscope decision. Project design, then Microscopy.`

Executors must inspect `git diff` before editing either file. This redesign does
not otherwise touch `home.js`.

## Product decisions

### What is removed, merged, and renamed

| Current surface | Decision | Replacement |
| --- | --- | --- |
| **Read it** | Rename and expand | One primary **Review description** action. It always runs the exact-text scan; when an opted-in local model is configured it also starts the broader review in the same result area. |
| **Draft a study from this (new tab)** | Remove | No draft tab, popup, storage handoff, or second study. The current study remains the only workspace. |
| **Suggest answers for what is left** | Merge | The local-model phase of **Review description**. It proposes only from the supplied narrative and only against questions that were open at request time. |
| **Ask about this step** | Remove from Project | No generic question box and no model call without a real user question. The Project page is for capturing and reviewing the project, not a parallel read-only chat. Overview's final-plan LLM export remains out of scope. |
| **Use any chat LLM** and ChatGPT/Claude link-outs | Remove as a top-level journey | An in-place **Use copy and paste instead** disclosure inside Review. It exposes **Copy review prompt**, **Paste the model response**, and **Review pasted response**. No third-party URL receives narrative text. |
| **Get AI help (optional)** | Rename and narrow | Closed native disclosure named **Model options**, containing only the opt-in local model settings and their availability/status. |
| **Proposals** | Rename and merge | **Suggested fields** inside the persistent Review area. Exact scan, local model, and pasted model candidates use the same rows and acceptance path. |
| **Questions** plus **Your answers** | Merge | **Project details for {active assay label}**, rendered through `renderFieldInterview()` so unconfirmed, suggested, and confirmed states remain visible together. |
| Standalone advisor card | Merge visually | **Planning notes** within the Review area. It continues to consume accepted store state only; it never treats an unaccepted proposal as fact. |

### Why Draft is removed rather than repaired

Making the popup open synchronously would fix only the browser symptom. It would
leave two studies, two tabs, a hidden localStorage handoff, and two review models.
That is the opposite of the requested single workspace. Removing the feature also
removes the only reason for `core/draft.js`, `stashDraft()` /
`takeStashedDraft()`, and the draft boot-precedence branch. The supported
`meta.origin: 'draft'` value remains in schema migration for backward
compatibility with already-saved files; no existing saved project is rewritten.

## Information architecture

### 1. Project description

The first card contains the labelled narrative textarea, its truthful persistence
help, the single primary action, and the closed **Model options** disclosure.

- The narrative stays study-level and is autosaved through the existing store.
- The card states which active assay will receive accepted assay-scoped values.
- Typing updates only `narrative.text` and its provenance; it must not rebuild the
  page or destroy the textarea's caret.
- Changing the narrative marks every cached review stale. Stale candidates remain
  visible long enough to explain what happened but their Accept/Replace controls
  are disabled until the user reviews again.

### 2. Review

Review is always mounted. It is not a toast and not hidden in model settings. On
desktop it may sit beside the narrative; in narrow layouts it follows the
narrative in DOM order.

Its states are:

- `idle`: no review has been run for this exact narrative and assay;
- `scanning`: the synchronous exact-text scan is being prepared;
- `model-running`: exact results are already visible while a local request is in
  flight;
- `complete`: suggestions, conflicts, asks, unmapped output, and the honest
  non-coverage statement are visible;
- `fallback`: local review is unavailable or failed and copy/paste is available
  in the same area;
- `stale`: the narrative or assay identity no longer matches the result;
- `cancelled`: exact matches remain, while the model phase records that it was
  cancelled;
- `error`: a persistent, actionable error is shown without erasing valid exact
  matches.

Review results persist across route re-renders for the current browser tab, keyed
by active assay id plus narrative revision. They are deliberately not written to
the experiment, autosave ring, export, or project JSON. This is the trust boundary:
temporary interpretations stay temporary; the narrative is the durable source;
only an explicit candidate acceptance is durable. Reloading may clear unaccepted
review results, and the UI says so.

Candidates are grouped by field, not flattened into competing rows. If exact and
model tiers agree, the group shows one value with both warrants. If they disagree,
both remain visible with **Two interpretations disagree. Choose one; neither has
been applied.** A later source never silently displaces an earlier source.

Each candidate shows:

- destination label and destination workflow step;
- value;
- a non-colour-only source badge: **Exact text match**, **Local model**, or
  **Pasted model response**;
- the exact supporting quote from the narrative;
- any current structured value;
- **Accept suggestion** when the destination is empty, or explicit
  **Replace current value** when it is populated and different;
- **Dismiss suggestion**.

If a proposed value already equals a confirmed value, render **Already
confirmed** and no write action. Accept/Replace writes through `scopeWrite()` and
the provenance gate with the user's endorsement tag, unskips the related question,
and performs the existing readout canonical companion write when applicable.

### 3. Project details for the active assay

Use `phaseQuestions(..., 'project')` plus `renderFieldInterview()` to show every
Project field in one stable grid. There is no separate question queue or answered
archive. Leaving a field blank means “not answered yet”; confirming or updating is
the only field-grid write. A formerly skipped field becomes unskipped when the
user confirms it.

## Trust and data-flow contract

```text
narrative textarea ──explicit autosave──► store.narrative.text
        │
        ├──► parseFreeText ──exact evidence──┐
        │                                    │
        └──► prompt/schema ─► Ollama or paste ├──► parseLlmProposals/Asks
                                             │
                                             └──► projectReview model
                                                        │
                                                        ├──► Review UI (session-only)
                                                        └──explicit Accept/Replace
                                                               │
                                                               └──► scopeWrite + store
                                                                      └──► downstream steps
```

Load-bearing producer→consumer traces:

1. `renderProposalRequestPrompt()` and `buildProposalSchema()` produce the
   response contract; `parseLlmProposals()` and `parseLlmAsks()` consume that
   exact contract. Schema and prompt both allow optional `asks`, and both require
   narrative evidence for every proposal.
2. `parseFreeText()` and the LLM parsers produce candidates;
   `engine/projectReview.js` is the single grouping/conflict/source authority;
   the Review DOM must not reimplement merge precedence.
3. The review model produces a candidate bound to a narrative revision and assay
   id; `describe.js` must re-fetch current store state and verify both bindings at
   click time before calling `scopeWrite()`.
4. `phaseQuestions()` produces confirmation state; `renderFieldInterview()`
   consumes it; the Project commit handler unskips and writes the exact scoped path
   so `workflowProgress.js` sees the confirmation.
5. `projectModelOptions.js` produces explicit local-model configuration and
   availability; `describe.js` consumes a fresh snapshot at Review time. A
   detection result for an old endpoint may never switch the configured model.
6. Narrative input invalidates the review session; the Review renderer consumes
   that stale flag by disabling all write actions. This is the guard against a
   late model response or old suggestion applying to new prose.
7. Removing `takeStashedDraft()` from `main.js` precedes removing its producer in
   `persist.js`; the final build proves there is no surviving consumer or hidden
   new-tab workflow.

## Model interpretation contract

- The local/paste prompt covers all currently open question-bank fields across
  phases for the active assay. This lets a paragraph mention later microscopy or
  timing details without forcing the user to repeat them on another screen.
- The model may propose only a supplied field path. Choice values remain locked to
  the app's vocabulary. Free-text values must still be grounded in an exact quote
  from the narrative.
- Every proposal carries an `evidence` string copied verbatim from the narrative.
  The parser receives the narrative snapshot and rejects missing, oversized, or
  non-occurring evidence. It must render the rejection in Review rather than only
  logging it.
- `asks` is optional and contains decisions or measurements the description does
  not answer. It never writes a field.
- Exact scan results remain available if the model is disabled, unavailable,
  rate-limited, times out, returns malformed JSON, or is cancelled.
- The app must never label everything outside the four deterministic recognizers
  as a computed text span. It says plainly that the rest was not converted and
  remains narrative.
- The local model is called only when the user has enabled it and clicks **Review
  description**. Detection runs only after opening/enabling **Model options**, not
  on every Project mount while the feature is off.
- Copy/paste never writes on paste. **Review pasted response** parses into the same
  session-only candidate model as Ollama. No ChatGPT/Claude link-out remains.

## Exact interface and acceptance text

These strings are contractual. Tests may assert them literally where they are
part of a pure renderer/model; the live verifier must read them in the shipped
artifact.

| State or element | Exact text |
| --- | --- |
| Existing approved intro | **Start with the experiment itself -- the question, the organism, why you’re running it -- before any microscope decision. Project design, then Microscopy.** |
| Textarea label | **Project description** |
| Textarea help | **Write this in your own words. Micronaut saves the full description with this study; only suggestions you accept become structured fields.** |
| Assay binding | **Accepted assay details will apply to: {assay label}.** |
| Primary action | **Review description** |
| Empty review | **Add a project description before reviewing it.** |
| Initial Review state | **No review yet. Add a description, then choose Review description.** |
| Exact scan loading | **Checking exact text matches…** |
| Local loading | **Exact matches are ready. Checking with {model}…** |
| General success | **Review complete. Nothing has been added to your project.** |
| Exact-only success | **Exact-text review complete. Micronaut kept everything else as narrative, not structured data.** |
| No candidates | **No structured suggestions found. Your full description is still saved as narrative.** |
| Non-coverage disclosure | **Micronaut does not treat the rest of this description as structured data. It remains in the saved narrative.** |
| Session disclosure | **Suggestions stay in this tab until you change the description or switch assays. Accept a suggestion to save it.** |
| Model disclosure | **Model suggestions are interpretations, not facts. Review the quoted evidence before accepting one.** |
| Local unavailable/failure | **The local model could not be reached. Your description is still saved, and nothing was added to the project.** |
| Rate limit | Reuse the exact current `rateLimitLabel()` text, followed by **Use copy and paste instead.** |
| Cancellation | **Model review cancelled. Exact matches remain available.** |
| Stale review | **Description changed — review again before accepting suggestions.** |
| Conflict | **Two interpretations disagree. Choose one; neither has been applied.** |
| Rejected model output | **Some model output could not be mapped to supported fields and was not applied.** |
| Model settings summary | **Model options** |
| Local opt-in | **Also use my local model (Ollama)** |
| Manual fallback summary | **Use copy and paste instead** |
| Manual actions | **Copy review prompt**, **Paste the model response**, **Review pasted response** |
| Review section headings | **Review**, **Suggested fields**, **Needs your decision**, **Not converted**, **Planning notes** |
| Structured grid heading | **Project details for {assay label}** |

The whitespace-only path must focus the textarea and expose the empty-review text
through `role="alert"`; it must not rely on a toast. Successful, loading, cancelled,
and stale states use a persistent `aria-live="polite"` status.

## State and side-effect acceptance

- A textarea input event may change only `narrative.text` and its provenance
  before the normal autosave machinery runs.
- Clicking **Review description** may update the session review model, and an
  actual Ollama call may update the existing request counter. It must not change
  any experiment field, provenance slot, skipped list, autosave snapshot, or draft
  handoff.
- Opening/copying/pasting/model configuration must not write experiment state.
  Model settings continue to persist only under the existing `micronaut.llm.*`
  configuration keys.
- Only **Accept suggestion**, **Replace current value**, and the field grid's
  explicit Confirm/Update controls may write structured experiment fields.
- A refused `store.setPath()` must leave the candidate visible and render a
  persistent error; it must not remove the row and show success.
- `window.open()` is not called anywhere in the Project review flow. The old
  `draftHandoff` key is neither produced nor consumed after cleanup.
- The `meta.origin: 'draft'` migration vocabulary remains accepted so old project
  backups continue to load.

## Loading, errors, and races

- Exact scanning renders synchronously before waiting on a model.
- During local review the primary button is disabled, the Review region has
  `aria-busy="true"`, elapsed time remains visible, and a **Cancel model review**
  control aborts the provider request.
- Every request captures narrative text, active assay id, open-question list, and
  a monotonically increasing request token. The response is ignored if any binding
  is stale. `finally` handlers must also check the token before touching live DOM,
  so an old request cannot re-enable or relabel a newer run.
- Editing the description while a request is running aborts it, preserves exact
  matches as stale, disables candidate actions, and shows the stale text above.
- Switching assays aborts/detaches the old request. Results are keyed per assay,
  and every Accept handler reads current store state rather than a render-time
  assay/value snapshot.
- Model failure automatically opens the in-place copy/paste fallback and keeps the
  actual error in an expandable technical detail. User text never includes a raw
  token, Authorization header, or full endpoint with credentials.
- Malformed paste, code-fenced paste, repaired JSON, unknown paths,
  out-of-vocabulary values, missing evidence, duplicate paths, and oversized asks
  all render through the same bounded issue list. Valid candidates in a partial
  reply survive.

## Responsive and accessibility requirements

- Desktop at 1200px and above: narrative and Review form a two-column workspace;
  Project details spans the available width below. Review must not become a sticky
  panel that hides its bottom controls at short viewport heights.
- Tablet: columns collapse before either textarea, evidence, or controls are
  squeezed below a usable width.
- Mobile at 320px, 375px, and 430px: DOM order is narrative → Review → Project
  details; action rows wrap vertically; buttons and disclosure summaries are at
  least 44px high; long model names, paths, evidence, and errors wrap without
  horizontal scrolling.
- Every input has a real `<label>` association. Every repeated candidate button
  has a unique accessible name containing the destination label and value.
- Source, conflict, loading, success, and error states are communicated by text and
  semantics, never colour alone. Both themes meet current contrast conventions.
- Native `<details>/<summary>` owns **Model options**, **Use copy and paste
  instead**, technical errors, and optional Planning notes. Focus rings remain
  visible on every interactive element.
- Dynamic result updates use `aria-live`; focus is not moved on successful review.
  Empty input focuses the textarea. Accept/Replace returns focus to the next
  candidate or the Review heading when the list empties.
- Partial subtree rendering must preserve the narrative caret and any text typed
  into the manual paste box. Handlers for sibling controls re-fetch current state
  to avoid the stale-closure regression in CMA lesson 46.
- Respect `prefers-reduced-motion`; do not add a new animation requirement.

## Execution batches

The authoritative, resumable task objects are in
`docs/plans/project-workspace-redesign-task-graph.json`.

| Batch | Tasks | Purpose |
| --- | --- | --- |
| 1 — response producers | PWR-01, PWR-02, PWR-05 | Align structured schema, prompt, and runtime availability without touching UI composition. |
| 2 — ingest boundary | PWR-03 | Make evidence and unsupported output honest at the parser boundary. |
| 3 — review model | PWR-04 | Establish one source of truth for grouping, conflicts, session bindings, and stale state. |
| 4 — UI components | PWR-06, PWR-07 | Build file-disjoint advanced settings and Review renderers against settled contracts. |
| 5 — workspace wiring | PWR-08 | Replace the fragmented Describe DOM and connect the only study-write path. |
| 6 — retired-path cleanup | PWR-09, PWR-10, PWR-11 | Remove the new-tab draft, generic guidance, and hosted-chat link-out chains after their consumers are gone. |
| 7 — presentation and docs | PWR-12, PWR-13 | Apply responsive/a11y styling and update user-facing architecture documentation. |
| 8 — adversarial gate | PWR-14 | Verify the shipped artifact and every producer→consumer trace; fix only concrete defects. |

## Required adversarial browser traces

Run against a freshly built `dist/index.html` served over HTTP. Also run the
explicit `file://` fallback smoke in a real browser; do not substitute a static
preview for either check.

1. **Empty and save boundary:** begin blank; primary action is disabled. Force a
   whitespace-only submit and verify the alert/focus behavior. Type a multiline
   unsupported narrative, wait for autosave, reload, and verify the narrative
   survives while no structured field or proposal does.
2. **Exact scan/no silent write:** use `Confocal of mouse cortex at 63x, stained
   with DAPI and Alexa 488, n=3.` Snapshot `store.get()` before Review. Verify
   exact matches render immediately with literal evidence and destination labels;
   the experiment snapshot is byte-identical until one suggestion is accepted.
   Accept one and dismiss another; only the accepted scoped field and provenance
   change.
3. **Honest unsupported content:** review a non-fluorescence/materials-science or
   otherwise unrecognized project. Verify no “fully parsed” claim, no guessed
   slots, and the exact non-coverage/no-candidates text while the entire narrative
   remains saved.
4. **Successful local model:** use a stub or reachable Ollama model returning two
   evidence-backed proposals, one `ask`, one duplicate, and one unsupported path.
   Verify loading is announced; `asks` survives constrained decoding; duplicates
   and unsupported output are visible; no value applies until Accept.
5. **Evidence falsification:** return a plausible proposal whose evidence is not a
   substring of the narrative. Prove it is rejected and cannot reach a candidate
   Accept button. Then return a literal quote and prove the same path becomes
   reviewable.
6. **Conflict/current value:** make exact and model tiers disagree, and separately
   propose against a pre-existing STRONG value. Verify neither silently wins,
   **Replace current value** names the consequence, equal confirmed values show
   **Already confirmed**, and a refused store write leaves the row plus an error.
7. **Local degradation:** test disabled, unconfigured, `file://`, offline,
   connection refused, timeout, 429/rate-limited, malformed JSON, and `{proposals:
   []}`. Every path preserves exact results and narrative, writes no experiment
   fields, and leaves the copy/paste fallback usable in Review.
8. **Paste boundary:** paste code-fenced JSON with prose, curly quotes/trailing
   comma repair, unknown/prototype paths, out-of-vocabulary choices, missing
   evidence, more than twelve asks, and one valid candidate. Only the valid
   candidate renders; every repair/drop is bounded and visibly reported; pasting
   alone changes no study state.
9. **Race: prose edit:** start a delayed local request, type into the narrative,
   then let the old response resolve. Verify it is aborted or ignored, status is
   stale, candidate writes are disabled, and the textarea retains focus/caret.
10. **Race: assay switch:** start a delayed request on assay A, switch to assay B,
    then resolve A. Verify no A response renders/applies in B. Switch back and
    confirm only a correctly bound, non-stale session can be reviewed.
11. **Field grid:** edit two sibling Project fields in sequence, confirm each,
    revise the first, navigate away/back, and verify both values/provenance states
    remain correct. Confirming a formerly skipped readout unskips it and writes the
    canonical companion path.
12. **Retired UI absence:** tab through the whole Project page. There is exactly
    one primary review action and no text/button matching **Draft a study**,
    **Suggest answers**, **Ask about this step**, **Use any chat LLM**, **Open in
    ChatGPT**, or **Open in Claude**. Spy on `window.open`; it is never called.
13. **Responsive/a11y:** at 1200px, 760px, 430px, 375px, and 320px in both themes,
    test long evidence/error/model strings, keyboard-only disclosures and
    candidate actions, live-region announcements, visible focus, 200% zoom, and
    no horizontal overflow. Cancel a model request by keyboard.
14. **Shipped artifact freshness:** verify a new `.project-workspace` selector in
    the HTTP-served built artifact, no console errors, and absence of static
    `import` statements. Then open the actual built file over `file://` and verify
    the manual fallback—not a local-model control—is the reachable continuation.

## Test and build gate

Focused tasks run the tests named in their task objects. Final acceptance runs:

```powershell
node --test web/tests/*.test.js
python -m pytest -q tests/test_single_file_build.py tests/test_kb_json_valid.py tests/test_regex_conformance.py
python tools/build_single_file.py --web-dir web --out dist
python tools/serve_dir.py --dir dist --port 8124
```

The final verifier must inspect the actual task deliverables and every problems
entry, not infer success from a green task status. It must compare the working
tree to the initial dirty diff and prove the two approved copy edits remain. No
staging, commit, push, or PR is part of this plan.

## Non-goals

- No attempt to make deterministic parsing understand every scientific project.
- No model-generated groups, instruments, controls, markers, settings, or free
  text without narrative evidence and explicit acceptance.
- No provider marketplace, cloud account, API-key flow, or new dependency.
- No redesign of Study, Design, Microscopy, Naming, Overview, or the global shell
  beyond consuming fields explicitly accepted from Project.
- No persistence of unaccepted interpretations into the project schema or
  recovery ring.
- No automatic link-out that places narrative text in a third-party URL.

## Main risks and mitigations

- **Smaller models may omit exact evidence.** This will reduce proposal count,
  but an honest visible rejection is preferable to an ungrounded write. The copy
  prompt includes a literal example and `asks` remains optional.
- **Session-only suggestions disappear on reload.** The UI says so; the durable
  narrative remains. Persisting unaccepted model output would blur the exact
  trust boundary this redesign is meant to restore.
- **A shared narrative can describe several assays.** Results are bound to and
  visibly label one active assay. Cross-assay assignment is never inferred.
- **`describe.js` remains the riskiest wiring file.** Pure grouping/state and DOM
  renderers land first, the Describe task only orchestrates them, and final live
  tests explicitly attack stale requests, sibling edits, focus, and assay scope.
- **Deleting the old draft chain can break boot if done out of order.** Its cleanup
  task removes the consumer/import and producer functions atomically after
  Describe no longer imports `buildDraftExperiment`.
- **CSS has several historical override layers.** One sole CSS task lands after
  markup stabilizes and verifies the shipped, HTTP-served single file at all
  required widths rather than trusting the module dev server.
