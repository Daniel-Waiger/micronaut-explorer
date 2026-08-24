# Orientation-first UX redesign

## Outcome

Micronaut must stop asking a new user to understand its data model before the
app has helped them understand their own experiment.

The redesigned experience gives every study a persistent, domain-neutral
**Study map**:

```text
Research question
        ↓
System or material
        ↓
Comparison or observation structure
        ↓
Measurements
        ↓
Independent experimental unit
        ↓
Methods, data plan, and review
```

The map is both the first workspace and the compact orientation surface shown
throughout the app. It answers three questions at all times:

1. What am I building?
2. Which part am I editing now?
3. What is the next consequential decision?

This is an information-architecture change, not a visual reskin. It must retain
the existing offline, zero-dependency, single-file architecture, autosave,
provenance, explicit suggestion acceptance, assay-tier storage, deterministic
outputs, and export safety.

The authoritative executable task objects are in
`docs/plans/orientation-first-ux-task-graph.json`.

## Product diagnosis

The current schema is already approximately correct: one study owns one
research question and several assays, while each assay owns its specimen,
design, acquisition, panel, controls, timing, and naming fields. The visible
workflow does not reveal that hierarchy. It presents a linear sequence named
**Home → Project → Study → Design → Microscopy → Naming → Overview** while a
second, unexplained assay axis runs across the top.

The result is predictable:

- “Project” appears to be above “Study” but contains study-wide narrative and
  active-assay fields on the same page.
- “Study” comes later even though it is the actual parent of every assay.
- The user sees completion statuses before knowing what constitutes the plan.
- A worked example presents four assays and dozens of facts before the user has
  claimed or understood the workspace.
- Each screen explains itself locally, but no persistent surface explains how
  the current screen fits the whole experiment.
- Administrative omissions such as an acquisition date compete visually with
  load-bearing scientific omissions such as the independent experimental unit.

Navigation tells the user where the software is. The redesign must tell the user
where the experiment is.

## Design principles

1. **Map before editor.** First establish the experiment's shape; reveal detailed
   configuration afterward.
2. **One scientific hierarchy.** Study contains measurements; each measurement
   has its own samples/design, acquisition, controls, and data products.
3. **Domain-neutral first language.** Use “system or material,” “measurement,”
   and “experimental unit.” Microscopy-specific terms appear when acquisition is
   being planned.
4. **One dominant next action.** The app recommends the next consequential
   decision but never locks the user into a wizard or forced order.
5. **Persistent scope.** Every workspace states whether an edit applies to the
   whole study or only the active measurement.
6. **Scientific consequence over form completion.** Statuses distinguish design
   decisions, decisions required before acquisition, and values that may be
   assigned later.
7. **No new claim of scientific validation.** “Ready” means the planner's known
   requirements are satisfied; it never means the experiment is scientifically
   correct, powered, or institutionally approved.
8. **Internal stability, external clarity.** Keep `assays`, assay ids,
   `assayView()`, `scopeWrite()`, and saved v1–v4 compatibility. “Measurement” is
   the primary UI term; internal identifiers need not be renamed.

## Target information architecture

Keep the existing route ids and hash compatibility, but change their visible
meaning. Old saved links continue to open the same underlying workspace.

| Route id | Current label | New label | Scope |
| --- | --- | --- | --- |
| `home` | Home | **Study map** | Whole study; first-run orientation and persistent map editor |
| `describe` | Project | **Research brief** | Shared narrative and review, followed by clearly separated active-measurement facts |
| `study` | Study | **Measurements** | Measurement list, names, shared comparison vocabulary, and per-measurement entry points |
| `design` | Design | **Samples & design** | Active measurement only |
| `panel` / workflow id `microscopy` | Microscopy | **Acquisition** | Active measurement only; microscopy and other supported acquisition modalities |
| `naming` | Naming | **Data plan** | Active measurement only; names, manifest preview, and schedule |
| `overview` | Overview | **Review** | Whole study; map, prioritized decisions, controls, outputs, and exports |
| `guide` | Guide | **Guide** | Optional reference; excluded from progress |

The workflow remains outside-in and directly navigable. The footer no longer
implies that every researcher must march through seven equal forms. Its primary
forward action uses the current map's next-decision recommendation where one is
available, while Back and direct navigation remain intact.

## Study-context data contract

Advance the schema from v4 to v5 with one additive study-level object:

```js
studyContext: {
  system: '',
  experimentalUnit: '',
  comparisonMode: 'not-decided',
}
```

Allowed `comparisonMode` values:

