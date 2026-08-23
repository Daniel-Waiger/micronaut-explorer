# Guided example walkthrough

## Outcome

The oregano study becomes an explicitly optional, learn-by-looking path.
A first-time visitor chooses one of three clear doors:

1. **Walk through example** — open the oregano example with one persistent,
   contextual explanation panel.
2. **Explore myself** — keep the example and use the app normally, with no
   coach marks or forced navigation.
3. **Start blank** — replace the fresh example with an empty study and enter
   the normal workflow.

The walkthrough covers the seven primary workflow steps—Home, Project,
Study, Design, Microscopy, Naming, and Overview—and explains each feature's
What, Why, When, and How using values read from the real study. It is not a
chain of modal tooltips. One non-modal aside stays beside the current page,
can be paused without losing progress, and can be reopened from Home, Guide,
or **Explain this step** in the workflow footer.

## Ground truth and compatibility

- `ui/walkthrough.js` currently implements an eight-stop spotlight overlay
  (including Guide) with a backdrop and one terse sentence per step. It
  forces navigation and has no durable progress state. This implementation
  is replaced, not layered underneath a second tour.
- The UX-completion work already defines exactly seven primary steps in
  `engine/workflowProgress.js`; Guide is explicitly optional. The guided
  order must consume that order instead of maintaining a competing list.
- `createDefaultStudy()` now marks the oregano seed with
  `meta.origin: 'example'`, and Home already exposes **Use as template** and
  **Start blank study**. Those callbacks remain the one ownership/lifecycle
  path; walkthrough completion must call them rather than rewrite study
  state itself.
- `main.js` is the lifecycle coordinator and already passes callbacks into
  steps. `shell.js` owns the workflow footer and page layout. The new aside
  host belongs in the shell, while controller/state transitions belong in
  the walkthrough module coordinated by main.
- `buildStudyDocument()` and `checkConformance()` are the existing, tested
  projections for example values, filenames, condition counts, controls,
  and readiness. Guided content consumes these producers; it must not
  reimplement condition expansion, filename construction, or readiness.
- Onboarding is already one-time after completion/dismissal. For this
  feature, its first screen becomes the three-path chooser and is shown only
  when the current study is the fresh example. A returning user study,
  imported study, or draft must never be interrupted by an example chooser.

## Experience design

### First entry

The one-screen welcome identifies the data before asking for a choice:

> You are looking at an example study: Oregano wound-healing · 4 assays.
> Nothing here is your data yet.

The three actions are equal, explicit choices—not a primary button plus two
de-emphasized escape links. Every action records onboarding completed.
**Walk through example** starts guided progress at Home; **Explore myself**
leaves the example untouched and closes the chooser; **Start blank** uses
main's recoverable blank-study action. Backdrop click and Escape behave as
**Explore myself**, never as **Start blank**.

The old project-stage and experience-level questionnaire is removed from
this first-entry surface to keep the decision to one screen. Existing stored
experience remains readable for the app's verbosity behavior; no migration
or forced reset is necessary.

### The single contextual panel

The shell provides an empty `<aside>` beside the page. While walkthrough or
explanation mode is open, `ui/walkthrough.js` renders one card into it:

- `Example walkthrough · Step N of 7`
- feature name and a one-sentence **Outcome**
- **In this example** using the current study/active assay values
- concise What / Why / When / How rationale; What is visible and the longer
  rationale may use native `details` disclosure
- **Try this** — one optional, non-destructive observation or interaction
- **Why does this matter?** — an explicit, reopenable disclosure
- Back, Pause, and **Next feature: <name>**

Navigation stays real: Next routes to the next primary page; changing a
step or assay through normal shell controls refreshes the panel from current
state. The panel never targets dozens of DOM elements, blocks the page with
a backdrop, or creates per-control bubbles. At narrow widths it becomes an
inline card after the page content rather than covering inputs.

**Explain this step** opens the same panel in explanation-only mode for the
current primary page without resetting or advancing saved walkthrough
progress. Closing explanation-only mode restores the prior saved progress.
Guide remains reference material and is not an eighth guided step.

### Persisted progress

One versioned localStorage record stores only presentation state:

```text
status: not-started | active | paused | completed
currentStepId: one of the injected seven primary IDs
completedStepIds: ordered, de-duplicated primary IDs
completedAt: ISO string or null
```

The state helper is total, has an injectable storage backend, filters stale
or unknown step IDs against the primary workflow supplied by its caller,
and never stores experiment data. Advancing marks the current step complete
and moves to the next; Pause preserves the cursor; Resume returns there;
Restart explicitly clears completion. A corrupt or unavailable preference
store degrades to not-started and cannot crash the application.

