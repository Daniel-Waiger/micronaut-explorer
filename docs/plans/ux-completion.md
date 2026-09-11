# UX-completion implementation plan

## Purpose

This is the approved usability pass for the Planner. It addresses the points
from the UX review as one connected workflow: a person must be able to tell
whether they are in an example or their own work, what to do next for the
active assay, whether the study is actually ready, and whether their work is
safe and recoverable.

The implementation stays within the existing offline, zero-dependency,
single-file architecture. It uses the existing hash router, mutable store,
localStorage ring buffer, and native DOM controls; it introduces no server,
account, or browser-storage dependency beyond the project's current
localStorage use.

## Ground truth from the current source

- The onboarding gate is deliberately opened on every load unless the user
  chooses **Don't show this again**. Both normal completion and **Skip for
  now** only set `completed`, while `main.js` gates exclusively on
  `dontShowAgain`. This is the direct cause of the repeat interruption.
- `checkConformance()` already separates unanswered naming placeholders from
  invalid answers, but reports the default example as `pass: true` because
  warnings do not fail the binary gate. `overview.js` consequently says
  “nothing blocking” beside unfinished `UNKNOWN` / `1970-01-01` filenames.
- `persist.js` already has all the low-level pieces for an offline project
  file and recovery ring: five save slots, `listSaved`, `loadExperiment`,
  `exportToFile`, and `importFromFile`. None is wired to a user-facing
  project-management surface, and a successful save has no durable UI
  acknowledgement.
- `main.js` is the only place that owns the debounced autosave and current
  boot/recovery decision. `shell.js` owns header, assay switcher, workflow
  nav, and status/toast. These ownership boundaries should remain intact.
- `fieldInterview.js` intentionally saves only when its separate checkmark
  is clicked, but exposes only an unlabeled glyph. Its source data already
  has `confirmed` and `suggestedTag`, so clarification is a renderer change,
  not a second confirmation model.
- The existing mobile CSS turns both assay pills and step navigation into
  horizontal strips. The replacement must be alternate controls at the
  narrow breakpoint, rather than merely hiding scrollbars.

## Product decisions and non-goals

### Decisions

1. **Onboarding is once per normal completion or dismissal.** Any normal
   completion, **Skip for now**, backdrop click, or Escape records
   `completed: true`; application boot opens the gate only when it is not
   completed and the tab is not a model-draft handoff. The walkthrough stays
   available from Home and Guide. **Show onboarding again** belongs in the
   utility menu and explicitly clears the completed flag.
2. **Readiness is ternary, never inferred from a binary `pass`.**
   `ready` means no errors and no incomplete/provisional values; `needs-review`
   means no blocking errors but incomplete naming or review-level warnings;
   `blocked` means one or more `error`/`fatal` issues. The legacy `pass`
   property remains a backward-compatible synonym for “not blocked” only
   until all callers have moved; user-facing UI must read `readiness`.
3. **Placeholder-looking filenames are never silently exported as final
   data.** Export actions compute a fresh conformance report immediately
   before download. `blocked` cancels export with a clear error; `needs-review`
   requires an explicit confirmation which names the remaining review items;
   `ready` downloads directly. This guard applies to Overview's artifact
   exports and per-assay bench cards, not to the raw `.micronaut.json`
   backup—which must remain available for recovery.
4. **Recovery restores a complete migrated snapshot into the current tab.**
   Import is parsed and migrated before replacing state. A restore action
   loads one older ring slot, migrates it, and replaces the store root; the
   following autosave preserves it as a new latest recovery point. Failed
   parse/migration/storage operations surface a persistent status, never a
   success toast.
5. **The oregano seed is a labelled example until the user explicitly adopts
   it.** A new seeded default has `meta.origin: 'example'`; Home shows
   “Example study · Oregano wound-healing” and offers **Use as template** and
   **Start blank study**. Adopting changes only its origin marker to
   `template`; it does not rewrite weakly seeded values or discard work.
6. **One utility menu owns secondary actions.** Header prominence is:
   primary **New study**, durable save state, then **More** containing
   project export/import/restore, reset to example, onboarding, feedback,
   GitHub issue, and appearance. The menu uses keyboard-accessible native
   `details/summary` or equivalent button/menu semantics and closes after
   an action.
7. **Workflow progress uses the existing source of truth.** A pure progress
   model reports study-level and per-assay statuses (`not-started`,
   `in-progress`, `complete`, `needs-attention`) from explicit existing
   fields/validators. It does not pretend an incomplete example is complete.
   The shell consumes this one model for sidebar badges, active-assay summary,
   and Back/Continue. No screen creates a second copy of completion rules.
8. **Progressive disclosure is native and preserves all information.**
   Microscopy is grouped into Acquisition, Fluorophores & spillover,
   Spectral view, Panel assembly, and Guidance; only Acquisition begins open.
   Overview begins with readiness, map, and compact assay cards; detailed
   assay content and filenames are native expandable sections. No stateful
   React-like UI layer is introduced.