- `not-decided` — the user has not described the structure yet;
- `groups` — two or more groups/conditions/treatments are expected in the
  study-level group vocabulary;
- `observational` — a descriptive/single-condition study is intentional, so an
  empty group vocabulary is not treated as a missing comparison decision.

Do not add a second research-question, comparison, measurement, replicate, or
modality field:

- question: existing `researchQuestion`;
- full prose: existing `narrative.text`;
- comparison labels: existing `groupVocabulary.levels`;
- measurements: existing `assays` array and `readout`/`readoutText`;
- measurement-specific specimen: existing `assay.specimen`;
- replicate counts: existing `assay.design`;
- methods: existing `assay.acquisition` and `assay.panel`.

The v4→v5 migration adds only the empty context object and never infers values
from legacy prose. The worked oregano example may seed context values with weak
provenance in a separate task. Imports and recovery must remain total.

## The pure Study-map projection

Add `web/src/engine/experimentMap.js`. It is the sole UI-neutral authority for
orientation. It consumes the real study and optionally the existing workflow and
conformance reports; it does not write state.

Its result must include:

```js
{
  question: { value, state },
  system: { value, state },
  comparison: { mode, groups, state },
  experimentalUnit: { value, state },
  measurements: [
    {
      id,
      label,
      readout,
      specimenSummary,
      biologicalReplicates,
      technicalReplicates,
      modality,
      state,
    }
  ],
  decisions: [
    { id, tier, label, reason, routeId, measurementId }
  ],
  nextDecision,
  orientation: { answered, total, state }
}
```

`state` vocabulary is fixed:

- `missing`
- `provisional`
- `answered`
- `needs-attention`

Decision tiers are fixed and ordered:

1. `study-shape` — question, system/material, comparison mode/groups,
   measurement definition, independent unit;
2. `measurement-design` — per-measurement groups/factors/replicates/readout;
3. `before-acquisition` — acquisition method and other values genuinely needed
   before collecting data;
4. `later` — date, instrument id, sample ids, schedule estimates, and optional
   documentation that can truthfully wait.

The next-decision order is deterministic:

1. research question;
2. system or material;
3. comparison mode;
4. group labels when mode is `groups`;
5. at least one named measurement with a readout or explicit free-text intent;
6. independent experimental unit;
7. active measurement's group/design definition;
8. biological replicate decision;
9. acquisition method;
10. conformance-derived issues ordered by the tier classifier.

An observational study must not be told to invent treatment groups. A study
with one measurement must not be told to add another. A user may intentionally
skip an orientation question; the map labels it provisional and keeps every
workspace reachable.

## First-run Study-map experience

The shipped example must remain available, but it must not be confused with the
user's workspace.

The first screen has two primary choices:

- **Plan my study** — starts or continues the user's current study map;
- **Explore a completed example** — opens the oregano example in explicit
  exploration mode without adopting it.

The example remains visibly labelled **Example — changes are not your study**.
Its only mutation action is **Make a copy of this example**. The existing
template adoption mechanism supplies that action; no second example store or
read-only permission system is introduced.

For an empty/user study, Study map asks one question at a time inside the page,
not in a blocking modal:

1. **What are you trying to find out?**
2. **What organism, material, sample, surface, or system are you studying?**
3. **Will you compare groups or conditions, or is this an observational study?**
4. **What will you measure or observe?**
5. **What counts as one independent experimental unit?**

Every question includes agricultural and non-biological examples without
assuming a domain. Examples must span at least plant, soil/environment, food or
material, and microscopy/surface characterization contexts.

The interaction contract:

- one dominant **Continue** action;
- **Back** and **Decide later** remain available;
- answers save through the existing store/provenance/autosave path;
- no answer is inferred from arbitrary prose;
- no modal prevents direct navigation to another workspace;
- after the fifth question, the same surface becomes an editable Study map;
- returning users land on the map summary, not the first question;
- the map's **Next decision** action routes to the owning workspace and, when
  applicable, selects the owning measurement before navigation.

## Persistent compass

Below the header and above workspace navigation, render a compact compass from
the pure projection:

```text
Tomato drought-response study
Tomato seedlings · Control vs treatment · 3 measurements
Now editing: Root architecture → Acquisition
Next decision: Define the independent experimental unit
```

Requirements:

- collapsed by default at narrow widths but the study title/current scope remain
  visible;
- always identifies **Whole study** or **Measurement: {label}**;
- question/system/group copy truncates visually but remains available to
  assistive technology and via native title text;
- **Next decision** is a button only when a valid destination exists;
- no second completion engine is implemented in the shell;
- the current example state is visible in the compass;
- changing active measurement, route, or map data updates the compass from the
  same projection.

