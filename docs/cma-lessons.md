# CMA pipeline lessons

Maintained by the **cma-learner** stage after each execute run. Planner, executor
and verifier agents MUST read this file before starting work and apply it. Keep it
readable in one pass (~150 lines for A–D, ~40 for E): the learner merges/dedupes
rather than appending, adds "seen N×" to recurring lessons, and deletes lessons that
stop earning their space. Merged IDs are noted ("absorbed N") so old references
resolve. **2026-07-28: a compression pass across A–D plus 1 deletion paid for three
new lessons (40, 41, 42); A–D is back near budget** (gone: 2, 12, 13, 22, 26, 27, 28;
absorbed: 3→14, 31→5, 34→10).

Format per lesson: **practice — evidence — why it matters.**

## A. Structured output & agent prompts

1. **Schema-require only decision-critical fields; default the rest in code, but describe
   every field in the prompt.** — Seen 3× (2026-07-13): verifiers burned the 5-retry
   StructuredOutput cap omitting `problems`/`recommendation`; prompt-level enumeration
   reduced but did NOT eliminate it. Fix: EXEC_SCHEMA=[task_id, outcome],
   VERIFY_SCHEMA=[task_id, pass, evidence]; the script normalizes the rest (→[], accept,
   ''). Clean across six hardened runs (16 agents / 0 schema deaths, 2026-07-26). — Models
   omit fields they feel carry no information; removing those from the required set kills
   the failure mode instead of nagging against it.

## B. Task design (planning)

4. **One-file, one-concern tasks pass adversarial verification at very high rates —
   surface area is what predicts retries.** — Seen 5× (2026-07-12 v2c 13 tasks/1 failure;
   Drive-links 8/8; 2026-07-26 addressable-metadata 8/8 zero retries; 2026-07-27 one-file
   A5 and C1 first try while C2 — app_streamlit.py + cli.py — took the only retry AND both
   post-verify defects; 2026-07-28 single-module T7/T9/T11 landed clean while T10, the
   app_streamlit.py wiring task, needed a full restructure). — Small scopes make the
   verifier's job decidable and the diff reviewable.
5. **Batch order follows the DATA FLOW and the dependency graph, not a parallelism bias:
   bundle into one task anything an intermediate state would corrupt, and ship a genuinely
   linear build-up as sequential batches of 1.** — Absorbed 31. 2026-07-12 (review-routing
   had to precede the upload picker); 2026-07-13 (a HEADERS new-column change bundled with
   its client round-trip, since updateRow()'s full-row overwrite would blank the column
   between deploys); 2026-07-14 (7 tasks each building on the previous → 7 batches of 1,
   7/7 first-try). — "Each task leaves the app shippable" is a property of the ORDER;
   forcing parallel batches onto a linear chain manufactures ordering hazards and false
   "already-applied" states (lesson 14).
6. **State environment invariants in every task scope, not once globally.** — Seen 2×
   (2026-07-12/13): a cross-file constant ref passed `node --check` and an Opus verifier
   yet took down production (eval order); once planners baked eval-order /
   header-append-LAST / legacy-key invariants into every task scope, the highest-rated
   risks had zero incidents. — Executors and verifiers see one task at a time.
7. **Verify assumptions against the live system/source — never docs, search, or an
   unproven hypothesis; a disproven hypothesis is a no-op, not a task.** — Absorbed 27.
   2026-07-12: a searched-for model id 404'd at launch. 2026-07-13 (v2e-sec): the planner
   grepped and disproved its #1 vuln hypothesis, dropping a speculative task. — The code is
   the cheapest oracle for whether a fix is even needed. See lesson 40 for constants.
