# Planner web — broad fluorophore expansion

## Objective

Expand the Planner’s practical microscopy coverage across organic dyes, exact
fluorescent-protein variants, live-cell/organelle probes, nucleic-acid stains,
functional indicators, and near-infrared labels.

The authoritative execution specification is
docs/plans/planner-web-fluorophore-expansion-task-graph.json.

## Proposed increment

- 72 new exact canonical identities:
  - 30 organic and near-infrared labels
  - 17 fluorescent proteins
  - 6 live-cell/organelle probes
  - 7 nucleic-acid dyes
  - 12 calcium, ROS, and pH indicators
- 11 additions to the existing LYSOTRACKER, LIVEDEAD, and SYTO families.
- A source ledger linking every peak pair to an authoritative vendor record,
  FPbase record, or primary paper and recording the relevant measurement state.

After this increment, the generated marker catalog rises from 96 to 168
canonicals. The existing spectral catalog gains all 72 new direct entries plus
the 11 family variants.

## Scientific boundary

The current runtime model stores one excitation maximum and one emission
maximum. This plan deliberately does not force ratiometric, multi-state, or
photoconvertible probes into that shape. FURA2 remains an honest content gap;
BCECF, SNARF, JC-1, Indo-1, MitoSOX Red, and photoactivatable or
photoconvertible fluorescent proteins are deferred until a separate multi-state
schema is designed.

Source-backed values remain marked unreviewed in the app. Literature/vendor
verification establishes traceability, but it does not substitute for review
against FACSI’s instruments, filters, and local protocols.

## Data flow and invariants

The marker JSON is generated, not hand-authored:

1. src/microscopy_naming_assistant/markers.py defines canonical identities and
   aliases.
2. tools/export_markers_kb.py assigns editorial classes and family variants.
3. The exporter generates web/kb/markers.json and the development aggregate.
4. web/kb/spectra.json provides the runtime peaks.
5. kbpack, spectra resolution, panel facts, study-document rows, controls, and
   bench-card consumers read those packs.
6. tools/build_single_file.py embeds them into dist/index.html.

The plan preserves the 300–900 nm plausibility range, positive Stokes shift,
data-driven 25 nm emission and 20 nm excitation proximity thresholds, explicit
ambiguous-family state, honest spectrum-unavailable state, and persistent
unreviewed banner.

## Execution batches

| Batch | Tasks | Purpose |
|---|---|---|
| 1 | T1 | Curate and verify the source ledger |
| 2 | T2 | Add canonical identities and collision-free aliases |
| 3 | T3 | Classify entries and extend family variants |
| 4 | T4 | Regenerate marker KB mirrors |
| 5 | T5, T8 | Add organic/NIR spectra and lock marker producer tests |
| 6 | T6 | Add exact fluorescent-protein spectra |
| 7 | T7 | Add live-cell, nucleic-acid, ion, ROS, pH, and family spectra |
| 8 | T9, T10 | Add source-parity/resolver and pack-wiring tests |
| 9 | T11 | Exercise study-document and bench-card consumers |
| 10 | T12 | Run full gates and inspect the served shipped artifact |

## Gate

Execution starts only after explicit user approval of this plan. No commit,
push, pull request, or deployment is included without separate confirmation.