Replace the current headline `Workflow: N of 7 complete` with a map-oriented
summary. Step badges remain useful but their visible labels become:

- `Not started`
- `In progress`
- `Decision needed`
- `Ready for now`

“Ready for now” deliberately avoids claiming final scientific validity.

## Workspace scope contracts

### Research brief

The page begins with a scope line:

> Shared across the whole study. Suggestions are never applied automatically.

The narrative and Review area remain study-level. The structured grid is moved
under a visually distinct section:

> Measurement details — {active measurement}

Its binding line becomes:

> Accepted measurement details will apply only to: {measurement label}.

The local model and deterministic review retain their current evidence,
staleness, assay-binding, and explicit acceptance rules. Internally they may
continue to use assay ids. No model prompt may be broadened to invent the new
study-context values.

### Measurements

This is the owner of the measurement collection and shared comparison
vocabulary. Visible “Assay” labels become “Measurement”; expert help may say
“measurement (assay)” once.

Each measurement row shows:

- name;
- readout/intended observation;
- system/specimen summary when present;
- current design/acquisition state;
- **Continue planning this measurement**;
- remove action.

The shared group vocabulary is introduced as a convenience for comparison
labels, not a mysterious template. It remains a seed: custom per-measurement
groups are never silently overwritten.

### Samples & design

Persistent scope text:

> Planning samples and replication for: {measurement label}.

The first section explicitly distinguishes:

- experimental unit — what is independently assigned or sampled;
- biological/independent replicates;
- technical replicates or repeated measurements;
- groups versus crossing factors.

The study-level experimental-unit statement is shown read-only with an **Edit on
Study map** action. The per-measurement design model is unchanged.

### Acquisition

Persistent scope text:

> Planning how data will be acquired for: {measurement label}.

Keep microscopy as the current specialization, but the introduction must not
suggest every supported sample is biological. Existing modality options,
progressive disclosure, panel, spectra, and guidance remain intact.

### Data plan

Persistent scope text:

> Planning files and work for: {measurement label}.

Differentiate values required to form a final filename from values that may be
assigned on acquisition day. Preview placeholders remain visible, but must be
labelled as placeholders rather than appearing to be factual dates or ids.

### Review

Open with the same Study map projection, followed by decisions grouped by
consequence:

1. **Study-shape decisions**
2. **Measurement-design decisions**
3. **Before acquisition**
4. **Can be assigned later**

Then show controls, generated filenames, staged execution advice, and exports.
The existing conformance engine remains the final-artifact gate. The UI must say
**All planner checks complete** rather than “the study is scientifically ready.”

## Terminology contract

Primary visible terms:

| Avoid as primary label | Use |
| --- | --- |
| Project | Research brief or Study, depending on scope |
| Assay | Measurement |
| Readout | What will be measured / Readout |
| Design | Samples & design |
| Microscopy | Acquisition |
| Naming | Data plan |
| Overview | Review |
| Needs review (for every problem) | Decision needed / Before acquisition / Can be assigned later |

Do not mechanically replace internal identifiers, schema keys, source comments,
migration vocabulary, or specialist output where “assay” is scientifically
necessary. The user-facing guide defines once:

> A measurement is one observation or analysis used to answer the study
> question. In some fields this is called an assay.

## Status and issue-tier contract

Add `web/src/engine/decisionTriage.js`. It consumes existing map decisions and
conformance issues and assigns display tiers without changing conformance
severity or export permission.

It must use field/section identity, not message substring matching. At minimum:

- study-context gaps, research question, comparison structure, readout,
  experimental unit → `study-shape`;
- groups, factors, biological/technical replicate decisions, controls →
  `measurement-design`;
- modality, magnification when required, panel conflicts, invalid target paths →
  `before-acquisition`;
- acquisition date, sample id, instrument label, timing and optional notes →
  `later` unless an existing validator marks the value invalid/blocking.

Blocking severity remains blocking regardless of tier. Tier answers “when/why
does this matter?”; severity answers “may a final artifact be exported?” These
must never be collapsed into one value.

## Accessibility and responsive behavior

- The Study-map question sequence is a normal page region with a visible heading,
  progress text, real labels, and one `aria-live="polite"` status. It is not a
  dialog and does not trap focus.
- “Decide later” remains visible and keyboard reachable.
- The map is semantic HTML first. Any connecting lines are decorative and hidden
  from assistive technology.
- The compact compass never becomes the only place a value can be read or edited.
- At 320, 375, and 430px: map nodes stack; no horizontal map or navigation
  scroller is introduced; action rows wrap; touch targets remain at least 44px.
