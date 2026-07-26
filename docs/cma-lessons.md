# CMA pipeline lessons

Maintained by the **cma-learner** stage after each execute run. Planner,
executor, and verifier agents MUST read this file before starting work and
apply it. Keep it readable in one pass (~150 lines): the learner merges/dedupes
rather than appending, adds "seen N×" to recurring lessons, and deletes lessons
that stop earning their space. Merged IDs are noted ("absorbed N") so old
references still resolve.

Format per lesson: **practice — evidence — why it matters.**

## A. Structured output & agent prompts

1. **Schema-require only decision-critical fields; default the rest in code, but
   describe every field in the prompt.** — Seen 3× (2026-07-13): verifiers
   burned the 5-retry StructuredOutput cap omitting `problems`/`recommendation`;
   prompt-level enumeration of all fields reduced but did NOT eliminate it. Fix:
   EXEC_SCHEMA=[task_id, outcome], VERIFY_SCHEMA=[task_id, pass, evidence]; the
   script normalizes the rest (→[], accept/see-problems, ''). Post-fix the clean
   streak spans three consecutive hardened runs, zero envelope failures (v2e-sec
   first fully-hardened run 12 agents; then two more incl. v2f 6/6, 2026-07-13). —
   Models reliably omit fields they feel carry no
   information; removing those from the required set kills the failure mode
   instead of nagging against it.
2. **When a workflow fails, read the journal before re-running.** — 2026-07-13:
   a failure looked like a code problem but the journal showed the verifier had
   judged PASS three times and only fumbled the envelope. — The cheapest
   diagnosis is the transcript you already paid for.
3. **A prompt edit busts only that stage's cache (replay is free); a SCHEMA
   change busts every same-stage cache.** — Seen 2× (2026-07-13): a
   verifier-prompt fix re-ran only verifiers, but v2d schema hardening
   invalidated all verify caches, so a fresh reduced plan beat resumeFromRunId
   (lesson 14). — Cache keys are (prompt, opts); know which edits force a full
   re-run before choosing resume vs fresh.

## B. Task design (planning)

4. **One-file, one-concern tasks pass adversarial verification at very high
   rates.** — 2026-07-12: v2c-a/b shipped 13 tasks with one verification
   failure; the overnight Drive-links run passed 8/8, zero retries. — Small
   scopes make the verifier's job decidable and the executor's diff reviewable.
5. **Order batches so no intermediate deploy can misroute live data — and BUNDLE
   into one task/deploy any changes an intermediate state would corrupt.** —
   2026-07-12: v2c-a needed review-routing BEFORE the upload picker (else
   auto-classified docs approved into the wrong tab); v2c-b needed the inverse; a
   Plan-stage validation agent caught both. 2026-07-13 (v2f): the planner bundled
   a HEADERS new-column change with its client hide/round-trip in ONE deploy —
   updateRow()'s full-row overwrite meant any manual dashboard edit between the
   two deploys would silently blank the new column. — "Each task leaves the app
   deployable" is a property of the ORDER; when a full-row write can clobber a
   half-migrated column, deployability additionally requires atomicity, not just
   ordering. Derive both from data flow, per phase.
6. **State environment invariants in every task scope, not once globally.** —
   Seen 2× (2026-07-12/13): a cross-file constant ref in Code.gs passed
   node --check and an Opus verifier yet took down production (eval order); once
   planners baked eval-order / header-append-LAST / legacy-key invariants into
   every task scope, the highest-rated risks had zero incidents. — Executors and
   verifiers see one task at a time; unrestated global context is lost.
7. **Verify assumptions against the live system/source — never docs, search, or
   an unproven hypothesis; a disproven hypothesis is a no-op, not a task.** —
   Absorbed 27. 2026-07-12: 'gemini-3.1-pro' from a search 404'd and
   'gemini-2.5-*' died at launch, fixed with a listGeminiModels() diagnostic +
   floating alias. 2026-07-13 (v2e-sec): the planner grepped and disproved its #1
   vuln hypothesis (API key in a URL param — keys were header-only), dropping a
   speculative "switch transport" task; the plan stayed at 6. — Docs/blogs/
   assumptions lag reality; code and the API are the cheapest oracles for whether
   a fix is even needed.
22. **Diagnose "slow load" by counting API call sites × per-class latency; fix
    with shared-read discipline + defer-past-paint, not caching alone.** —
    2026-07-13 (dashboard-perf, 3/3 first-try): a 7-12s load was ~28 API
    calls/refresh because each feature read independently; grepping call sites ×
    per-class cost (SpreadsheetApp ~150-400ms, DriveApp ~100-300ms) matched the
    timing with no profiler. Fixes: top handler owns all reads and threads a rows
    map down (helpers take an OPTIONAL prefetched param with self-read fallback so
    trigger entry points stay correct, 17→8 reads); content-signature cache for
    bootstrap; move existence/freshness probes AFTER first paint (render
    optimistic, verify async, flip in place). — Counting calls is cheaper and more
    exact than profiling; deferring past paint beats caching for freshness probes.

