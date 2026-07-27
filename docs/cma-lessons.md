# CMA pipeline lessons

Maintained by the **cma-learner** stage after each execute run. Planner, executor
and verifier agents MUST read this file before starting work and apply it. Keep it
readable in one pass (~150 lines for A–D, ~40 for E): the learner merges/dedupes
rather than appending, adds "seen N×" to recurring lessons, and deletes lessons that
stop earning their space. Merged IDs are noted ("absorbed N") so old references
resolve. **2026-07-27: a compression pass + 2 deletions + 3 merges paid for four new
lessons; A–D is still ~35 lines over budget, so the next learner must again cut or
compress before adding** (gone: 2, 13, 22, 26, 27, 28; absorbed: 3→14, 31→5, 34→10).

Format per lesson: **practice — evidence — why it matters.**

## A. Structured output & agent prompts

1. **Schema-require only decision-critical fields; default the rest in code, but describe
   every field in the prompt.** — Seen 3× (2026-07-13): verifiers burned the 5-retry
   StructuredOutput cap omitting `problems`/`recommendation`, and prompt-level enumeration
   reduced but did NOT eliminate it. Fix: EXEC_SCHEMA=[task_id, outcome],
   VERIFY_SCHEMA=[task_id, pass, evidence]; the script normalizes the rest (→[],
   accept/see-problems, ''). Clean across six hardened runs (16 agents / 0 schema deaths on
   2026-07-26). — Models omit fields they feel carry no information; removing those from
   the required set kills the failure mode instead of nagging against it.

## B. Task design (planning)

4. **One-file, one-concern tasks pass adversarial verification at very high rates —
   surface area is what predicts retries.** — Seen 4× (2026-07-12 v2c 13 tasks/1 failure;
   Drive-links 8/8; 2026-07-26 addressable-metadata 8/8 zero retries; 2026-07-27
   safe-renaming: one-file A5 and C1 both COMPLETE first try, while C2 — app_streamlit.py
   + cli.py, several UI surfaces — took the run's only retry AND carried both post-verify
   defects). — Small scopes make the verifier's job decidable and the diff reviewable.
5. **Batch order follows the DATA FLOW and the dependency graph, not a parallelism bias:
   bundle into one task anything an intermediate state would corrupt, and ship a genuinely
   linear build-up as sequential batches of 1.** — Absorbed 31. 2026-07-12 (review-routing
   had to precede the upload picker); 2026-07-13 (a HEADERS new-column change bundled with
   its client round-trip, since updateRow()'s full-row overwrite would blank the column
   between deploys); 2026-07-14 (7 tasks each building on the previous → 7 batches of 1,
   7/7 first-try). — "Each task leaves the app shippable" is a property of the ORDER, and
   forcing parallel batches onto a linear chain manufactures ordering hazards and false
   "already-applied" states (lesson 14).
6. **State environment invariants in every task scope, not once globally.** — Seen 2×
   (2026-07-12/13): a cross-file constant ref passed `node --check` and an Opus verifier
   yet took down production (eval order); once planners baked eval-order /
   header-append-LAST / legacy-key invariants into every task scope, the highest-rated
   risks had zero incidents. — Executors and verifiers see one task at a time; unrestated
   global context is lost.
7. **Verify assumptions against the live system/source — never docs, search, or an
   unproven hypothesis; a disproven hypothesis is a no-op, not a task.** — Absorbed 27.
   2026-07-12: a searched-for model id 404'd at launch. 2026-07-13 (v2e-sec): the planner
   grepped and disproved its #1 vuln hypothesis (keys were header-only, not in a URL
   param), dropping a speculative task. — Docs and assumptions lag reality; the code is
   the cheapest oracle for whether a fix is even needed.