- At 200% zoom: study title, active scope, and next decision remain readable.
- State is communicated by text and semantics, not color alone.
- Existing dark/light themes and reduced-motion behavior remain supported.

## Explicit non-goals

- No attempt to support every agricultural domain through templates.
- No ontology, protocol database, statistical power calculator, or LIMS.
- No automatic derivation of the experimental unit from prose.
- No automatic conversion of every narrative sentence into structured fields.
- No rename of `assays` in persisted JSON or core source APIs.
- No cloud account, sync, collaboration, or server.
- No forced wizard order or route guard based on orientation completion.
- No claim that completion equals scientific validity, ethics approval, biosafety
  approval, instrument suitability, or adequate statistical power.
- No changes to filename token order or condition expansion.

## Data flow and ownership

```text
schema v5 + default study
        │
        ├──► experimentMap projection ───► Study-map page
        │                │
        │                ├───────────────► shell compass + next decision
        │                └───────────────► Review decision groups
        │
        ├──► existing workflowProgress ──► route badges/footer
        │
        └──► existing conformance ───────► decisionTriage ─► Review
                                             │
                                             └────────────► export gate remains
                                                            conformance-owned
```

Load-bearing producer→consumer invariants:

1. `experimentMap.js` alone selects `nextDecision`; Home, shell, and Review must
   consume the returned object rather than reimplement the priority order.
2. `decisionTriage.js` alone assigns decision tiers. It must not alter issue
   severity or `readiness`; Overview's export guard continues to consume fresh
   conformance.
3. v5 migration adds empty context only. `defaultStudy.js` is the only producer
   allowed to seed example context.
4. Measurement language is presentation-only. `assayView`, `scopeWrite`, assay
   ids, import/export JSON, and migration keys remain byte-compatible except for
   the additive v5 context.
5. Home/Study-map writes use the existing store and provenance. Shell and Review
   are consumers; neither writes context directly.
6. Next-decision routing sets `activeAssayId` before navigating when the decision
   owns a measurement. A stale assay id must result in a safe no-op and map
   refresh, never an indexed write.

## Execution batches

Run the JSON task graph in data-flow order. Tasks in one batch are file-disjoint
unless the graph explicitly marks them non-parallel. Every Terra executor must:

1. read `docs/cma-lessons.md`, this plan, and its full task object;
2. inspect the current working-tree diff before editing;
3. treat already-applied work from another agent as unverified input;
4. run its focused verification and the full JavaScript suite before handoff;
5. not commit, push, reset, or overwrite unrelated changes;
6. report exact files changed, tests run, and any deviation from the task
   contract.

| Batch | Tasks | Purpose |
| --- | --- | --- |
| 1 | ORI-01 | Establish the additive persisted context contract. |
| 2 | ORI-02, ORI-03, ORI-04 | Seed the example and build independent pure map/triage producers. |
| 3 | ORI-05, ORI-06 | Integrate map semantics into progress and build the reusable map UI. |
| 4 | ORI-07, ORI-08 | Replace the front door and add the persistent compass. |
| 5 | ORI-09, ORI-10, ORI-11, ORI-12 | Clarify Research brief, Measurements, Samples & design, and Acquisition in parallel. |
| 6 | ORI-13, ORI-14, ORI-15 | Finish Data plan, Review/triage, and explanatory content. |
| 7 | ORI-16, ORI-17 | Align generated outputs/docs, then apply the sole CSS integration pass. |
| 8 | ORI-18 | Rebuild and adversarially verify the shipped artifact. |

### Terra dispatch contract

Dispatch one task object to one Terra agent. Do not give an agent only the task
title. Its prompt must include the task id and require it to read the complete
task object from the JSON graph:

```text
Execute ORI-XX from docs/plans/orientation-first-ux-task-graph.json.

Before editing, read:
1. docs/cma-lessons.md
2. docs/plans/orientation-first-ux.md
3. the complete ORI-XX task object, including global invariants, dependencies,
   files, scope, and verification
4. the current diff and every source/test file named by the task

Assume completed dependency tasks are unverified input until their relevant
contracts and tests are confirmed. Stay inside the named concern and files unless
a proven compile/runtime dependency makes a deviation necessary; report such a
deviation before relying on it downstream. Do not commit, push, reset, rewrite
unrelated changes, or mark the task verified yourself.

Return:
- outcome: done | blocked | needs-verification
- files changed
- focused and full commands run, with exact pass/fail counts
- acceptance evidence for every verification clause
- deviations, risks, and every problem noticed even if non-blocking
```