31. **Batch granularity follows the dependency graph, not a parallelism bias — a
    genuinely linear build-up is correctly shipped as sequential batches of 1.** —
    2026-07-14 (gemini-batch-extraction): 7 tasks each built directly on the
    previous (prompt builder → JSON parser/aligner → batched Flash call → write-back
    refactor → per-doc escalation → orchestration → setting-gated wiring), so 7
    batches of 1 was the right shape, not artificial conservatism; 7/7 first-try. —
    Forcing parallel batches onto a linear chain manufactures ordering hazards and
    false "already-applied" states (lesson 14); parallelism is a property of task
    independence, and some objectives have none.

## C. Verification practices

8. **Give verifiers concrete adversarial traces, not "check it works".** —
   2026-07-12/13: real defects were caught only with specific scenarios (a notice
   wiped by an async refresh 1-3s later; a clobbered mixed-batch skip message;
   XSS-in-title-attribute) and truth tables (traffic-light boundaries 99/100/160
   of 200). — An unguided verifier confirms; a scenario-guided one falsifies.
9. **Regression-gate shared code paths byte-for-byte — and for a behavior-
   preserving refactor, prove it by RUNNING the git-HEAD copy and the working-tree
   copy through identical scenarios and asserting deepEqual outputs, not just a
   static diff.** — Seen 2× (2026-07-12/14). 2026-07-12: "the forced-bank prompt
   must be byte-identical vs git HEAD" turned a fuzzy don't-break-it wish into a
   diff check. 2026-07-14 (gemini-batch-extraction): T4's write-back refactor
   (markRowExtracted_/markRowError_) was proven by a fixture running BOTH copies and
   asserting the captured updateRow payloads are deepEqual — a true before/after
   regression proof, not a code read; T7 grep-proved Automation.gs/JavaScript.html
   byte-identical to HEAD. — Shared-path edits are where refactors silently change
   live behavior; a behavioral deepEqual is stronger than a textual diff when the
   code moved but the effect must not.
10. **Use a runtime harness when logic has arithmetic or must never throw — and
    exercise the DEGRADED modes, not just the happy path.** — 2026-07-13: the
    free/paid split needed a Node fixture asserting the math incl. the catch-block
    fallback; never-throw helpers (redactSecrets_) needed a PropertiesService stub
    that THROWS + null/undefined input (v2e-sec, done unprompted). — grep proves
    presence; only execution proves arithmetic, and never-throw is proven only by
    feeding the helper the failures it must swallow.
20. **Verify a claim against the MECHANISM that enforces it, not the surface.** —
    Absorbed 28. 2026-07-13 (file-pills): "pills are unpressable" was proven by
    tracing the delegated click listener's selectors and confirming none reach the
    element via closest() — inertness is the LISTENER's reach, not the markup.
    v2e-sec: the never-ship-Settings/ApiLog guard was proven by a fixture that
    EMPTIED DASHBOARD_EXCLUDED_TABS in place and showed those tabs still cannot
    ship; redaction at all 4 error sinks by a full-file diff showing every
    protected function fell OUTSIDE the changed hunks. — A passing snapshot says
    nothing about the invariant; test the enforcing mechanism (listener reach,
    mutated dependency) directly.

29. **A doc/JSDoc claim about a change a LATER task delivers is non-blocking, not
    a failure — check the dependency graph before failing; planners should word
    docs in the task that implements the referenced behavior.** — 2026-07-13
    (v2f): T3's spec had it write "getDashboardData deletes FieldCatalog", but the
    delete lived in T5 two batches later; the verifier correctly marked the claim
    non-blocking (T5 delivered it) instead of failing T3. — Batched execution
    makes early tasks reference not-yet-applied behavior; failing on it stalls a
    correct plan, and the durable fix is co-locating the doc with its code.
30. **A verifier's "non-blocking / accept" labels SEVERITY, not correctness — the
    orchestrator must independently re-scan every "problems" entry before shipping,
    and a cross-cutting collision (a bare CSS class / selector / global name shared
    by two unrelated features) is blocking-by-default.** — 2026-07-13
    (review-queue-polish): the verifier accepted a new unscoped
    `.confidence-low{color:var(--color-danger)}` as "on-intent, breaks nothing",
    but it silently recolored an unrelated edit-modal `<input class="confidence-low">`
    reusing the same class (Stylesheet.html:591-599); the orchestrator scoped it to
    `td.confidence-low` post-verification. — A single-feature verifier can't see the
    whole cascade, so scope new selectors and re-read every accepted "problem" for
    cross-feature blast radius before committing.

## D. Pipeline discipline

