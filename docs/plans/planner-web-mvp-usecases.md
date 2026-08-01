# planner-web — MVP use-case map

Status: **draft for Daniel to correct.** Written 2026-07-30 in response to the
`CT-NAM50MM` defect, which exposed a modeling error rather than a formatting one.

This document exists to answer one scoping question before more code is written:
*what shapes of experiment must the MVP handle, and what does each one demand of
the engine?* Everything below is deliberately phrased as "what the user brings"
rather than "what the UI shows", because the UI is downstream of the model.

---

## 1. The modeling error this document starts from

The app produced `CT-NAM50MM` for a single file. That is nonsense: a sample is
**either** the control **or** the 50 mM NAM arm, never both.

It happened because the engine has exactly ONE concept — `factors[]` — and it
crosses all of them. Modeling "control" and "treatment" as two factors therefore
produced their cartesian product. The separator work that shipped made the two
halves *legible* (`CT-NAM50MM` rather than `CTNAM50MM`) but left them *wrong*.

Real designs need three distinct kinds of axis, and the engine currently has one:

| Kind | Example | Behaviour | Engine support today |
|---|---|---|---|
| **Crossing factor** | genotype (WT/KO) × timepoint (0h/24h) | true cartesian product | ✅ this is `factors[]` |
| **Group / arm axis** | CT \| NAM25 \| NAM50 \| NAM100 | ONE axis, mutually exclusive levels, never crossed with itself | ❌ modelled as N factors, so it self-crosses |
| **Control group** | unstained, secondary-only, isotype, single-stain | standalone rows attached to the PANEL, not crossed with the arms | ❌ absent entirely |

The third row is why control types multiply with antibody staining: they are a
function of the **panel**, not of the treatment design. You need one
secondary-only control per secondary antibody — not one per dose per replicate.
Crossing them into the design matrix is exactly the wrong answer, which is what
the current engine would do if controls were added as a factor.

**Consequence:** `GROUP` is one token whose levels are `CT`, `NAM25MM`, `NAM50MM`.
Genotype and timepoint remain crossing factors. Controls are generated, not crossed.

---

## 2. The architecture question: if/then rules vs. hard-coding

> "we need to add more if/then rules in some parts, not just free text. on the
> other hand, it limits the scope, and hard codes the project. what should i do."

**This is a false choice, and the project already has the resolution: rules live
in the knowledge pack as DATA, evaluated by a generic engine in code.**

The thing that would hard-code the project is putting `if (modality === 'STED')`
into a `.js` file. Putting the same knowledge into `web/kb/controls.json` is the
opposite — it makes the domain extensible **without touching code**, by the one
person who has the expertise.

The machinery for this already exists and is tested:

- `web/src/engine/predicate.js` (C1-2) — a total, eval-free boolean DSL that
  evaluates a JSON condition against the experiment. It already backs every
  question's `askWhen` clause.
- `web/kb/*.json` — the knowledge pack, already generated/authored and loaded.
- **K-5 "Control rules v1 (~15 rules)"** is already scoped in
  [planner-web.md](planner-web.md) as a *user-owned content task*.

So a control rule is a data record, not a code path:

```jsonc
{
  "id": "secondary-only",
  "when": { "any": [ { "eq": ["acquisition.modality", "confocal"] },
                     { "eq": ["acquisition.modality", "widefield"] } ] },
  "requiresPanel": { "hasIndirectStain": true },
  "produces": { "perSecondaryAntibody": true },
  "label": "SECONDARYONLY",
  "why": "Distinguishes real signal from secondary antibody background."
}
```

Adding isotype controls, FMO, or an autofluorescence control later is **a new
JSON entry**, not a new release. The scope is not limited, because the code never
enumerates the domain — it only evaluates rules.

**Three rules of thumb to keep this honest:**

1. **Code may know the SHAPE of a rule; only data may know its CONTENT.** The
   evaluator may know "a rule has a `when` and a `produces`". It must never know
   that STED exists.
2. **Every rule carries its own `why`.** A control the user does not understand is
   a control they will delete. This is also what makes the app teach rather than
   dictate.
3. **Rules propose; the user disposes.** Same discipline as the free-text
   proposals already shipped — a generated control group is a suggestion with
   visible provenance, never a silent write. This repo has shipped a
   silent-auto-apply defect once already.

**Free text does not go away** — it stays as the escape hatch for what the rules
do not cover, which is exactly the `OTHER` case below.

---

## 3. The `OTHER → free text` pattern is a capability, not a rule

> "IF MODALITY IS OTHER: ADD A FREE TEXT ANSWER BOX."

`modality` is already a `choice` question whose options end in `other`. Rather
than writing a rule for this one question, add a generic question-bank flag:

```jsonc
{ "id": "modality", "type": "choice", "allowOther": true, "options": [...] }
```

