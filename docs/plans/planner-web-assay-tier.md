# planner-web — the assay tier (schema v3)

Status: **commits 1–3 shipped and pushed** (commit 1 `49c4e2a`, review-fixed `bd24d1a`;
commit 2 `87b26ae`; commit 3 `9361d8c`, merged `b7c5a96`). **Commit 4 — the exportable
design document — is the only one remaining.** Written 2026-07-31 after Daniel uploaded a
real published paper (Romo-Rico et al. 2026, oregano plasma coatings for wound healing) as
a target for what the planner should be able to produce.

## Context

The app modeled one experiment as **one** design + **one** panel + **one** acquisition +
**one** naming template. The uploaded paper is a single study containing **four assays**
that share only a research question and a test article:

| Assay | Modality | Stains | Specimen | Extra axis |
|---|---|---|---|---|
| Bacterial viability | confocal | Syto9/PI | *P. aeruginosa*, *S. aureus* | species |
| Macrophage cytoskeleton | confocal | phalloidin/DAPI | RAW 264.7 | — |
| Intracellular ROS | confocal | DCF/DAPI | RAW 264.7 | ± LPS |
| Scratch / migration | live-cell phase | none | HFF-1 | — |

Even the specimen differs per assay. The schema could not represent this: the base name
`{date}_{modality}_{exptype}_{markers}_{magnification}` was documented as "identical for
every file in the experiment", and `conditions.js`'s uniqueness check made that load-bearing.

The word "assay" appeared **zero times** in any planning doc before this — a genuine gap,
not an unscheduled item. Most of the rest of the vision (arms, crossing factors, per-group
rationale, modality guidance) was already shipped or already planned; this tier is the one
structural prerequisite nobody had written down.

**Daniel's decisions, standing for all four commits:**
1. Model the assay tier **before** authoring K-5 control-rule content — controls attach
   per-assay and would need re-scoping otherwise.
2. Build **both** interactive guidance and an exportable design document, guidance first.
3. **"Complete what the user starts"** — the user names the assay and its readout; the app
   supplies the controls that readout demands and flags missing groups. It does **not**
   propose a whole study from a bare research question (a more ambitious fourth option that
   was explicitly turned down).

### Four verified facts that shaped the design

Each checked directly against source or run in node, not assumed:

1. **`getPath` returns `undefined` for any `[*]` wildcard**, so
   `evaluatePredicate({in: ['assays[*].acquisition.modality', […]]})` is **silently
   `false`** forever — a KB rule that loads clean, validates clean, and never fires.
2. **`setPath` auto-vivifies a missing root on write**, with no error. Verified:
   `{naming:{…}}` → `{naming:{…},"acquisition":{"modality":"confocal"}}`. This is why "move
   the schema now, rewire the UI later" could not work — the writes would land in a phantom
   object nothing reads.
3. **`setPath('assays[3]…')` on a shorter array creates `null` holes** that survive a JSON
   round-trip. An assay must never be addressed by a computed index.
4. **`interview.js` looks up provenance by the literal field path.** If data moves under
   `assays[]` and slot keys don't move with it, two assays share one slot — answering
   modality for assay A suppresses the question for assay B.

---

## Architecture

### Decision 1 — arms are PER-ASSAY; the study holds a vocabulary, not an axis

The first instinct was a shared study-level arm axis composed into each assay at read time.
**That is wrong, and fails decision 3 above:** if every assay's arms are composed from the
study's, no assay can ever *lack* an arm, so "flag missing groups" becomes uncomputable —
the model would forbid the one check it exists to enable. It also breaks on an assay running
a *subset* of arms, on UC-1 (zero arms by definition), and on control rows already being a
second, non-arm row source per assay.

```
study.armVocabulary: { levels: [] }   // a TEMPLATE for seeding new assays
assay.design.groups: { levels: [] }   // the live axis, owned by the assay
```

Creating an assay copies the vocabulary in as a real write tagged `'kb-default'` (WEAK), so
the existing provenance gate guarantees a user edit can never be clobbered by a later
vocabulary change. `expandConditions` / `conditionIssues` / `buildGroupLabel` /
`planFilenames` keep their exact current signatures — zero call-site threading.

### Decision 2 — flat view on read, scoped path on write

The engine layer must not learn about assays. `web/src/core/assay.js`:

- **`assayView(experiment, assayId)`** — a synthetic flat experiment with the active
  assay's slices hoisted to the top level, exactly where every existing consumer already
  looks. Also projects provenance so `interview.js` needs no change.
- **`scopeWrite(experiment, path, assayId)`** → `{path, slotKey}` — the index-based object
  path plus the id-based provenance key.