32. **When the orchestrator has already PROVEN something expensive, hand it to the plan as
    GROUND TRUTH plus an explicit "do not re-derive".** — 2026-07-26: the root cause was
    stated as fact ("bioio `.metadata` for LIF is an ElementTree.Element whose `str()` is a
    memory address") after validation against the real 1.02GB LIF; no executor re-derived
    any of it — 8/8 first-try. — Agents re-litigate anything phrased as a hypothesis;
    naming it as fact converts investigation budget into implementation budget.
33. **The planner must read the touched code ADVERSARIALLY and reconcile the objective
    against it — the objective is a hypothesis, not a spec.** — 2026-07-26: the planner
    caught two defects the human+orchestrator objective missed (an unconditional
    `channel_names` assignment; `_detect_format` returning GENERIC for plain `.tif` — E2/E4)
    and corrected an acceptance criterion that would have failed falsely (marker ORDER
    differs between container and series, so downstream tasks compare SETS). — Both defects
    would have shipped; acceptance criteria over joined collections must state
    set-vs-sequence semantics or they encode the wrong pass condition.
36. **A task's change breaks a DIFFERENT task's consumer, and file-scoped verification
    structurally cannot see it: name each producer→consumer pair in the plan and give the
    LAST task in the chain an explicit end-to-end check.** — Seen 2× (2026-07-26
    `rows_to_csv`; 2026-07-27 A5 seeded `sources['date']='mtime'` for EVERY file while C2's
    new gate treated a weak mtime date as equally blocking as a provisional LLM field,
    making "All clear!" unreachable for ordinary files). Both passed their own task's
    verification. — The interaction lives in neither file's tests. Corollary: a gate mixing
    signals of different strength must TIER them or the ordinary case never succeeds.

## C. Verification practices

8. **Give verifiers concrete adversarial traces, not "check it works".** — 2026-07-12/13:
   real defects surfaced only with specific scenarios (a notice wiped by an async refresh;
   XSS-in-title-attribute) and truth tables (99/100/160 of 200). — An unguided verifier
   confirms; a scenario-guided one falsifies.
9. **Regression-gate shared code paths byte-for-byte — and prove a behavior-preserving
   refactor by RUNNING the git-HEAD copy and the working-tree copy through identical
   scenarios, not just a static diff.** — Seen 3× (2026-07-12 forced-bank prompt;
   2026-07-14 write-back refactor proven by deepEqual on captured updateRow payloads;
   2026-07-26 byte-diff of the q.get-before-p.join block vs HEAD). — Shared-path edits are
   where refactors silently change live behavior.
10. **Use a runtime harness when logic has arithmetic or must never throw, exercise the
    DEGRADED modes, and if the only coverage sits behind a test marker excluded from the
    default run, NAME that marked run in the verification step.** — Absorbed 34.
    2026-07-13: the free/paid split needed a fixture asserting the catch-block fallback.
    2026-07-26: the `_detect_format` / ImageJ-Info tests are marked `integration` and
    deselected, so a real `.tif` regression would have passed CI green. — grep proves
    presence, execution proves arithmetic, and default-run green is not coverage.
20. **Prove the hazard is LIVE, then prove the guard is what stops it — verify the
    MECHANISM, not the surface, and rule out a VACUOUS pass before trusting an assertion.**
    — Absorbed 28. Seen 4× (2026-07-13 an exclusion guard proven by EMPTYING the list;
    2026-07-26 harvest monkeypatched to `[]` to show channel_names was DEMOTED not deleted,
    BioImage patched to raise for degraded mode, a 1.36M-char metadata_text pushed through
    the real spawn Queue; 2026-07-28 T11's new four-tier UI checked by a standalone debug
    script that PRINTED the real rendered expander contents before the assertions were
    believed). — A passing happy path says nothing about an invariant, and a UI assertion
    over an element that never rendered passes just as green as one that did.
29. **A flagged issue that a LATER task owns — or that the next planned task will REVERSE —
    is non-blocking; check the dependency graph and the upcoming plan before failing or
    fixing it, and write the deferral reason where the next agent reads it.** — Seen 2×
    (2026-07-13 v2f: T3's spec wrote a doc claim whose code lived in T5; 2026-07-27: C1's
    verifier flagged contradictory llm.py prompt wording that the next planned policy
    inverts — deferred with the reason in the commit message, see E9). — Fixing what the
    next task unfixes costs two reviews, but an UNRECORDED deferral looks like a miss.
30. **A verifier's "non-blocking / accept" labels SEVERITY, not correctness — the
    orchestrator's independent re-scan of EVERY problems entry is the only gate that
    catches SPEC bugs; cross-cutting collisions (a bare class/selector/global shared by two
    features) are blocking-by-default.** — Seen 3×, last two scans 100% on flagged items:
    2026-07-13 an accepted unscoped `.confidence-low` rule recolored an unrelated modal;
    2026-07-26 FOUR real defects that had all PASSED verification sat in accepted
    `problems` entries and THREE were spec-mandated; 2026-07-27 10 entries → 2 real live
    defects (36, 37), zero false positives. — A verifier correctly refuses to FAIL a task
    for obeying its spec, so it routes the defect to `problems`/accept; treat that list as
    a formality and spec bugs ship. Budget the scan as a mandatory stage.
37. **Verify a new blocking flag by asking "what user action CLEARS it?" and "how many
    ORDINARY inputs land in the blocked branch?" — not just "does it fire?"** —
    2026-07-27: editing a value in the Tag Files data_editor updated `s.fields` but never
    `s.sources`, so the flag survived the exact review it demanded (fix: retag
    `user_edited`). — A gate its own review action cannot satisfy is a deadlock, and every
    happy-path test reads it as "the guard works".
40. **Any plan-literal constant or test fixture that must MIRROR a real producer's output
    has to be GENERATED by running the producer — never re-derived from memory.** —
    2026-07-28: (a) T9's plan enumerated 9 literal key stems, but executing
    `normalize_key_stem('SeriesName')` returns `series` (trailing `Name` is stripped), not
    the planned `name`, so the shipped stem set would have silently excluded the most
    common per-image identity key in every format this tool reads; (b) T7's hand-written
    fake extraction result included a placeholder `UNKNOWN`, making the field look
    already-present and masking the absent-field branch the task existed to add. — Both
    artifacts encode the author's MODEL of the producer, not the producer, and both fail
    SILENTLY: wrong constants and wrong fixtures still go green. Strengthens lesson 7.
41. **A verification step that greps for a string's ABSENCE constrains the refactor's exact
    TOKENS, not just its behaviour — run the literal command before declaring done.** —
    2026-07-28: T10's first fix kept correct logic (`if not missing_fields and not
    experiment_description:`) but still contained the substring the spec required to be
    gone; it had to be restructured around a new boolean (`has_work_to_do`). — Executors
    optimise for semantics and read greps as proxies; here the grep IS the acceptance test,
    and finding that out after "done" costs a second edit-verify cycle.

## D. Pipeline discipline

11. **Executors never run git commit, git push or clasp push — the orchestrator owns
    deployment; before concluding an agent committed, check `git log --format=%an`.** —
    Seen 3× (2026-07-12 an executor pushed to origin mid-pipeline, now hard-coded in
    .claude/agents/cma-executor.md; 2026-07-26 the user committed 4× from GitHub Desktop
    DURING the run and it was read as a violation; 2026-07-28 T3–T6 arrived as
    human-authored commits from a separate agent tool the user ran in parallel). —
    Unverified work must not reach history; human-authored commits during a run are normal,
    so attribute before accusing.
14. **On a resumed run, executors detect already-applied changes, re-verify the diff and
    report done WITHOUT re-editing — but work applied by a DIFFERENT agent is unverified
    INPUT, not done work: re-run the FULL suite and read its diff adversarially before
    building on it.** — Absorbed 3. Seen 4×: 2026-07-13 resuming re-ran early verifiers
    against a tree holding later edits (bogus-fail→retry→revert), while a fresh plan with
    an ORCHESTRATOR NOTE ("inspect diff; if correct do NOT re-edit") kept 9 tasks clean;
    2026-07-28 T3–T6 were completed overnight by a separate Gemini-based agent tool on the
    same plan doc, and T6 shipped a real regression (multi-channel siblings dropped channel
    1, `GFP green`→`GFPGREEN`, see E11) caught ONLY by a pre-existing regression test when
    the full suite was re-run — no new test would have found it. — Prefer a fresh reduced
    plan over resumeFromRunId (a schema change invalidates every same-stage cache; a prompt
    edit replays free). Corollary: never run only the task's own tests.
21. **Executors/verifiers that read this file pre-apply its invariants unprompted.** — Seen
    9×, near-zero nits (2026-07-13/14/26/27; records 8/8, 7/7, 6/6, 6/6, 3/3). Highlights:
    a verifier ran HEAD vs working-tree copies through identical scenarios (lesson 9);
    another caught its OWN fixture bug before returning a verdict; 2026-07-26 a verifier
    wrote "flagged for the orchestrator's post-verify scan per lesson 30" and that hand-off
    caught a silent config-loss bug. — The file only pays off if read; front-loading its
    invariants converts nit-catching into nit-prevention.
24. **Launch/relaunch via a generated script, not inline tool-call args; embed the saved
    task graph via JSON.stringify and syntax-check it inside the runtime's async wrapper; do
    extraction and file writing in Node, not PowerShell.** — Absorbed 26. Seen 4×.
    2026-07-13 (v2d): a ~30KB plan passed inline mangled the args string mid-payload (zero
    agents run); plain `node --check` rejects workflow scripts, so check a scratch copy
    wrapped in `(async function(agent,parallel,pipeline,phase,log,args,budget,workflow){…})`.
    2026-07-26: a 34KB graph launched first try by scriptPath. — Interpolated deep-JSON
    escaping is not reliable at size, and the pre-launch check must mirror the wrapper.
35. **An executor forced to deviate must publish the deviation AS the delivered contract for
    downstream tasks, and the verifier must FALSIFY the literal spec before accepting it.** —
    2026-07-26: T1's literal spec reintroduced the exact bug the task existed to kill, so T1
    made `_shared_fields` a 3-tuple adding `contested` and said "treat the 3-tuple as this
    task's actual contract"; the verifier RAN the literal-spec path, confirmed the wrong
    magnification, and proved the deviation inert — T4 consumed the new shape without
    friction. — Silent deviations desync later tasks; a published, falsified one is a free
    plan amendment.
38. **What the gate stage SAVES must be the exact object the execute stage LOADS — persist
    full task objects (id/title/scope/verification/depends_on/parallel_safe), never a
    summary.** — 2026-07-27: the saved task-graph JSON held only id/title/files/depends_on/
    batch/concerns while cma-execute.js needs scope/verification text, so resuming cost a
    manual transcription pass. 2026-07-28 (same plan, fixed): T7–T11 were each re-read
    straight out of the task-graph JSON. — A lossy artifact still LOOKS resumable.
39. **Keep the run dashboard live and pointed at the CURRENT task graph for every
    CMA-adjacent piece of work, and tag tasks COMPLETE (first try) vs RESOLVED (needed a
    retry).** — Seen 2× (2026-07-27 A5/C1 COMPLETE vs C2 RESOLVED immediately identified
    C2 as the run's only oversized task, lesson 4; 2026-07-28 the user had to interject
    twice — "always update the cma run dashboard" and "you forgot to commit changes" — once
    execution left the scripted pipeline). — Collapsing both states to "done" throws away
    the cheapest read on task sizing, and the bookkeeping the SCRIPT used to do is exactly
    what a solo executor silently drops.
42. **When the adversarial verify stage is unavailable (spend limit, outage), do not "just
    execute": mechanically substitute a fixed local loop AND declare the substitution in the
    run report.** — 2026-07-28: the monthly spend limit hit during T2's Opus verify, so
    T7–T11 ran solo with the same loop each time — re-read the task's exact scope+
    verification from the task-graph JSON → implement → run the task's own tests → full
    `pytest -q` against a RISING pass-count floor → explicit `-m smoke` and `-m integration`
    runs → ruff+black → re-run affected tests → commit. Every defect (40, 41, 20, E11) was
    caught pre-commit; none needed a follow-up fix; final 299 passed / 4 skipped. — A
    missing verifier is a missing FALSIFIER, not a missing formality; a named, reproducible
    loop is a weaker but real verification path, and saying so lets the orchestrator and
    LEARN grade the work instead of treating it as unverified.
43. **Master decision rule: well-scoped work (an existing task graph with per-task scope +
    verification text, or an unambiguous ask) runs WARM-CONTEXT direct — implement it in the
    already-warm session rather than spinning up a separate orchestrator. Unclear-scope work
    gets the full scheme: Opus or Fable orchestrates/plans (neither fixed to the role), Sonnet
    executes. EITHER WAY, Opus (or Fable) verifies at the end — no exception, including
    warm-context runs with no separate orchestrator.** Haiku handles quick/short-context
    mechanical ops (git/GitHub housekeeping, simple file moves, rerunning a suite to confirm)
    given detailed, explicit instructions since Haiku has less headroom for ambiguity. Economize
    tokens both strategically (the assignment itself: expensive reasoning only where a wrong
    answer is costly) and tactically (warm-context-first, as above). — User directives,
    2026-07-29: first generalized warm-context-first from a scarce-budget carve-out (lesson 42)
    to a standing default, then refined same day to the two-path rule above after asking why a
    warm-context run's dashboard showed "Sonnet" as orchestrator — answer: warm-context
    execution IS Sonnet (or whichever model is running) orchestrating itself when scope is
    already clear, and that's fine PROVIDED Opus/Fable still verifies before the work is called
    done. Codified as the `cma-run` skill (installed both globally at `~/.claude/skills/cma-run`
    and per-project). Never let an expensive model run git/GitHub commands directly, and never
    let a warm-context run skip its end-of-run Opus/Fable verification pass.
44. **Lesson 43's mandatory end-of-run verification is not a formality even for warm-context
    work the same session already self-tested green.** — 2026-07-29: the planner-web P0 slice
    (8 tasks, 82 passing JS tests + 318 Python tests, self-verified live in a browser) still
    had an Opus adversarial pass find 9 concrete defects, several directly reachable from the
    already-passing test suite's own blind spots: a prototype-pollution hole in a path utility
    no test exercised with an adversarial key; a false-provenance permanent-lock bug where
    clearing a form field tagged the resulting emptiness STRONG, defeating lesson 37's "what
    user action clears it?" test on a path no test suite happened to exercise; a swallowed
    QuotaExceededError where the callback contract was honoured by the module but never wired
    by its caller (lesson 36, producer→consumer, again); and two instances of the SAME bug
    class recurring one syntax over (a `//`-comment false-positive fix in a build-time scanner
    left `/* */` block comments and regex literals with the identical vulnerability) — proving
    that fixing the reported case is not the same as fixing the class of bug. — A green test
    suite proves the tests that were written are satisfied, not that the RIGHT tests were
    written; an adversarial pass looking for what ISN'T tested is a different, complementary
    check that self-testing structurally cannot replace.