One change in `describe.js` — when a choice question has `allowOther` and the
user picks `other`, reveal a text input and store *that* value. It then works for
every present and future choice question (exptype, sampleType, instrument,
replicate type) with no further code.

---

## 4. Proposed filename structure

Daniel's draft (explicitly "not final"):

```
{DATE}_{MODALITY}_{EXPTYPE}_{GROUP}_{SAMPLE_NO}_{REPLICATE_TYPE}_{REPLICATE_NO}
```

Mapped onto the two-stage model already implemented:

- **Stage 1 (base, shared by every file):** `{DATE}_{MODALITY}_{EXPTYPE}`
- **Stage 2 (per-file):** `{GROUP}_{SAMPLE_NO}_{REPLICATE_TYPE}_{REPLICATE_NO}`

What this needs that does not exist yet:

| Field | Status |
|---|---|
| `MODALITY` | ✅ exists as `acquisition.modality` (choice, incl. `other`) |
| `GROUP` | ⚠️ needs the single-arm-axis model from §1 |
| `SAMPLE_NO` | ⚠️ currently `naming.fields.sample` doubles as the group slot; must split |
| `REPLICATE_TYPE` | ❌ new — biological vs technical is a second replicate axis |
| `REPLICATE_NO` | ✅ exists, but is currently biological-only |

**Two open questions, flagged rather than assumed:**

1. **`MARKERS` and `MAGNIFICATION` are absent from the draft.** They are in the
   name today, and the question bank's own copy argues for markers: *"Markers are
   the main thing collaborators search filenames for."* Dropping them is a real
   decision, not an oversight to be silently corrected — please confirm.
2. **Biological vs technical replicates nest.** `BIO2_TECH3` means the 3rd
   technical replicate of the 2nd biological one. If both are present the name
   probably needs both numbers, not one `REPLICATE_NO`.

---

## 5. MVP use cases

Ordered by how commonly they turn up. **Daniel: strike, reorder, or add.** The
MVP boundary should be drawn after UC-4 unless you say otherwise.

### UC-1 — Simple stain, no treatment
*"Fixed HeLa, DAPI + phalloidin + anti-tubulin, confocal 63x."*
- Groups: the stained sample, **plus panel-derived controls** (unstained,
  secondary-only for the anti-tubulin).
- Exercises: control generation from the panel. **No design matrix at all.**
- This is the use case the current engine handles *worst* — zero factors, but
  several required control groups.

### UC-2 — Dose response (the `CT` / `NAM` case)
*"CT, NAM 25 mM, NAM 50 mM, NAM 100 mM, n=3."*
- Groups: one arm axis, 4 levels, × 3 biological replicates = 12 files.
- Exercises: the single-arm-axis model. **Must not self-cross.**
- Plus UC-1's staining controls, which are *not* multiplied by dose.

### UC-3 — Genotype × treatment
*"WT and KO, each ± drug, n=3."*
- Groups: two genuine **crossing** factors (2 × 2) × 3 = 12.
- Exercises: that real crossing still works alongside the arm axis — this is the
  case that proves §1's distinction is necessary rather than a special case.

### UC-4 — Timecourse
*"0 h, 6 h, 24 h after treatment."*
- Groups: timepoint as a crossing factor, or as part of the arm axis if the
  treatment differs per timepoint.
- Exercises: an axis that is naturally ordered — sort order in the file listing
  starts to matter.

--- *proposed MVP boundary* ---

### UC-5 — Antibody panel with full control set
*"4-colour IF, 2 primaries raised in different species, 2 directly conjugated."*
- Groups: unstained, single-stain ×4, secondary-only ×2, isotype ×2, full stain.
- Exercises: rules that read the **panel structure** (direct vs indirect
  conjugation), i.e. the P2 panel model. Depends on K-2 spectra content.

### UC-6 — Multi-modality comparison
*"Same samples on confocal and STED."*
- Exercises: modality as an axis, which breaks the "one modality per experiment"
  assumption baked into the base-name design.

### UC-7 — Live imaging
*"Timelapse, 30 min, 2 min interval."*
- Exercises: acquisition settings that are not naming fields at all. Probably
  post-MVP.

---

## 6. Recommended order of work

1. **Fix the arm-axis model** (§1) — this is a live defect, not a feature.
   Distinguish crossing factors from the GROUP axis in `conditions.js`.
2. **Add `allowOther`** (§3) — small, generic, unblocks the modality question.
3. **Split `SAMPLE_NO` from `GROUP`** and add `REPLICATE_TYPE` (§4), once the two
   open questions are answered.
4. **Author `web/kb/controls.json` + a generic rule evaluator** (§2) — code is
   small; the content is K-5 and is Daniel's.
5. Re-scope P2 (panel/optics/spillover) against UC-5 once 1–4 land.

Steps 1–3 are code and can proceed immediately. Step 4 is the one that needs
Daniel's domain content before it means anything.
