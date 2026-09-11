# Study hierarchy and measurement status scopes

This is the reference doc `README.md` points at, and the one the user manual
(`web/manual/`) should point at too rather than re-deriving its own copy of
either the hierarchy or the status table. It has two parts: the shape of a
study (what "workspace" or "step" used to try and count), and the three
independently scoped status axes a measurement carries. Both replace an
earlier single overloaded vocabulary with something that names what it
actually measures.

## The study hierarchy

Micronaut has never been a fixed number of steps to march through in order —
it is a hierarchy of things a study *has*. Counting it as "N workspaces" or "N
steps" drifted every time a page was added or split, and different docs ended
up quoting three, five, six and seven. The hierarchy below counts nothing, so
it can't drift the same way:

```text
Study
├── Study Map: question, system, comparison, experimental unit
├── Research Brief: study-wide narrative
├── Measurements registry
│   └── Measurement
│       ├── Samples & design
│       ├── Acquisition
│       └── Data plan
└── Review: whole-study synthesis and exports

Utilities
├── Guide / walkthrough
├── Backup, restore, and settings
└── Feedback
```

A study holds one Study Map and one Research Brief, any number of
Measurements (each with its own Samples & design / Acquisition / Data plan),
and one Review that synthesizes across all of them. The Utilities branch is
not part of the study at all — Guide, Settings and Feedback exist alongside
whichever study is open, which is why they never fit a "step" count to begin
with.

## The three measurement status scopes

A measurement used to report one three-word status meant to summarize
everything about it at once. In practice that single word was overloaded: the
registry and the measurement switcher computed it from different inputs and
could disagree, and "Ready to acquire" was read as "this measurement is fully
vetted" when it actually meant only one of three unrelated things was true.

The fix is not to unify the three concerns into a smarter single word — it is
to stop pretending they were ever one concern. A measurement's *definition*
(has the shape of the measurement itself been decided?), its *plan* (are there
open decisions blocking it specifically?), and its *conformance* (do the
deterministic export checks pass?) are independent questions with independent
authorities, and collapsing them back into one status is what caused the
disagreement in the first place. Three named, narrower answers are more
honest than one overloaded one, and each is easy to reason about on its own.

| Scope | Statuses | Authority |
|---|---|---|
| `definition` | Draft / Provisionally defined / Defined | `experimentMap` measurement state |
| `plan` | Plan open / Needs a decision / Ready to acquire | open map decisions owning that measurement |
| `conformance` | Not checked / Blocked / Needs review / Checks pass | `checkConformance` readiness, verbatim |

Each measurement's headline badge is the first scope, in the order above,
that is not at its own top status (`Defined`, `Ready to acquire`, or `Checks
pass`, respectively). If all three are at their top status, the headline is
`conformance: Checks pass`.

Two consequences worth stating explicitly:

- **"Ready to acquire" now means only that the plan axis has no open
  decisions.** It is not a claim that the measurement's export checks pass —
  that is the separate conformance row, and it can still be short of its own
  top status while the plan axis reads "Ready to acquire". (The plan axis
  does require the definition to already be `Defined` before it can reach
  `ready` at all — a plan can't be judged complete for a measurement whose
  shape isn't decided yet — so "Ready to acquire" does imply `definition:
  Defined`; it says nothing about conformance.)
- **The registry and the measurement switcher read the same record.** Both
  are computed once, inside `deriveWorkflowProgress`, from the same
  `measurementStatus()` call — there is no second, independently-derived
  status anywhere in the UI for either to disagree with.

See `web/src/engine/measurementStatus.js` for the implementation and
`web/src/engine/workflowProgress.js` for where it is attached to each
measurement.

## Deliberately out of scope here

Modelling `observational | group-comparison | factorial | mixed` as
first-class study shapes (rather than the current `comparisonMode` flag) is a
real idea worth doing eventually, but it is a schema change with migration
consequences and is explicitly **not** part of this pass. See `ROADMAP.md`.