45. **A subagent's "completed" status is not evidence of anything on its own — check its
    actual deliverables before believing it, especially when the report text looks even
    slightly off.** — 2026-07-30: a dispatched executor's task-notification result was, verbatim,
    a nested `Agent({...})` tool-call it had apparently tried to make (to delegate its own
    required file-reading to a fresh sub-agent instead of reading the files itself) rather than
    a synthesized report; status still read "completed". A filesystem check (`ls` the task's
    listed deliverable files) found NONE of them existed — the dispatch had produced nothing.
    Separately the same session, two dispatches failed cleanly and legibly with "monthly spend
    limit" (not transient); per lesson 42 both were re-implemented directly in warm context
    with the substitution declared on the dashboard rather than silently treated as done. —
    Strengthens lesson 20 (verify the mechanism, not the surface) one level up the stack: it
    now applies to the verification step itself, not just to the task being verified. A
    malformed/garbled final result is itself a signal to distrust the status field next to it.
46. **A UI-wiring task's "avoid full re-render to preserve focus" fix and "avoid stale
    closures" are in tension, and only driving the real interaction catches the collision.**
    — 2026-07-30 (C1-6): a factor-editing row deliberately did NOT re-render its own inputs on
    every keystroke (an earlier fix in the same task, to stop each keystroke destroying focus)
    -- but that meant each field's input handler closed over the `factors` array snapshotted
    when the row was first drawn, not the store's current state. Editing the NAME then the
    LEVELS on the SAME row silently clobbered the name back to its pre-edit value, because the
    levels handler mapped over the stale snapshot. Every unit test passed (there are none for
    UI wiring -- see lesson 4, this is why it's the risky task) and a single-field smoke click
    would have missed it too; it only surfaced by editing TWO fields on ONE row in sequence,
    live, in a real build. Fix: read current store state fresh inside the handler, not the
    render-time closure. — Generalizes: whenever a "don't rebuild the DOM, preserve focus"
    optimization is applied to more than one sibling control on the same data row, each
    control's handler needs to independently re-fetch current state rather than share one
    snapshot -- the interaction to test is EDITING SIBLING FIELDS IN SEQUENCE, not each field
    in isolation.

47. **A source-transforming tool that parses line-by-line with anchored regexes treats the
    code formatter as an adversary -- and its output gate must assert the ABSENCE of the
    forbidden construct, not merely that the transform ran.** — 2026-07-30: `build_single_file.py`
    strips imports with `IMPORT_RE`, anchored `^...$` against ONE line. Adding a fourth name to
    an import list made Prettier wrap it across four lines; the wrapped form matched nothing,
    passed through verbatim, and the assembled *classic* script died at parse time on
    `Cannot use import statement outside a module` -- so the app rendered a blank page. Every
    existing gate still reported success (the build printed a byte count and a sha256), because
    the gates checked for `type="module"` and dynamic `import(` but never for a surviving STATIC
    import. Both halves were fixed: fold wrapped imports onto one logical line before matching,
    AND add an output gate that rejects any line-initial `import`. The gate was then
    falsification-tested by disabling the folding and confirming the build FAILS. — Generalizes:
    (a) any regex that parses real source line-by-line is one `prettier --write` away from
    silently not matching, so fold logical statements before matching; (b) a build gate that
    verifies "the step ran" is worthless next to one that verifies "the forbidden thing is not
    in the output"; (c) always falsification-test a new gate by reintroducing the bug -- a gate
    that has never been seen to fail is an assumption, not a check.

48. **"Verified live" against a dev server can be a lie the server tells you; only the shipped
    artifact counts.** — 2026-07-30: re-verifying the two-stage naming change, the dev server's
    ES-module registry served FRESH bytes to `fetch(url, {cache:'no-store'})` while `import`
    still returned STALE exports -- one module (`naming.js`) had updated and another
    (`design.js`) had not, so the page showed a half-new, half-old UI that matched neither the
    old nor the new code. Independently, opening the built file over `file://` in the preview
    pane rendered a non-executing static snapshot (`#app` empty, zero console errors), which
    looks exactly like a boot crash. The only trustworthy check was the BUILT single-file
    artifact served over http -- and that is precisely what exposed lesson 47's parse error.
    — Generalizes: when a live check disagrees with the source you just wrote, suspect the
    delivery path before the code; and verify the artifact you actually ship, not a
    module-server approximation of it. A brand-new DOM class name (here `.base-name-box`) is a
    cheap freshness oracle -- if it is absent, you are looking at stale code, not a bug.

49. **A single value rendered through two different code paths for two different UI columns
    will disagree the moment either path changes -- go looking for the second path, don't
    assume it matches.** — 2026-07-30: the arm-axis fix displayed a condition row's group label
    two ways: `buildGroupLabel`/`buildSampleId` (conditions.js, deliberately case-preserving,
    for the row's own "Group" column) and `finalizeFields`/`normalizeFields` (naming.js,
    uppercases per `uppercaseFields`, for the embedded filename). Both were individually
    correct and individually tested -- the defect only existed in the GAP between them: typing
    a lowercase arm ('ct') showed 'ct' in one column and 'CT' three columns over in the same
    row, with nothing to tell a reader they were the same value. Found only by an adversarial
    self-review pass specifically hunting for "two paths rendering one fact" rather than by
    re-running the tests that already passed. Fixed by routing the display column through the
    SAME casing authority (`normalizeFields`) the filename uses, rather than duplicating the
    uppercase policy. — Generalizes: when a plan splits one underlying value into "shown in the
    UI" and "embedded in an artifact," audit whether both renders share a formatting authority;
    if they don't, they are two independent implementations of the same rule and will drift the
    first time either one is edited without the other in mind.

50. **A field WRITTEN under one path and READ under another is a silent disconnect no test
    catches, because both halves pass their own tests.** — 2026-07-30, seen alongside lesson
    49 and the same underlying shape one level up: the interview collected modality as
    `acquisition.modality` (correct), while the filename template read
    `naming.fields.modality` (also correct) -- so answering the modality question left the
    Name builder rendering `UNKNOWN` for a fact the user had already stated. Same for
    `design.biologicalReplicates` vs `naming.fields.biorep`. Every unit test passed: the
    interview wrote where it said it would, the renderer read where it said it would, and
    nothing tested that the two paths were the SAME path. Found only by driving the real
    end-to-end flow (answer a question, walk to the consuming screen, look) -- the check no
    unit test performs. Fixed with a read-time fallback in one shared module rather than a
    write, so an explicit override still wins and provenance is untouched. — Generalizes: when
    a value is produced on one screen and consumed on another, the integration point is a
    NAMED PATH, and a path is exactly the kind of thing two correct components can disagree
    about forever. Grep the producer's path against the consumer's before trusting that data
    flows; and when a feature spans screens, walk it end-to-end at least once.

51. **A second, parallel agent pipeline built beside this one earns its keep only if
    something actually calls it — otherwise it is pure carrying cost.**
    `tools/antigravity-multi-agent/` (a Gemini-based plan/execute/verify/learn CLI, one-way
    wired to shell out into `tools/cma-dashboard/update.py`) was built as a competing
    implementation of the same plan-gate-verify-learn shape this file already describes, but
    no skill or doc ever pointed to it, it was never run, and it pulled in this repo's only
    third-party dependencies (`google-genai`, `pydantic`, `rich`, `python-dotenv`) into an
    otherwise dependency-free codebase. Retired unread, 2026-09-05. — Building a second
    orchestrator instead of extending the first one splits future lessons across two places
    that don't talk to each other (note its `ama_learn.py` re-derived its own "practice —
    evidence — why it matters" format and an `[ama-run]` signature convention, independently
    of this file) and leaves an unreviewed dependency list and unverified code sitting in the
    tree; if a second pipeline is ever worth trying, fold its findings into this file instead
    of letting it accumulate its own.