Changing the active assay does not change walkthrough progress. It only
refreshes **In this example**, which is important: the panel should teach
that Project, Design, Microscopy, and Naming are assay-scoped.

### Completion

After Overview, the aside becomes a completion card instead of navigating
to Guide. It summarizes the seven outcomes and offers:

- **Use as template** — adopt the example through main's existing callback,
  preserving the four assays and marking walkthrough completed.
- **Start my own** — start the recoverable blank study through main's
  existing callback and mark walkthrough completed.
- **Keep exploring example** — close the aside, retain `origin: example`, and
  mark the walkthrough completed.

If the study is no longer an example because the person adopted or edited a
template, static What/Why/When/How explanations still work; wording changes
from **In this example** to **In this study now**. Starting a fresh guided
example later from a blank/user study must not silently replace data. Home
and Guide offer **Explain the workflow** for the current study; only the
explicit existing **Reset to example study** action changes the study.

## Context contract for all seven steps

`engine/guidedExample.js` returns a complete content object for each primary
step:

```text
stepId, title, outcome, what, why, when, how,
exampleLabel, exampleSummary, tryThis, nextStepId, nextTitle
```

It reads the active assay from the experiment and uses the existing study
document and conformance projections. No UI module reaches into raw nested
paths to compose an alternative story.

| Step | Real example values used | Outcome and optional “Try this” |
| --- | --- | --- |
| Home | explicit example origin and assay count | Recognize that this is a worked example, not personal data; inspect the four assay tabs. |
| Project | active assay label, readout state/label, organism/sample | Understand how a readout and specimen frame later advice; switch from Bacterial viability to Intracellular ROS and watch the explanation change. |
| Study | research question, CTL/OPP vocabulary, four assay labels | See how one question coordinates several measurement approaches; compare the shared vocabulary with the assay list. |
| Design | active assay groups, factors, replicate axes, condition count from the study document | See how CTL/OPP and species/stimulation expand into planned rows; inspect one condition without editing it. |
| Microscopy | modality, marker/channel rows, spectral/control facts from the study document | Connect confocal and SYTO9/propidium iodide to acquisition and spillover review; open the spectral section. |
| Naming | effective naming fields and planned filename examples from the study document | Understand how design fields become filenames and why missing date/sample values still require review; expand one planned-name section. |
| Overview | conformance readiness/counts, map/assay/control/export outputs | Read Needs review honestly, find the remaining issues, and understand when export is ready. |

Tests must obtain expected values by running `createDefaultStudy()`,
`buildStudyDocument()`, and `checkConformance()`; do not hand-create a
fixture that guesses their output (CMA lesson 40).

## Producer → consumer checks

1. `PRIMARY_WORKFLOW` → guided state/content/controller: order, IDs, labels,
   progress denominator, Back/Next destination, and `Step N of 7` must all
   come from the same injected array. Route `microscopy` still maps to the
   real router ID `panel` through the existing shell routing authority.
2. `createDefaultStudy` + `buildStudyDocument` + `checkConformance` →
   `engine/guidedExample` → `ui/walkthrough`: change active assay and verify
   the visible values change without advancing progress; change a study
   field and verify one fresh content refresh, not a stale closure.
3. guided progress helper → main controller → panel: start, pause, reload,
   resume, advance, and complete must show the exact saved cursor and
   de-duplicated completed set.
4. onboarding buttons → main lifecycle callbacks: Walk starts/resumes the
   guide without altering the example; Explore changes no experiment data;
   Start blank invokes the same recoverable blank action as the header.
5. completion buttons → existing `onAdoptExample` / `onNewBlank`: study
   origin and assay preservation/replacement must match Home's existing
   actions byte-for-byte in behavior.
6. shell aside/footer → walkthrough controller: **Explain this step** uses
   current route content but must not mutate stored guided progress.

## Execution and verification

Run the task graph batches in data-flow order. Core state and content are
file-disjoint and may run together; shell layout and panel renderer can then
run together against those contracts. Bundle onboarding with main wiring so
the three new buttons are never shipped with missing callbacks. Give CSS one
final owner after markup settles.

Final verification must use the built single-file artifact served over HTTP:

```powershell
node --test web/tests/*.test.js
python -m pytest -q tests/test_single_file_build.py tests/test_kb_json_valid.py tests/test_regex_conformance.py
python tools/build_single_file.py --web-dir web --out dist
python tools/serve_dir.py --dir dist --port 8124
```

The verifier drives first entry, pause/reload/resume, route and assay changes,
completion choices, and 375px layout. It must prove there is one guide panel,
zero legacy backdrops/tooltips during guided use, no console errors, and no
changes to the pre-existing dirty `web/kb/spectra.json`.