9. **Narrow navigation uses selects, not horizontal scrolling.** At the
   mobile breakpoint, a labelled active-assay select and a “Step N of 7”
   workflow select replace desktop pills/rail. Desktop retains the existing
   full navigation and tablet keeps its current horizontal nav where it fits.

### Non-goals

- No cloud sync, multi-device identity, or conflict resolution. “Saved
  locally” must explicitly say local.
- No change to filename generation rules or auto-replacement of placeholders.
- No destructive reset/deletion undo in this pass. The recovery ring and
  restore UI are the truthful recovery path; deletion undo can be a later
  focused feature.
- No DOM-testing framework is added. Pure models receive Node tests; the
  final integration task verifies the built, HTTP-served artifact manually.

## Data-flow and ownership

```text
core/onboarding ─────► main boot gate ─────────────► onboarding overlay
core/persist + store ─► main autosave/import/restore ─► shell save + utility UI
engine/conformance ───► engine/workflowProgress ────► shell badges/footer
       │                         │                         │
       └─────────────────────────┴────────────────────► overview export guard
core/schema/defaultStudy ───────► main + Home example state
fieldInterview state ───────────► Microscopy and Naming field controls
```

The two load-bearing consumer checks are deliberate:

- `engine/conformance.js` produces `readiness`; `engine/workflowProgress.js`
  and `overview.js` must consume that exact field. No UI may reclassify
  warnings from the issue list.
- `persist.js` produces migrated imported/restored experiments; `main.js`
  must call `store.replace`, and `shell.js` must only display status/actions
  supplied by main. A shell action must never manipulate localStorage itself.

## Execution batches

Run the task graph in its listed batches. The first batch is deliberately
pure-core and file-disjoint. Later batches serialize shell/CSS ownership;
they should not be parallelized just to use idle agents. Each executor reads
`docs/cma-lessons.md`, checks whether a prior agent already applied its
change, and runs the listed verification without committing or pushing.

| Batch | Tasks | Why this order |
| --- | --- | --- |
| 1 — core contracts | UX-01, UX-02, UX-03, UX-04 | Establish independent onboarding, state replacement, persistence, readiness, progress, and example-origin contracts. |
| 2 — boot and semantics | UX-05, UX-06, UX-07 | Wire contracts through `main`, clarify confirmation state, and give Home a truthful example path. |
| 3 — shell foundation | UX-08 | Single owner of header, nav status, utility actions, desktop progress, and mobile control markup. |
| 4 — dense screens | UX-09, UX-10 | Consume the completed contracts in Microscopy and Overview; these files are independent after Batch 3. |
| 5 — visual integration | UX-11 | One CSS owner applies all final desktop/mobile/progressive-disclosure styling after markup is stable. |
| 6 — end-to-end gate | UX-12 | Test the built artifact through all producer→consumer traces and run the entire regression suite. |

## Required adversarial traces

The final verifier must drive these actual paths, not only inspect strings:

1. Complete onboarding and reload; skip onboarding and reload; use **Show
   onboarding again**, then reload. Only the final case opens the gate.
2. On the seeded study, observe `needs-review`, visible missing-value labels,
   and a review warning before any non-backup export. Fill all mandatory
   fields and confirm the state becomes `ready`; introduce an invalid field
   and prove export is blocked.
3. Edit two Microscopy interview fields in sequence, use labelled Confirm,
   then navigate away/back. Values and their provenance-derived states must
   remain correct (the stale-closure regression class from lesson 46).
4. Make a change, wait past the debounce, see **Saved locally · just now**;
   export a project, import it, restore an older slot, and reload. Verify
   imported/restored data is the actual state shown and a storage failure
   remains visibly unsaved.
5. Narrow viewport: there are no two horizontal navigation scrollers; change
   assay and step with the labelled selects, then ensure the active desktop
   controls reflect the same state after widening the viewport.
6. Start from the oregano seed: badge is present, **Use as template** changes
   it to a user study without clearing assays, and **Start blank study**
   produces a blank origin without resurrecting the seed after reload.

## Test and build gate

Each pure-core task adds/updates its focused `node --test` file. Before
acceptance, run:

```powershell
node --test web/tests/*.test.js
python -m pytest -q tests/test_single_file_build.py tests/test_kb_json_valid.py tests/test_regex_conformance.py
python tools/build_single_file.py --web-dir web --out dist
PORT=8124 python tools/serve_dir.py dist
```

Use the built artifact served over HTTP for the live traces. Do not trust a
stale ES-module dev server or a `file://` static preview (CMA lesson 48).
The pre-existing dirty `web/kb/spectra.json` is outside this plan and must
not be overwritten, staged, or attributed to this run.