## E. This repo's invariants (microscopy-naming-assistant)

Proven 2026-07-26/27/28 against the real 1.02GB LIF unless noted. When an E lesson proves
out repeatedly and generally, consider upstreaming it to cma-run's docs/lessons-core.md.

E1. **bioio's `.metadata` for LIF is an `ElementTree.Element`; `str()` of it is a memory
    address, not XML.** Never stringify metadata — harvest addressable key paths
    (`metadata_keys.py` / `field_map.py`).
E2. **`BioImage(lif).channel_names` returns colour names (`['Green','Blue','Red']`) and
    `_is_placeholder_channel` does NOT filter colour names.** channel_names is a demoted
    fallback behind harvested keys; any edit there must be tested with harvest monkeypatched
    to `[]` to confirm the fallback is demoted, not deleted.
E3. **Multi-image containers leak across images two ways.** (a) Never run text-pattern
    extractors over the concatenated blob: `_extract_magnification` →
    `_extract_near_key('Objective')` picks up another series' objective; fields that
    disagree across images are `contested` and must be dropped, not merged. (b) Marker order
    is not stable (container follows series-0 detector order) — compare marker collections
    as SETS unless order is what's under test.
E4. **`_detect_format` returns GENERIC for plain `.tif`, and the Fiji/ImageJ Info-block tests
    are marked `integration` (deselected from the default run).** Anything touching format
    routing must run `pytest -m integration` explicitly (lesson 10).