**Falsifiable gate for commit 1, held throughout: zero changes to `web/src/engine/*`.**
`advisor.json` (16 rules), `questions.json` (13 questions), `predicate.js`, `conditions.js`,
`plan.js`, `interview.js`, `validation.js` all stayed byte-identical.

### Decision 3 — provenance slot keys use the stable assay id, never the array index

An array index is not a stable identity — deleting assay 0 would silently repoint every
surviving slot at a different assay's value. `store.setPath` gained an optional `slotKey`
(defaulting to `path`), id-based (`assay:<id>.acquisition.modality`).

### Decision 4 — filename collisions become a real, reproducible bug (commit 2)

`conditions.js`'s per-assay uniqueness assumption stays true within one assay; the problem
is purely cross-assay, and it is the *likely* shape, not contrived — modelling
*P. aeruginosa* and *S. aureus* as two assays (because their controls differ) reproduces as
byte-identical filename sets, every file overwriting. Fix, prevention first: `exptype`
becomes required and unique across assays whenever `assays.length > 1`; backstop detection
via `engine/plan.js`'s `studyNameIssues` (one issue per colliding pair, deduped); a
`MAX_STUDY_ROWS` cap mirroring `MAX_CONDITION_ROWS`'s discipline.

### Decision 5 — `readout` is a controlled vocabulary, and "unknown" is never silence (commit 3)

Free text is unworkable: `compileFullMatch` has no case-insensitive flag, so a
`matches`-based control rule would fire on one person's spelling and nobody else's.
`web/kb/readouts.json` reuses the proven `markers.json` canonical+aliases pattern. Store
both `readout` (canonical id, what rules key on) and `readoutText` (what the user typed,
never discarded). **An empty controls list must never render as "I don't know"** — silence
reads as "this assay needs no controls," the most dangerous false negative a controls
advisor can produce. Three distinct states: rules fired → the set with each `why`; readout
known but no rules → "no control guidance for X yet"; readout unrecognized → "isn't a
readout this app recognizes, yours to specify."

---

## What shipped in commit 1

`web/src/core/assay.js` (new): `assayView`, `scopeWrite`, `emptyAssay`,
`assayIndexById`/`assayById`/`firstAssayId`, `isAssayScopedPath` (exported after the review
round below). `schema.js`: `SCHEMA_VERSION = 3`; `migrateV2toV3` hoists the whole v2 slice
verbatim into `assays[0]`, rescopes every provenance slot key to `assay:<id>.<path>`
(skipping this would silently re-ask every already-answered question on every reload,
forever). `store.js`: optional `slotKey`. `persist.js`: `loadMostRecentRecoverable()` walks
the autosave ring newest→oldest instead of giving up after slot 0 — a single unmigrateable
slot used to discard the whole session with just a `console.error`. `describe.js`/
`design.js`/`naming.js`: mechanical read-via-`assayView`, write-via-`scopeWrite`. Found and
fixed one real gap while auditing every store-access site: the free-text "Accept" proposal
button wrote via `proposal.path` completely unscoped.

**Adversarial self-review (same session, separate pass) found and fixed 4 more issues**
(`bd24d1a`): `schema.js` had reimplemented `assay.js`'s scoping predicate inline instead of
importing it (two independent copies of one fact — the exact shape already shipped twice
per lessons 49/50); `scopeWrite` didn't scope a write to the bare `naming.fields` container,
only `naming.fields.<leaf>` (latent, no current caller hits it, but a future bulk-write
would have silently hit the phantom-root hazard this module exists to prevent); a stale
header comment claimed imports the file doesn't have; four curly apostrophes in tooltip
text broke this codebase's plain-ASCII convention (a convention specific to `web/src/**`
code comments — this doc, like its sibling `docs/plans/*.md` files, uses real em-dashes,
since that convention doesn't extend to prose planning docs). All four verified fixed
empirically in node, not just via passing tests.

334 JS tests, 342 Python. Verified live against the built artifact: injected a realistic
v2-shaped autosave into localStorage and loaded the v3 build against it unchanged — modality
was not re-asked, every value and all 6 planned filenames survived migration exactly, a live
edit wrote correctly to the new assay-scoped slot with zero phantom roots, and corrupting
the newest ring slot afterward still recovered an older good one instead of discarding the
session.

## Remaining sequencing