32. **When the orchestrator has already PROVEN something expensive, hand it to the plan as
    GROUND TRUTH plus an explicit "do not re-derive".** — 2026-07-26: the root cause was
    stated as fact ("bioio `.metadata` for LIF is an ElementTree.Element whose `str()` is a
    memory address") after validation against the real 1.02GB LIF; no executor re-derived
    any of it — 8/8 first-try. — Agents re-litigate anything phrased as a hypothesis;
    naming it as established fact converts investigation budget into implementation budget.
33. **The planner must read the touched code ADVERSARIALLY and reconcile the objective
    against it — the objective is a hypothesis, not a spec.** — 2026-07-26: the planner
    caught two defects the human+orchestrator objective missed (an unconditional
    `channel_names` assignment that would still emit GREEN-BLUE-RED; `_detect_format`
    returning GENERIC for plain `.tif`, silently dropping the ImageJ Info block — see E2/E4)
    and corrected an acceptance criterion that would have failed falsely (marker ORDER
    differs between container and series, so downstream tasks were made to compare SETS). —
    Both defects would have shipped; planning is the cheapest place to falsify the
    objective, and acceptance criteria over joined collections must state set-vs-sequence
    semantics or they encode the wrong pass condition.
36. **A task's change breaks a DIFFERENT task's consumer, and file-scoped verification
    structurally cannot see it: name each producer→consumer pair in the plan and give the
    LAST task in the chain an explicit end-to-end check.** — Seen 2× (2026-07-26
    `rows_to_csv`; 2026-07-27 A5 seeded `sources['date']='mtime'` as the baseline for EVERY
    file while C2's new gate treated a weak mtime date as equally blocking as a provisional
    LLM-derived field, making "All clear! Ready to apply." unreachable for nearly any
    ordinary file). Both passed their own task's verification. — The interaction lives in
    neither file's tests. Corollary: a gate mixing signals of different strength must TIER
    them (provisional → blocks; weak-but-universal → informational) or the ordinary case
    never reaches the success path.

## C. Verification practices

8. **Give verifiers concrete adversarial traces, not "check it works".** — 2026-07-12/13:
   real defects surfaced only with specific scenarios (a notice wiped by an async refresh;
   XSS-in-title-attribute) and truth tables (99/100/160 of 200). — An unguided verifier
   confirms; a scenario-guided one falsifies.
9. **Regression-gate shared code paths byte-for-byte — and prove a behavior-preserving
   refactor by RUNNING the git-HEAD copy and the working-tree copy through identical
   scenarios and asserting equal outputs, not just a static diff.** — Seen 3× (2026-07-12
   forced-bank prompt; 2026-07-14 write-back refactor proven by deepEqual on captured
   updateRow payloads; 2026-07-26 byte-diff of the q.get-before-p.join invariant block vs
   HEAD). — Shared-path edits are where refactors silently change live behavior.
10. **Use a runtime harness when logic has arithmetic or must never throw, exercise the
    DEGRADED modes, and if the only coverage sits behind a test marker excluded from the
    default run, NAME that marked run in the verification step.** — Absorbed 34.
    2026-07-13: the free/paid split needed a fixture asserting the catch-block fallback;
    never-throw helpers needed a stub that THROWS plus null input. 2026-07-26: the
    `_detect_format` / ImageJ-Info tests are marked `integration` and deselected, so the
    planner-caught `.tif` regression would have passed CI green. — grep proves presence,
    execution proves arithmetic, never-throw is proven only by feeding the helper what it
    must swallow, and default-run green is not coverage.
20. **Prove the hazard is LIVE, then prove the guard is what stops it — verify the
    MECHANISM, not the surface.** — Absorbed 28. Seen 3× (2026-07-13: an exclusion guard
    proven by EMPTYING the list in place. 2026-07-26: harvest monkeypatched to `[]` to show
    channel_names was DEMOTED not deleted; BioImage patched to raise to show degraded mode
    keeps harvested keys; a 1.36M-char metadata_text pushed through the real spawn Queue to
    prove picklability at size). — A passing happy path says nothing about an invariant;
    falsifying the alternative is what makes a verdict evidence rather than assent.
29. **A flagged issue that a LATER task owns — or that the next planned task will REVERSE —
    is non-blocking; check the dependency graph and the upcoming plan before failing it or
    fixing it, and write the deferral reason where the next agent reads it.** — Seen 2×.
    2026-07-13 (v2f): T3's spec wrote a doc claim whose code lived in T5, two batches later.
    2026-07-27: C1's verifier flagged llm.py calling a user description both "the weakest
    evidence here" and "authoritative context"; the next planned policy (A-1) inverts C1's
    "never override" framing, so hardening the wording now would be rewritten within one
    task — deferred with the reason in the commit message (see E9). — Fixing what the next
    task unfixes costs two reviews, but an UNRECORDED deferral looks exactly like a miss.
30. **A verifier's "non-blocking / accept" labels SEVERITY, not correctness — the
    orchestrator's independent re-scan of EVERY problems entry is the only gate that
    catches SPEC bugs; cross-cutting collisions (a bare class/selector/global shared by two
    features) are blocking-by-default.** — Seen 3×, last two scans 100% on flagged items:
    2026-07-13 an accepted unscoped `.confidence-low` rule recolored an unrelated modal
    input; 2026-07-26 FOUR real defects that had all PASSED verification sat in accepted
    `problems` entries (headerless CSV; a key-map save deleting another file's mapping;
    `st.success()` before `st.rerun()`; false provenance pairing) and THREE were
    spec-mandated; 2026-07-27 10 entries → 2 real live defects (lessons 36, 37), zero false
    positives, no verifier recommending anything but accept. — A verifier correctly refuses
    to FAIL a task for obeying its spec, so it routes the defect to `problems`/accept;
    treat that list as a formality and spec bugs ship. Budget the scan as a mandatory
    stage, and write problems entries reproducible enough to name the exact fix location.
37. **Verify a new blocking flag by asking "what user action CLEARS it?" and "how many
    ORDINARY inputs land in the blocked branch?" — not just "does it fire?"** —
    2026-07-27: editing a value in the Tag Files data_editor updated `s.fields` but never
    `s.sources`, so a provisional/weak flag survived the exact review it was demanding —
    no path short of a full re-preview could clear it (fix: retag user-changed values
    `user_edited`). — A review gate that its own review action cannot satisfy is a
    deadlock, and every happy-path test reads it as "the guard works".

## D. Pipeline discipline

11. **Executors never run git commit, git push or clasp push — the orchestrator owns
    deployment; before concluding an agent committed, check `git log --format=%an`.** —
    2026-07-12: an executor pushed to origin mid-pipeline (now hard-coded in
    .claude/agents/cma-executor.md). 2026-07-26: the user committed 4× to main from GitHub
    Desktop DURING the run and the orchestrator read it as an executor violation. —
    Unverified work must not reach history; human commits during a run are normal, so
    attribute before accusing.
12. **The plan gate is where scope changes belong.** — 2026-07-12: adding History
    mid-review was handled by re-invoking the planner (4→8 tasks), not hand-editing the
    plan. — Re-planning is cheap; plan/execution divergence is not.
14. **On a resumed run, executors detect already-applied changes, re-verify the diff and
    report done WITHOUT re-editing; on a schema change prefer a fresh reduced plan with
    dirty-tree notes over resumeFromRunId.** — Absorbed 3. Seen 3× (2026-07-13): resuming
    re-ran early verifiers against a tree already holding later edits
    (bogus-fail→retry→revert); a fresh plan with an ORCHESTRATOR NOTE ("inspect diff; if
    correct do NOT re-edit") plus a per-task dirty-tree note kept 9 tasks clean. — An
    explicit dirty-tree expectation prevents false verifier failures at scale. Cache keys
    are (prompt, opts): a prompt edit re-runs only that stage (replay is free), a SCHEMA
    change invalidates every same-stage cache — which is what made resume the worse option.
21. **Executors/verifiers that read this file pre-apply its invariants unprompted.** — Seen
    9×, near-zero nits (2026-07-13/14/26/27; records 8/8, 7/7, 6/6, 6/6, 3/3, 2/3 first-try).
    Highlights: a verifier ran HEAD vs working-tree copies through identical scenarios
    (lesson 9); another caught its OWN fixture bug before returning a verdict; 2026-07-26 a
    verifier wrote "flagged for the orchestrator's post-verify scan per lesson 30" and that
    hand-off caught a silent config-loss bug. — The file only pays off if read; front-loading
    its invariants converts nit-catching into nit-prevention.
24. **Launch/relaunch via a generated script, not inline tool-call args; embed the saved
    task graph via JSON.stringify and syntax-check it inside the runtime's async wrapper; do
    extraction and file writing in Node, not PowerShell.** — Absorbed 26. Seen 4×.
    2026-07-13 (v2d): a ~30KB plan passed inline mangled the args string mid-payload
    ("Unterminated string", zero agents run); plain `node --check` rejects workflow scripts,
    so check a scratch copy wrapped in `(async function(agent,parallel,pipeline,phase,log,
    args,budget,workflow){…})`. 2026-07-26: a 34KB graph launched first try by scriptPath;
    Node-only file I/O avoided the PowerShell mojibake trap. — Interpolated deep-JSON
    escaping is not reliable at size, and the pre-launch check must mirror the execution
    wrapper or you get a zero-agent death.
35. **An executor forced to deviate must publish the deviation AS the delivered contract for
    downstream tasks, and the verifier must FALSIFY the literal spec before accepting it.** —
    2026-07-26: T1's literal spec reintroduced the exact bug the task existed to kill, so T1
    made `_shared_fields` a 3-tuple adding `contested` and wrote "treat the 3-tuple as this
    task's actual contract when T4 extends it"; the verifier RAN the literal-spec path,
    confirmed the wrong magnification, and proved the deviation inert for single-image
    containers — T4 consumed the new shape without friction. — Silent deviations desync later
    tasks and unproven ones are scope creep; a published, falsified deviation is a free plan
    amendment.
38. **What the gate stage SAVES must be the exact object the execute stage LOADS — persist
    full task objects (id/title/scope/verification/depends_on/parallel_safe), never a
    summary.** — 2026-07-27: the saved task-graph JSON held only
    id/title/files/depends_on/batch/concerns while cma-execute.js needs scope/verification
    text, which survived only as prose in the sibling .md plan, so resuming A5+C1+C2 cost a
    manual transcription pass. — A lossy artifact still LOOKS resumable; the loss only
    surfaces at resume time, when the planning context is gone.
39. **Keep the run dashboard live and pointed at the CURRENT task graph for every
    CMA-adjacent piece of work, and tag tasks COMPLETE (first try) vs RESOLVED (needed a
    retry).** — 2026-07-27 (standing user instruction, same day the state split shipped):
    A5/C1 COMPLETE vs C2 RESOLVED-after-1-retry immediately identified C2 as the run's only
    oversized task (lesson 4). — Collapsing both states to "done" throws away the cheapest
    empirical read on whether the planner sized tasks right.

## E. This repo's invariants (microscopy-naming-assistant)

Proven 2026-07-26/27 against the real 1.02GB LIF unless noted. Sections A–D stay
generalizable; when one proves out repeatedly, consider upstreaming it to the cma-run
repo's docs/lessons-core.md.

E1. **bioio's `.metadata` for LIF is an `ElementTree.Element`; `str()` of it is a memory
    address, not XML.** Never stringify metadata — harvest addressable key paths
    (`metadata_keys.py` / `field_map.py`). Root cause of the addressable-metadata refactor.
E2. **`BioImage(lif).channel_names` returns colour names (`['Green','Blue','Red']`) and
    `_is_placeholder_channel` does NOT filter colour names.** channel_names is a demoted
    fallback behind harvested keys; any edit there must be tested with harvest monkeypatched
    to `[]` to confirm the fallback is demoted, not deleted.
E3. **Multi-image containers leak across images two ways.** (a) Never run text-pattern
    extractors over the concatenated blob: `_extract_magnification` →
    `_extract_near_key('Objective')` picks up another series' objective (X2 on the real LIF);
    fields that disagree across images are `contested` and must be dropped, not merged.
    (b) Marker order is not stable — the container follows series-0 detector order
    (`DAPI-CY3-ALEXA488`), one series gives `ALEXA488-DAPI-CY3`; compare marker collections
    as SETS unless order is what's under test.
E4. **`_detect_format` returns GENERIC for plain `.tif`, and the Fiji/ImageJ Info-block tests
    are marked `integration` (deselected from the default run).** Anything touching format
    routing must run `pytest -m integration` explicitly (lesson 10).
E5. **CSV writers carry explicit column constants:** `rows_to_csv(rows, fieldnames=None)`
    with `REPORT_COLUMNS` / `SIDECAR_COLUMNS` passed at every call site — an empty row list
    otherwise emits a headerless file (reachable via `batch --strict --report`).
E6. **Streamlit:** (a) a selectbox whose stored value is absent from the current options
    silently resets to the default, so per-file mapping saves must MERGE into the existing
    map and treat '(automatic)' as a genuine clear only when the previously-mapped key was
    among this file's options; (b) `st.success()` immediately before `st.rerun()` is never
    rendered — set a session_state flag and render after the rerun.
E7. **Provenance UI must show the metadata KEY's own value and annotate when
    `sources[field] != 'metadata'`.** Pairing the final (LLM-filled or hand-edited) value
    with the key it originally came from manufactures exactly the false provenance this
    refactor exists to eliminate.
E8. **`sources['date']='mtime'` is seeded as the baseline for EVERY file (metadata.py), so
    provenance gates must TIER, not lump:** PROVISIONAL_SOURCE_TAGS (description/LLM-derived)
    BLOCK "All clear! Ready to apply."; WEAK_DATE_SOURCE_TAGS (mtime) are informational
    (`st.info`) only. A value the user actually changes in the Tag Files editor must be
    retagged `user_edited` (outside both sets) or its flag can never clear.
E9. **llm.py's prompt deliberately still says the user description is both "the weakest
    evidence here" and "authoritative context".** Left inconsistent on purpose (2026-07-27,
    commit 30dc8a7): planned policy A-1 lets a description override a populated field as a
    reviewable proposal, inverting C1's "never override" framing. Do not re-flag or "fix"
    this until A-1 lands (lesson 29).