Within a batch, agents may run concurrently only when their graph entries are
`parallel_safe: true` and their file lists remain disjoint in the live tree.
Later batches do not start until all dependencies have been independently
checked. ORI-18 is the required skeptical verifier; implementation agents do not
substitute self-review for that gate.

## Required adversarial traces

The final verifier must run these against a freshly built `dist/index.html`
served over HTTP. It must also smoke the actual built file over `file://` because
offline use is a product contract.

1. **True first run:** no recoverable save. The first page offers **Plan my
   study** and **Explore a completed example** without showing a populated study
   as the user's work.
2. **Five-question orientation:** answer question and system, choose groups, add
   Control/Treatment, create two measurements, define an experimental unit.
   Reload after every answer and prove the map persists without losing focus or
   duplicating a measurement.
3. **Observational branch:** choose observational, leave group vocabulary empty,
   and prove no decision tells the user to invent groups.
4. **Decide later:** skip system and experimental unit. All workspaces remain
   reachable; the map labels the gaps provisional and the compass recommends the
   first skipped consequential decision.
5. **Domain breadth:** enter one plant study, one soil/material study, and one
   surface-characterization study. No UI copy assumes cells, treatment, organism,
   or fluorescence before those facts are supplied.
6. **Example ownership:** explore oregano, verify its example banner/compass, make
   a copy, edit it, reload, and prove it is now user work. Starting blank must not
   resurrect the example.
7. **Persistent scope:** on every route verify the compass says Whole study or
   the exact active measurement. Switch measurements on Research brief, Samples &
   design, Acquisition, and Data plan; no old measurement name or data survives
   in the scope label.
8. **Next-decision routing:** from the compass, route a study-level decision and a
   measurement-specific decision. The latter must activate the correct
   measurement before navigation. Delete that measurement and prove an old
   decision cannot write or route to a phantom index.
9. **Research review trust boundary:** review a narrative with exact and model
   suggestions. No structured field changes until Accept/Replace; the active
   measurement binding uses new visible language and stale/race protections still
   work.
10. **Measurement vocabulary:** inspect desktop, mobile, Guide, walkthrough,
    Review, exports, SVG/Markdown/CSV/bench card, empty states, confirmations, and
    accessible names. User-facing navigation says Measurement; persisted JSON and
    internal core APIs still say `assays`.
11. **Independent-unit explanation:** verify the Study map defines the concept,
    Samples & design displays the study-level answer, and changing it there routes
    back to the map without mutating replicate counts.
12. **Status consequence:** leave date/sample id missing but complete study shape
    and method. Review groups them under **Can be assigned later**, while a missing
    experimental unit remains a Study-shape decision and an invalid filename path
    remains blocking/before-acquisition.
13. **Export invariant:** triage labels never weaken the conformance gate. A
    blocking issue still prevents export; needs-review still confirms; ready still
    exports directly.
14. **Responsive/a11y:** 1200, 760, 430, 375, and 320px; both themes; keyboard-only;
    200% zoom; reduced motion. No horizontal scrolling, clipped next action,
    unlabeled map field, invisible focus, or color-only state.
15. **Compatibility:** import representative v1, v2, v3, and v4 fixtures. Each
    migrates to v5 with empty context and unchanged assay/naming/design data. Export
    and re-import remain stable.
16. **Regression:** guided example, local-model review, panel editing, spectral
    view, filename planning, restore/import, mobile selectors, and all current
    exports continue to work with no console errors.

## Test and build gate

Focused verification is listed per task in the task graph. Final acceptance:

```powershell
node --test web/tests/*.test.js
python -m pytest -q tests/test_single_file_build.py tests/test_kb_json_valid.py tests/test_regex_conformance.py
python tools/build_single_file.py --web-dir web --out dist
python tools/serve_dir.py dist
```

Do not trust the development page when `kb.dev.js` may be stale. Final browser
traces use the freshly built artifact. Record the exact JavaScript/Python pass
counts and browser trace results in the run handover.

## Definition of done

- A first-time user can describe the shape of a study without encountering the
  full editor first.
- The app persistently shows the study, active scope, and next consequential
  decision.
- The visible hierarchy is Study → Measurements → per-measurement planning.
- The terminology works for agricultural, environmental, biological, food,
  imaging, and material/surface studies.
- Missing decisions are grouped by consequence rather than flattened into one
  red checklist.
- Existing data, offline behavior, provenance, explicit acceptance, exports, and
  internal assay APIs remain intact.
- All focused/full tests, builds, HTTP traces, and `file://` smoke checks pass.