E5. **CSV writers carry explicit column constants:** `rows_to_csv(rows, fieldnames=None)`
    with `REPORT_COLUMNS` / `SIDECAR_COLUMNS` at every call site — an empty row list
    otherwise emits a headerless file (reachable via `batch --strict --report`).
E6. **Streamlit runtime:** (a) a selectbox whose stored value is absent from the current
    options silently resets to the default, so per-file mapping saves must MERGE into the
    existing map; (b) `st.success()` immediately before `st.rerun()` is never rendered — set
    a session_state flag and render after the rerun.
E7. **Provenance UI must show the metadata KEY's own value and annotate when
    `sources[field] != 'metadata'`.** Pairing the final (LLM-filled or hand-edited) value
    with its original key manufactures false provenance.
E8. **`sources['date']='mtime'` is seeded for EVERY file (metadata.py), so provenance gates
    must TIER:** PROVISIONAL_SOURCE_TAGS (description/LLM-derived) BLOCK "All clear!";
    WEAK_DATE_SOURCE_TAGS (mtime) are `st.info` only. A value the user edits must be
    retagged `user_edited` (outside both sets) or its flag can never clear.
E9. **llm.py's prompt still calls the user description both "the weakest evidence here" and
    "authoritative context"** (left inconsistent 2026-07-27, commit 30dc8a7, pending the
    description-as-reviewable-proposal policy). 2026-07-28's `classify_description_proposals`
    (T7) landed that policy's classification half, so this wording is now DUE for
    reconciliation — the next planner should scope it rather than defer it again.
E10. **Streamlit AppTest (smoke suite):** `at.session_state` has NO `.get()` —
    SafeSessionState turns unknown attribute access into a key lookup and raises
    `AttributeError('get not found in session_state')`; use `'k' in at.session_state` /
    `at.session_state['k']`. `ElementList`s of different element types (`at.markdown` +
    `at.text`) do not concatenate with `+`; extract the `.value` lists first. (2026-07-28,
    first AppTest suite: 15 smoke tests. Tests must leave `profiles/` untouched.)
E11. **`FieldSource.key` accepts a TUPLE of sibling metadata keys, joined BEFORE the
    transform.** Multi-channel keys arrive as `ChannelName #0` / `#1`; offering them as
    separate candidates to the first-non-empty-wins resolver silently dropped channel 1, and
    the delimited-list transform mangled `GFP green` → `GFPGREEN` (fixed 2026-07-28, plus a
    word-boundary alias fallback in `_canonical_marker`). Register any new multi-valued key
    as siblings; match marker aliases on word boundaries.