**Commit 2 — N assays. DONE, not yet committed to git.** Switcher in `shell.js` (not
inside `design.js`, per the re-render-safety reasoning above), a new Study step (first
in `main.js`'s `steps`, so it is also the new landing page), `armVocabulary` seeding via
`core/assay.js`'s new `seedAssayFromVocabulary`, an `exptype`-collision backstop
(`engine/plan.js`'s `studyNameIssues`, which organically subsumes "exptype required when
assays.length > 1" — two assays that both leave it blank collide on 'UNKNOWN' exactly
like two that typed the same value), `MAX_STUDY_ROWS = 50`, and a divergence badge ("N of
M assays use LEVEL, LEVEL") on the Study step. `SCHEMA_VERSION` does not move — commit
1's v3 shape was already correct for N assays.

A gap found while planning, not visible in the shipped commit-1 code: `scopeWrite`'s
`isAssayScopedPath` only recognized whole container roots (`specimen`/`design`/etc.), so
`scopeWrite('label', assayId)` — needed for rename — fell through as study-level and
would have auto-vivified a phantom `experiment.label`. Fixed by adding
`ASSAY_SCALAR_FIELDS = {'label', 'readout', 'readoutText'}`, solving it for commit 3's
readout fields too so that predicate doesn't need a third pass.

Also added, pure and unit-tested in `core/assay.js`: `removeAssay(experiment, assayId)`
(refuses on the last assay, reassigns `activeAssayId`, prunes the removed assay's
provenance slots). Full lifecycle shipped: add/rename/switch/delete/apply-vocabulary-to-
existing-assays (a `kb-default`-tagged write, so `setPath`'s provenance gate naturally
skips any assay whose arms are already user-customized — "fill in the ones that
haven't diverged," never a blind overwrite).

355 JS tests (up from 334), 347 Python (unaffected, JS-only change). Verified live
against the built artifact over http: fresh load lands on Study; add/rename/switch/
delete all round-trip through a reload; a manually-customized assay is correctly
skipped by "Apply to all assays" while others converge; two assays with identical
naming fields are flagged by `studyNameIssues`; switching the active assay while on the
Design step fully re-renders it (no stale cached `assayId`), zero console errors
throughout.

> ⚠ **Ship commits 1+2 as one release.** If commit 1 reaches a real user before commit 2 and
> commit 2 changes what v3 *means*, an autosave written in between is a structurally-wrong
> v3 that `migrate()` silently no-ops past.

**Same session, immediately after: the oregano study (Romo-Rico et al. — the paper that
motivated this whole tier) became the app's real default, not just a placeholder
example.** New `core/defaultStudy.js`'s `createDefaultStudy()`, built on
`seedAssayFromVocabulary` + `core/paths.js`'s `setPath`, every populated field tagged
`kb-default` at the same slot keys a live `scopeWrite` write would produce. Wired into
`main.js`'s bootstrap fallback ONLY when no autosave exists at all — an in-progress
session is never touched. Deliberately NOT seeded into `emptyExperiment()`/`emptyAssay()`
themselves, which stay the neutral blank primitive the test suite (in particular
`plan.test.js`'s `experimentWith()` fixture) relies on. The old "CT, NAM25MM, NAM50MM"
placeholder text — confirmed via a full sweep to have never been a real default, only
ever an unrelated illustrative example — is now `CTL, OPP` everywhere in production UI;
`engine/conditions.js`'s historical-bug-narrative comments and existing test fixtures
using the old NAM values were deliberately left alone, since they document a real past
regression by its actual literal values. 367 JS tests (up from 355). Also fixed in
passing: the Study step's per-assay "Go to Design"/"Delete" buttons weren't grouped or
pinned, so their horizontal position depended on how long that row's base name happened
to be — fixed by grouping them with `margin-left: auto` rather than relying on
`justify-content: space-between`.

**Commit 3 — readout vocabulary + controls tier.** `readouts.json`, `controls.json`, a
generic evaluator reusing `predicate.js`, the three-state panel. Unblocks
`planner-web-mvp-usecases.md` §6 step 4 (K-5) — controls finally have an assay to attach to.
The controls panel needs accept/reject buttons ("rules propose, the user disposes"), which
breaks `advice.js`'s zero-focusable-elements invariant — it must re-render on explicit
action, not per keystroke, or it will steal focus.

**Commit 4 — the exportable design document.** Deliberately last, per decision 2: a pure
read over a settled model, a renderer rather than a schema change.

## Deliberately deferred, beyond commit 4

- Multi-modality *within* one assay (`planner-web-mvp-usecases.md` UC-6) — now partly
  subsumed: two modalities is two assays. Whether one assay ever needs two stays open.
- Time-course as a first-class ordered axis (UC-4/UC-7) — stays an ordinary crossing factor.
- Fields-of-view as a sampling tier below technical replicate (the paper's "3 random fields
  per sample") — real, but a third replicate tier is its own decision.
- A size guard on persistence — measured: a filled 4-assay study with 52 provenance slots is
  ~1.5% of a 5 MB quota even with the 5× autosave ring. The real cliff is materializing
  derived rows into `design.conditions` (dead today) — guard that directly if it ever
  becomes live, rather than pre-emptively capping study size.
