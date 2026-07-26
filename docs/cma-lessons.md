# CMA pipeline lessons

Maintained by the **cma-learner** stage after each execute run. Planner, executor
and verifier agents MUST read this file before starting work and apply it. Keep it
readable in one pass (~150 lines for A–D, ~40 for E): the learner merges/dedupes
rather than appending, adds "seen N×" to recurring lessons, and deletes lessons that
stop earning their space. Merged IDs are noted ("absorbed N") so old references
resolve. **This file is currently ~35 lines over budget — the next learner must cut
a weak-evidence lesson before adding one** (removed so far: 13, 26, 27, 28).

Format per lesson: **practice — evidence — why it matters.**

## A. Structured output & agent prompts

1. **Schema-require only decision-critical fields; default the rest in code, but
   describe every field in the prompt.** — Seen 3× (2026-07-13): verifiers burned
   the 5-retry StructuredOutput cap omitting `problems`/`recommendation`; prompt-level
   enumeration reduced but did NOT eliminate it. Fix: EXEC_SCHEMA=[task_id, outcome],
   VERIFY_SCHEMA=[task_id, pass, evidence]; the script normalizes the rest (→[],
   accept/see-problems, ''). The clean streak now spans five hardened runs, incl.
   16 agents / 0 schema deaths on 2026-07-26. — Models reliably omit fields they feel
   carry no information; removing those from the required set kills the failure mode
   instead of nagging against it.
2. **When a workflow fails, read the journal before re-running.** — 2026-07-13: a
   failure looked like a code problem but the journal showed the verifier had judged
   PASS three times and only fumbled the envelope. — The cheapest diagnosis is the
   transcript you already paid for.
3. **A prompt edit busts only that stage's cache (replay is free); a SCHEMA change
   busts every same-stage cache.** — Seen 2× (2026-07-13): a verifier-prompt fix
   re-ran only verifiers, but v2d schema hardening invalidated all verify caches, so
   a fresh reduced plan beat resumeFromRunId (lesson 14). — Cache keys are (prompt,
   opts); know which edits force a full re-run before choosing resume vs fresh.

## B. Task design (planning)

4. **One-file, one-concern tasks pass adversarial verification at very high rates.**
   — Seen 3× (2026-07-12 v2c 13 tasks/1 failure; Drive-links 8/8; 2026-07-26
   addressable-metadata 8/8, zero retries, ~104 min). — Small scopes make the
   verifier's job decidable and the executor's diff reviewable.
5. **Order batches so no intermediate deploy can misroute live data — and BUNDLE
   into one task/deploy any change an intermediate state would corrupt.** —
   2026-07-12 (v2c-a needed review-routing BEFORE the upload picker; v2c-b the
   inverse); 2026-07-13 (v2f bundled a HEADERS new-column change with its client
   round-trip because updateRow()'s full-row overwrite would blank the column between
   deploys). — "Each task leaves the app deployable" is a property of the ORDER; when
   a full-row write can clobber a half-migrated column, deployability also requires
   atomicity. Derive both from data flow.
6. **State environment invariants in every task scope, not once globally.** — Seen 2×
   (2026-07-12/13): a cross-file constant ref passed `node --check` and an Opus
   verifier yet took down production (eval order); once planners baked eval-order /
   header-append-LAST / legacy-key invariants into every task scope, the
   highest-rated risks had zero incidents. — Executors and verifiers see one task at
   a time; unrestated global context is lost.
7. **Verify assumptions against the live system/source — never docs, search, or an
   unproven hypothesis; a disproven hypothesis is a no-op, not a task.** — Absorbed
   27. 2026-07-12: a searched-for model id 404'd at launch. 2026-07-13 (v2e-sec): the
   planner grepped and disproved its #1 vuln hypothesis (keys were header-only, not
   in a URL param), dropping a speculative task. — Docs and assumptions lag reality;
   the code is the cheapest oracle for whether a fix is even needed.
22. **Diagnose "slow load" by counting call sites × per-call latency, then give one
    top handler ownership of all reads (helpers keep a self-read fallback) and defer
    freshness probes past first paint.** — 2026-07-13 (dashboard-perf 3/3): a 7-12s
    load was ~28 API calls/refresh, cut to 8, with no profiler. — Counting call sites
    is cheaper and more exact than profiling.