11. **Executors never run git commit, git push, or clasp push — the orchestrator
    owns deployment.** — 2026-07-12: an executor pushed to origin mid-pipeline;
    policy now hard-coded in .claude/agents/cma-executor.md. — Unverified work
    must not reach history or the live app; deployment is a checkpoint, not a side
    effect.
12. **The plan gate is where scope changes belong.** — 2026-07-12: adding
    History mid-review was handled by re-invoking the planner (4→8 tasks), not
    hand-editing the plan mid-execution. — Re-planning is cheap; plan/execution
    divergence is not.
13. **Surface every failure with its raw evidence attached.** — 2026-07-12:
    swallowed extraction errors ("Completed" executions, error text hidden in a
    sheet column) cost hours; an Error-pill + full-message tooltip turned later
    incidents into minutes. — A pipeline that hides ground truth converts one bug
    into a debugging session.
14. **On a resumed run, executors detect already-applied changes, re-verify the
    diff, and report done WITHOUT re-editing; on a schema change prefer a fresh
    reduced plan with dirty-tree notes over resumeFromRunId.** — Seen 3×
    (2026-07-13). v2d: resuming would re-run early verifiers against a tree
    already holding later tasks' edits (bogus-fail→retry→revert); a fresh plan
    instead gave the applied task an ORCHESTRATOR NOTE ("inspect diff; if correct
    do NOT re-edit; re-verify and report done") and every task a dirty-tree note
    ("uncommitted changes from earlier verified tasks are expected, not defects").
    No agent re-edited or reverted across 9 tasks. — Small precise tasks make
    "already applied" detectable; an explicit dirty-tree expectation prevents
    false verifier failures at scale.
21. **Executors/verifiers that read this file pre-apply its invariants
    unprompted.** — Seen 7×, all zero-nit (2026-07-13/14). gemini-batch-extraction
    (the highest-risk round yet — core extraction pipeline, live daily automation):
    a verifier re-derived byte-identical diffs of 3 prompt builders + 5 schema
    constants, ran git-HEAD vs working-tree copies through identical scenarios
    (lesson 9), fixtures covered 8 degraded JSON modes + 2 unprompted edge cases,
    and a verifier caught its OWN fixture bug (searched for raw quotes instead of
    JSON.stringify's backslash-escaped quotes) before returning a verdict — 7/7
    first-try, zero retries, and the orchestrator's post-verify scan (lesson 30)
    found nothing to fix. review-queue-polish: a
    verifier re-derived a byte-identical diff of an untouched function, asserted the
    caller's input array order was unchanged after the sort (proving .slice()-before-
    .sort()), fed an XSS-shaped row id through the REAL render fn and checked the
    escaped attribute output, and self-corrected an off-by-one in its own fixture
    before verdict — 6/6 first-try, zero retries. v2f: a verifier
    independently wrote a 23-assertion fixture proving the new additionalFields
    key gave IDENTICAL escalation verdicts with/without it, and executors shipped
    never-throw upsert + fail-open catalog + payload delete-guard unprompted —
    6/6 first-try, zero retries. file-pills: escapeHtml,
    function-body-only cross-file refs, stale-skew fallbacks, .js syntax checks —
    0 nits vs 1-2 on earlier same-sized features. dashboard-perf: per-id try/catch
    fail-open, escaped data attrs, no-arg back-compat — 3/3 first-try. v2e-sec:
    executors AND verifiers pre-applied degraded-mode fixtures and redaction/
    exclusion invariants — 6/6 first-try, zero retries. — The file only pays off
    if read; front-loading its invariants converts nit-catching into
    nit-prevention, across 6 runs and both roles.
24. **Launch/relaunch via a generated script, not inline tool-call args; embed
    the saved task-graph via JSON.stringify and syntax-check it inside the
    runtime's async wrapper.** — Absorbed 26. 2026-07-13 (v2d): a full 12-task
    plan (~30KB nested JSON) passed inline mangled the args string mid-payload
    ("JSON Parse error: Unterminated string", zero agents run); a Node script
    embedding the graph as a JSON.stringify'd const worked first try. Plain
    `node --check` rejects workflow scripts (top-level await/return legal only in
    the runtime wrapper), so wrap the body in `(async function(agent,parallel,
    pipeline,phase,log,args,budget,workflow){…})` in a scratch copy and check
    THAT. Seen 3× (2026-07-13): v2f and review-queue-polish both reused the
    embedded-const pattern (~15KB JSON) with zero args-mangling — it holds across
    plan sizes. — Interpolated deep-JSON escaping through a tool-call boundary isn't
    reliable at size; the pre-launch check must mirror the execution wrapper to
    prevent a zero-agent death.

## E. This repo's invariants

(Empty on a fresh project. The learner fills this section with the target
repo's hard, project-specific invariants — things that broke or nearly broke —
while sections A–D stay generalizable pipeline practice. When a section A–D
lesson in a project proves out repeatedly, consider upstreaming it to the
cma-run repo's docs/lessons-core.md.)