31. **Batch granularity follows the dependency graph, not a parallelism bias — a
    genuinely linear build-up is correctly shipped as sequential batches of 1.** —
    2026-07-14 (gemini-batch-extraction): 7 tasks each built directly on the previous,
    so 7 batches of 1 was the right shape; 7/7 first-try. — Forcing parallel batches
    onto a linear chain manufactures ordering hazards and false "already-applied"
    states (lesson 14).
32. **When the orchestrator has already PROVEN something expensive, hand it to the
    plan as GROUND TRUTH plus an explicit "do not re-derive".** — 2026-07-26
    (addressable-metadata): before dispatch the orchestrator had built and validated
    two modules against the real 1.02GB LIF and stated the root cause as fact
    ("bioio `.metadata` for LIF is an ElementTree.Element whose `str()` is a memory
    address"); no executor re-derived any of it — 8/8 first-try. — Agents re-litigate
    anything phrased as a hypothesis; naming it as established fact converts
    investigation budget into implementation budget.
33. **The planner must read the touched code ADVERSARIALLY and reconcile the
    objective against it — the objective is a hypothesis, not a spec.** — 2026-07-26:
    the planner caught two defects the human+orchestrator objective missed (metadata.py
    also assigned bioio `channel_names` unconditionally and `_is_placeholder_channel`
    does not filter colour names, so wiring the key map alone would still have emitted
    GREEN-BLUE-RED; `_detect_format` returns GENERIC for plain `.tif`, so routing
    harvest by format would have silently dropped the ImageJ Info block) and corrected
    an acceptance criterion that would have failed falsely — container markers resolve
    'DAPI-CY3-ALEXA488' while a series gives 'ALEXA488-DAPI-CY3', so it mandated SET
    comparison, not string equality, in every downstream task. — Both defects would
    have shipped; the planning stage is the cheapest place to falsify the objective,
    and acceptance criteria over joined/ordered collections must state set-vs-sequence
    semantics explicitly or they encode the wrong pass condition.

## C. Verification practices

8. **Give verifiers concrete adversarial traces, not "check it works".** —
   2026-07-12/13: real defects surfaced only with specific scenarios (a notice wiped
   by an async refresh; XSS-in-title-attribute) and truth tables (99/100/160 of 200).
   — An unguided verifier confirms; a scenario-guided one falsifies.
9. **Regression-gate shared code paths byte-for-byte — and for a behavior-preserving
   refactor, prove it by RUNNING the git-HEAD copy and the working-tree copy through
   identical scenarios and asserting equal outputs, not just a static diff.** — Seen
   3× (2026-07-12 forced-bank prompt; 2026-07-14 write-back refactor proven by
   deepEqual on captured updateRow payloads; 2026-07-26 byte-diff of the
   q.get-before-p.join invariant block vs HEAD). — Shared-path edits are where
   refactors silently change live behavior.
10. **Use a runtime harness when logic has arithmetic or must never throw — and
    exercise the DEGRADED modes, not just the happy path.** — 2026-07-13: the
    free/paid split needed a fixture asserting the catch-block fallback; never-throw
    helpers needed a stub that THROWS plus null input. — grep proves presence; only
    execution proves arithmetic, and never-throw is proven only by feeding the helper
    the failures it must swallow.
20. **Prove the hazard is LIVE, then prove the guard is what stops it — verify the
    MECHANISM, not the surface.** — Absorbed 28. Seen 3× (2026-07-13 pills-inertness
    traced through the delegated listener's reach; an exclusion guard proven by
    EMPTYING the exclusion list in place). 2026-07-26: verifiers monkeypatched harvest
    to return [] to show the channel_names block was DEMOTED not deleted (the fallback
    still fires and still yields GREEN-BLUE-RED), patched BioImage to raise to show
    degraded mode keeps harvested keys, RAN the literal-spec code path to confirm it
    reproduces the bug the executor deviated to avoid, and pushed a 1,356,611-char
    metadata_text through the real spawn Queue to prove picklability at size rather
    than by inspection. — A passing happy path says nothing about an invariant;
    falsifying the alternative is what makes a verdict evidence rather than assent.
29. **A doc/JSDoc claim about a change a LATER task delivers is non-blocking, not a
    failure — check the dependency graph before failing.** — 2026-07-13 (v2f): T3's
    spec wrote a claim whose code lived in T5, two batches later. — Batched execution
    makes early tasks reference not-yet-applied behavior; the durable fix is
    co-locating the doc with its code.
30. **A verifier's "non-blocking / accept" labels SEVERITY, not correctness — the
    orchestrator's independent re-scan of EVERY problems entry is the only gate that
    catches SPEC bugs; cross-cutting collisions (a bare class/selector/global shared
    by two features) are blocking-by-default.** — Seen 2×. 2026-07-13
    (review-queue-polish): an accepted unscoped `.confidence-low` rule silently
    recolored an unrelated modal input. 2026-07-26: the post-verify scan found FOUR real
    defects that had all PASSED verification, each already written up in an accepted
    `problems` entry (headerless CSV on an empty row list; a field→key map save that
    replaced the whole map with only the current file's options, deleting another file's
    mapping; `st.success()` before `st.rerun()`; a provenance line pairing an edited value
    with its original key). THREE of the four were spec-mandated — the executor did exactly
    what the task said and the task was subtly wrong. — A verifier correctly refuses to
    FAIL a task for obeying its spec, so it routes the defect to `problems`/accept; if the
    orchestrator treats that list as a formality, spec bugs ship. A verifier writing
    "flagged for the orchestrator's post-verify scan" is doing the right thing, and
    problems entries that are specific, reproducible and name the exact fix location are
    what made a 4-defect catch cheap.
34. **If a task touches code whose only coverage sits behind a test marker excluded
    from the default run, the task's verification step must NAME that marked run
    explicitly.** — 2026-07-26: the 3 tests covering `_detect_format` / ImageJ-Info
    routing are marked `integration` and deselected from the fast run, so the
    planner-caught `.tif` regression would have passed CI green. — Default-run green
    is not coverage; a deselected marker is a blind spot exactly where the plan edits.

## D. Pipeline discipline

11. **Executors never run git commit, git push or clasp push — the orchestrator owns
    deployment; and before concluding an agent committed, check `git log --format=%an`.**
    — 2026-07-12: an executor pushed to origin mid-pipeline (policy now hard-coded in
    .claude/agents/cma-executor.md). 2026-07-26: the user committed 4× to main from
    GitHub Desktop DURING the run and the orchestrator initially read it as an executor
    violation. — Unverified work must not reach history; human commits during a run are
    normal, so attribute before accusing.
12. **The plan gate is where scope changes belong.** — 2026-07-12: adding History
    mid-review was handled by re-invoking the planner (4→8 tasks), not hand-editing the
    plan. — Re-planning is cheap; plan/execution divergence is not.
14. **On a resumed run, executors detect already-applied changes, re-verify the diff
    and report done WITHOUT re-editing; on a schema change prefer a fresh reduced plan
    with dirty-tree notes over resumeFromRunId.** — Seen 3× (2026-07-13): resuming
    would re-run early verifiers against a tree already holding later edits
    (bogus-fail→retry→revert); a fresh plan with an ORCHESTRATOR NOTE ("inspect diff;
    if correct do NOT re-edit") and a per-task dirty-tree note ("uncommitted changes
    from earlier verified tasks are expected, not defects") kept 9 tasks clean. — An
    explicit dirty-tree expectation prevents false verifier failures at scale.
21. **Executors/verifiers that read this file pre-apply its invariants unprompted.** —
    Seen 8×, near-zero nits (2026-07-13/14/26; records 8/8, 7/7, 6/6, 6/6, 3/3 first-try,
    zero retries). Highlights: a verifier re-derived byte-identical diffs of 3 prompt
    builders and ran HEAD vs working-tree copies through identical scenarios (lesson 9);
    another caught its OWN fixture bug before returning a verdict; 2026-07-26 a verifier
    wrote "flagged for the orchestrator's post-verify scan per lesson 30" and that
    hand-off caught a silent config-loss bug. — The file only pays off if read;
    front-loading its invariants converts nit-catching into nit-prevention.
24. **Launch/relaunch via a generated script, not inline tool-call args; embed the saved
    task graph via JSON.stringify and syntax-check it inside the runtime's async wrapper;
    do the extraction and file writing in Node, not PowerShell.** — Absorbed 26. Seen 4×.
    2026-07-13 (v2d): a ~30KB plan passed inline mangled the args string mid-payload
    ("Unterminated string", zero agents run). Plain `node --check` rejects workflow
    scripts, so wrap the body in `(async function(agent,parallel,pipeline,phase,log,args,
    budget,workflow){…})` in a scratch copy and check THAT. 2026-07-26: a 34KB graph — the
    first to exceed the 15KB inline threshold for real — launched first try by scriptPath,
    and Node-only file I/O avoided the PowerShell mojibake trap. — Interpolated deep-JSON
    escaping is not reliable at size, and the pre-launch check must mirror the execution
    wrapper to prevent a zero-agent death.
35. **An executor forced to deviate must publish the deviation AS the delivered contract
    for downstream tasks, and the verifier must FALSIFY the literal spec before accepting
    it.** — 2026-07-26: T1's literal spec (text fallback for any field the key map did not
    produce) reintroduced the exact bug the task existed to kill, so T1 changed
    `_shared_fields` to a 3-tuple adding `contested` and wrote "treat the 3-tuple as this
    task's actual contract when T4 extends it"; the verifier ran the literal-spec path,
    confirmed the wrong magnification, and proved the deviation inert for single-image
    containers — T4 consumed the new shape without friction. — Silent deviations
    desynchronize later tasks and unproven ones are just scope creep; a published and
    falsified deviation is a plan amendment that costs the pipeline nothing.

## E. This repo's invariants (microscopy-naming-assistant)

Proven 2026-07-26 against the real 1.02GB LIF unless noted. Sections A–D stay
generalizable; when one proves out repeatedly, consider upstreaming it to the cma-run
repo's docs/lessons-core.md.

E1. **bioio's `.metadata` for LIF is an `ElementTree.Element`; `str()` of it is a memory
    address, not XML.** Never stringify metadata — harvest addressable key paths
    (`metadata_keys.py` / `field_map.py`). This is the root cause the whole
    addressable-metadata refactor exists to fix.
E2. **`BioImage(lif).channel_names` returns colour names (`['Green','Blue','Red']`) and
    `_is_placeholder_channel` does NOT filter colour names.** channel_names is a demoted
    fallback behind harvested keys only; any edit there must be tested with harvest
    monkeypatched to `[]` to confirm the fallback is demoted, not deleted.
E3. **Multi-image containers leak across images two ways.** (a) Never run text-pattern
    extractors over the concatenated blob: `_extract_magnification` →
    `_extract_near_key('Objective')` picks up another series' objective (X2 on the real
    LIF); fields that disagree across images are `contested` and must be dropped, not
    merged. (b) Marker order is not stable — container-level resolution follows series-0
    detector order (`DAPI-CY3-ALEXA488`) while a single series gives `ALEXA488-DAPI-CY3`,
    so compare marker collections as SETS unless order is what's under test.
E4. **`_detect_format` returns GENERIC for plain `.tif`, and the Fiji/ImageJ Info-block
    tests are marked `integration` (deselected from the default run).** Anything touching
    format routing must run `pytest -m integration` explicitly (see lesson 34).
E5. **CSV writers carry explicit column constants:** `rows_to_csv(rows, fieldnames=None)`
    with `REPORT_COLUMNS` / `SIDECAR_COLUMNS` passed at every call site — an empty row
    list otherwise emits a headerless file (reachable via `batch --strict --report`).
E6. **Streamlit:** (a) a selectbox whose stored value is absent from the current options
    silently resets to the default, so per-file mapping saves must MERGE into the existing
    map and treat '(automatic)' as a genuine clear only when the previously-mapped key was
    among this file's options; (b) `st.success()` immediately before `st.rerun()` is never
    rendered — set a session_state flag and render after the rerun.
E7. **Provenance UI must show the metadata KEY's own value and annotate when
    `sources[field] != 'metadata'`.** Pairing the final (LLM-filled or hand-edited) value
    with the key it originally came from manufactures exactly the false provenance this
    refactor exists to eliminate.
