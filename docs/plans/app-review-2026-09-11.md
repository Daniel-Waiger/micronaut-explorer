# App review 2026-09-11 — μicronaut Planner (UX/UI + faulty claims)

Run: `app-review 2026-09-11` (CMA scheme). Orchestrator: Claude Fable 5.1 (warm context). Reviewers R1–R6 and adversarial verifiers V1–V6: Claude Opus, high effort. Target: branch `claude/eager-curie-8aqjwu` at `6524fed` (built `dist/index.html` sha256 `c04fe372…e18a84`, 1,070,286 B). Baselines: JS 879/879, Python 88/88.

**Severity policy** (stated by V2, applied uniformly): *blocking* = a false statement a user could act on to their detriment (privacy, data safety, validity) or real data loss; wrong counts and stale version strings are *major*. A verifier's severity supersedes the reviewer's. `[Unverified]` marks anything no agent could reproduce; it is reported, not asserted.

**What held up.** Privacy claims are true: `dist/index.html` contains no fetch/XHR/beacon/WebSocket/EventSource; across all routes and exports the app made exactly one request (its own HTML). The practice tab is isolated in both directions. Fluorophore data matches its reference file 1:1 (174 cited leaf spectra, 0 peak mismatches) and every 0.19.0 headline number (72→143 cited, 85 drafted, 26 corrected peaks) recomputes exactly. The build is byte-reproducible. 132 `checked_ok` items across the six reviews were sampled by verifiers (≥6 each); 3 were falsified and are included below.

## Counts (confirmed + verifier-new; refuted excluded)

| Area | blocking | major | minor | nit | total |
|---|---|---|---|---|---|
| Docs | 0 | 3 | 13 | 6 | 22 |
| In-app copy/privacy | 0 | 7 | 8 | 4 | 19 |
| Scientific data | 0 | 2 | 13 | 7 | 22 |
| UX primary flow | 1 | 6 | 10 | 7 | 24 |
| UX utilities/edges | 1 | 3 | 8 | 4 | 16 |
| UI wiring (code) | 3 | 5 | 4 | 2 | 14 |
| **All** | **5** | **26** | **56** | **30** | **117** |

Refuted by verifiers: 5 (appendix A). `[Unverified]`: 4.

## Root-cause families (one fix closes several findings)

1. **Autosave ring / displacement (data loss).** R5-01, V5-NEW-02: five "Start a blank study" actions fill the ring with protected slots; every later autosave is deleted by its own eviction pass while the shell says "Saved locally · just now". R6-04, R6-05, V6-NEW-01: restore and import call `store.replace` without flushing the pending autosave or protecting the displaced study, so an edit inside the 500 ms debounce is lost and five ordinary autosaves evict the displaced study, contradicting "Your current work remains available in Restore." → tasks B1, B2.
2. **Measurement page never refreshes sibling sections.** No store subscription; `main.js` re-renders only on assay identity change and `setPath` mutates in place. R6-01, R6-02, R6-08, R4-03, R6-07 (two editors for one replicate path). → tasks A4, A2a, A2b, A2c, A5.
3. **Spectral spillover check: two paths for one fact, and an invisible gate.** The panel block reads the free-text markers field; conformance reads `panel.channels` (R4-01, blocking). The emission flag is severity `error` → export blocked, only clearable by deleting a channel (V3-N1); Review says "Blocked: 1 issue(s)" without naming it (R4-04). User decision: keep the gate, make it visible and clearable. → A1, A2, A3, A2c, C2.
4. **Version / release-notes drift.** Hero says 0.19.0, footer self-heals to 0.20.0 over http, stays 0.19.0 over file://; the shipped build contains everything filed under [Unreleased] (R1-04, R2-02, R5-05, V1-N1, R2-06, V3-N4). User decision: cut 0.21.0. → V1, V2.
5. **Copy that states a wrong number or a wrong structure.** "seven-step walkthrough" (five steps; a unit test defends the wrong string), Guide lists seven nav steps (five), 13 vs 14 uncited entries, 16 nm attributed to the wrong dye. → D3, V1.
6. **Feedback handoff dead ends.** With clipboard denied (the default over file://) "Open GitHub issue" renders only Done; the download channel reports its own success as a failure. → D2.

## Findings

Sorted blocking → nit. *Fix* names the remediation task in `docs/plans/app-review-remediation-task-graph.json`; blank = follow-up only. Evidence paths under `<scratch>` are session-ephemeral (screenshots and repro tests were not committed); each finding also cites file:line or a command a reader can re-run.

### Blocking (5)

**R4-01** · UX primary flow · verdict CONFIRMED · fix A1, A3, A2c  
*Claim/expectation:* In-app (panel.js SPILLOVER FLAGS + B29/B30): the Fluorophores-and-spillover block is 'a qualitative check for spectral spillover across this measurement's fluorophores'. Expectation: it covers the fluorophores the user actually selected in Panel assembly.  
*Observed:* The spillover block reads ONLY the free-text Markers field; it ignores Panel assembly channels. With Panel assembly holding ALEXA488 (Em 519 nm) and FITC (Em 518 nm) -- 1 nm apart, far under the stated 25 nm threshold -- the block printed 'No spectral-proximity conflicts among 1 recognized fluorophore(s)' and later 'No recognized fluorophores with spectral data yet', while the Spectral view immediately below plotted both curves and the Review screen (which DOES read panel channels) flagged 'ALEXA488 and FITC: emission peaks 1 nm apart ... likely to co-register' and blocked every export. Two screens give contradi…  
*Evidence:* <scratch>/screens/r4/23-panel-spillover-missed-alexa488-fitc.png ; <scratch>/screens/r4/30-measurement-says-no-recognized-fluorophores.png ; <scratch>/screens/r4/29-review-flags-panel-spillover.png ; <scratch>/screens/r…

**R5-01** · UX utilities/edges · verdict CONFIRMED · fix B1  
*Claim/expectation:* web/src/ui/shell.js:56-65 shows "Saved locally · Ns ago" only when an autosave really landed, and settings.js:65 / appController.js promise "Your current work remains available in Restore." web/src/core/persist.js:114-137 saveExperiment() is documented to return null when the write failed.  
*Observed:* After six "Start a blank study" actions the recovery ring contains ONLY protected slots (ring=6, protectedSlots=6, unprotected=0). Every subsequent autosave is written and then IMMEDIATELY deleted by its own eviction pass: persist.js:125-131 loops `while (ids.length > RING_SIZE)` and evicts `ids.findIndex(id => !protectedIds.has(id))`, which once the ring is all-protected is the id it just pushed. saveExperiment still returns that (already-deleted) id, so the shell reports "Saved locally · just now" while nothing is stored. Driving it live: after the six blank-study rounds, typing R5-STARVED-EDIT-MUST-SURVIVE ga…  
*Evidence:* <scratch>/findings/r5/a4f.out (rounds[4] ring=5/protected=5/unprotected=0; rounds[5] ring=6/protected=6; final_unprotected_in_ring=0; save_indicator='Saved locally · just now'; marker_in_any_slot=null; after_reload_has_…

**R6-04** · UI wiring (code) · verdict CONFIRMED · fix B2  
*Claim/expectation:* shell.js:378 shows window.confirm('Restore this saved version? Your current work remains available in Restore.') before calling onRestoreRecovery.  
*Observed:* restoreRecoverySlot() calls store.replace(experiment) WITHOUT calling flushAutosave() and WITHOUT taking the protected snapshot that startBlankStudy()/openExampleStudy() both take. If the user restores within the 500 ms autosave debounce of their last edit, the pending timer fires AFTER the replace, reads store.get() fresh (now the restored study) and persists THAT. The edit is never written anywhere. This is the exact read-then-replace-across-the-debounce-window data loss that appController.js:399-414 documents at length as 'the data-loss bug this task exists to close' -- fixed in startBlankStudy, left unguarde…  
*Evidence:* web/src/core/appController.js:265-279 (no flushAutosave, no protected save) vs 415-431 (both present); web/src/ui/shell.js:378. Repro output: "BUG: the edit was never persisted anywhere. Saves recorded: [\"OLD-VERSION\"…

**R6-05** · UI wiring (code) · verdict CONFIRMED · fix B2  
*Claim/expectation:* Importing a project backup should not silently discard the study that was open, which the app promises is continuously autosaved ('Saved locally · Ns ago', ui/shell.js:56-65).  
*Observed:* Same class as R6-04, one call site over (lesson 44: fixing the reported case is not fixing the class). importProjectBackup() awaits persist.importFromFile then calls store.replace(withOrigin(imported,'imported')) with no flushAutosave() and no protected snapshot. The pending debounced save fires after the replace and persists the IMPORTED study; the pre-import edit is lost. The async await window makes this strictly wider than R6-04's.  
*Evidence:* web/src/core/appController.js:235-263. Repro output: "BUG: the pre-import edit was never persisted. Saves recorded: [\"IMPORTED\"]".

**V6-NEW-01** · UI wiring (code) · verdict VERIFIER-NEW · fix B2  
*Claim/expectation:* ui/shell.js:378 -- 'Restore this saved version? Your current work remains available in Restore.' -- and appController.js:242's 'It is now the study being autosaved' after an import.  
*Observed:* Both displace the open study WITHOUT persist.saveExperiment(..., {protectFromAutomaticEviction:true}), which startBlankStudy (:417-425) and openExampleStudy (:383-391) both take and both ABORT on if it fails. persist.js:111-149 allocates a new uuid slot per save, RING_SIZE=5, and evicts only unprotected slots, so five ordinary debounced autosaves in the restored/imported study -- seconds of typing -- delete every slot holding the displaced study. No 500 ms timing is involved, which is what makes this strictly stronger than R6-04/R6-05 as filed, and a flushAutosave()-only fix would not close it.  
*Evidence:* <scratch>/verify/v6/ringEviction.test.js (REAL core/persist.js over an injected Map storage + REAL appController): 'V6-NEW-01' fails -> ring holds ["after-4","after-3","after-2","after-1","after-0"]; 'V6-NEW-01b' (impor…

### Major (26)

**R1-01** · Docs · verdict CONFIRMED · fix V3, V4  
*Claim/expectation:* ROADMAP.md:132-140 'Every fluorophore's excitation/emission peak values are Claude-drafted ... not yet verified ... Flagged in-app too (a persistent banner on the Color panel step)'; README.md:71-72 'content is Claude-drafted and flagged unreviewed in web/kb/spectra.json'; TASKS.md:89-90 'it is Claude-drafted, still flagged unreviewed in-app'.  
*Observed:* 143 of 157 spectra.json entries are reviewStatus 'source-cited'; only 14 remain 'claude-drafted'. The in-app banner is not persistent-and-uniform either: web/src/ui/steps/panel.js:249-263 renders it only when knownEntries.length > 0 and picks one of three texts, the all-cited variant saying values 'match cited vendor or publication sources'. All three docs describe a state the shipped pack left at release 0.19.0.  
*Evidence:* python3 -c "import json,collections;s=json.load(open('web/kb/spectra.json'))['fluorophores'];print(collections.Counter(v.get('reviewStatus') for v in s.values()))" -> Counter({'source-cited': 143, 'claude-drafted': 14})…

**R1-04** · Docs · verdict CONFIRMED · fix V1  
*Claim/expectation:* web/release-notes/index.html:112 'Release 0.19.0 · 05 Sep 2026', :114 '0.19.0 is a spectral-data release', :192 footer fallback 'v0.19.0'; :190 comment 'Bump this by hand alongside web/src/core/version.js on every release'.  
*Observed:* The shipped version is 0.20.0 (web/src/core/version.js:5 APP_VERSION='0.20.0', rendered as 'Version 0.20.0' on Settings via web/src/ui/steps/settings.js:78), and web/release-notes/CHANGELOG.md:105 carries '## [0.20.0] - 2026-09-07' plus a large [Unreleased] section. The page contradicts itself at runtime: its own script (index.html:236-238, regex /^##\s+\[(?!Unreleased\])([^\]]+)\]/m) rewrites the footer to 'v0.20.0' from the fetched changelog while the hero above still announces 0.19.0. Under file:// the fetch fails and the stale v0.19.0 fallback is what the reader sees.  
*Evidence:* web/release-notes/index.html:112,114,192,236-238; web/src/core/version.js:5; web/src/ui/steps/settings.js:76-78; web/release-notes/CHANGELOG.md:105

**R2-01** · In-app copy/privacy · verdict CONFIRMED · fix E2, D3  
*Claim/expectation:* B6. The Guide step tells the user, in body text and in the tooltip of the button that launches it, that the example walkthrough is 'the optional seven-step example walkthrough' (web/src/ui/steps/guide.js:162, 168, 174, 262; file comment at :26 says 'seven-step aid ... not an eighth step').  
*Observed:* The walkthrough has FIVE steps. It is built by mapping engine/workflowProgress.js's PRIMARY_WORKFLOW (5 entries: home, describe, study, measurement, overview) in engine/guidedExample.js:209, and the panel's own live header reads 'Example walkthrough · Step 1 of 5'. The shipped reference screenshot docs/images/04-measurement-acquisition.png (published on the release-notes page and in manual/acquisition.html) even shows 'Step 4 of 5' in frame. workflowProgress.js:15 documents the restructure that removed the seven-step shape ('which read as a seven-part exam'); the guide copy was never updated with it.  
*Evidence:* web/src/ui/steps/guide.js:162,168,174,262 vs web/src/engine/workflowProgress.js:23-29 (PRIMARY_WORKFLOW, 5 frozen entries) and web/src/engine/guidedExample.js:209. LIVE on dist: Page.evaluate on http://127.0.0.1:8861/in…

**R2-02** · In-app copy/privacy · verdict CONFIRMED · fix V1  
*Claim/expectation:* C. The public release-notes landing page presents the current release. Hero eyebrow web/release-notes/index.html:112 'Release 0.19.0 · 05 Sep 2026'; hero lede :114 '0.19.0 is a spectral-data release...'; Highlights sub :127 'What 0.19.0 changes.'  
*Observed:* The shipped app is 0.20.0 (web/src/core/version.js:5 APP_VERSION='0.20.0'; Settings renders 'Version 0.20.0' live). The same release-notes page's own footer self-corrects at runtime from the fetched CHANGELOG and renders 'v0.20.0' (index.html:234-238). So a visitor sees 'Release 0.19.0 · 05 Sep 2026' at the top of the page and 'v0.20.0' at the bottom of the same page, and the string '0.20.0' appears nowhere in the hand-written half of index.html (grep -c '0\.20\.0' web/release-notes/index.html = 0). 0.20.0's whole headline feature (the standalone user manual) gets no hero, no highlight card and no link from this…  
*Evidence:* web/release-notes/index.html:112,114,127,192 vs web/src/core/version.js:5 and web/release-notes/CHANGELOG.md:105 ('## [0.20.0] - 2026-09-07'). LIVE on dist: document.querySelector('.eyebrow').textContent => 'Release 0.1…

**R2-03** · In-app copy/privacy · verdict CONFIRMED · fix D3  
*Claim/expectation:* B6. guide.js:262 'This list is a quick reference for what each step in the left nav means', followed by a definition list of SEVEN steps: Study map, Research brief, Measurements, Samples & design, Acquisition, Data plan, Review (guide.js:264-279).  
*Observed:* The left nav has FIVE primary steps. Live nav text on dist: Study map / Research brief / Measurements / <active measurement name> / Review, then the utilities (Guide, New study, Walkthrough, Settings, Feedback). 'Samples & design', 'Acquisition' and 'Data plan' are collapsible SECTIONS inside the single measurement route, not left-nav steps -- workflowProgress.js:16-18 says so explicitly ('the per-measurement work (samples & design, acquisition, data plan) lives inside whichever measurement you opened'). The same nav is described a third, different way by ui/featureWalkthrough.js:13 ('Three workspaces'), so the …  
*Evidence:* web/src/ui/steps/guide.js:261-279; web/src/engine/workflowProgress.js:14-29; web/src/ui/featureWalkthrough.js:13. LIVE on dist: Array.from(document.querySelectorAll('.shell-nav *')).filter(leaf) => ['Study map','Ready f…

**R2-04** · In-app copy/privacy · verdict CONFIRMED (symptom re-characterised) · fix V2  
*Claim/expectation:* web/release-notes/index.html's renderer drops the CHANGELOG's intro boilerplate (index.html:229 comment; the filter at :228 skips lines matching /documented here/Semantic Versioning/Reconstructed retroactively/i) so the changelog section starts at the first version heading.  
*Observed:* The rendered changelog opens with a mid-sentence fragment. The intro is six SOFT-WRAPPED lines; the filter matches only lines 3 and 4 of CHANGELOG.md, so lines 5-8 each render as their own <p> with no joining whitespace. Live text at the top of #cl-body: 'retroactively — see ROADMAP.md andTASKS.md for the day-to-day worklist this app was actuallybuilt against; the version numbers below are annotated git tags placed onthat existing history, not a scheme that was tracked from day one.' Note the run-together words 'andTASKS.md', 'actuallybuilt', 'onthat'. This is the first thing a visitor reads under 'Full changelo…  
*Evidence:* web/release-notes/CHANGELOG.md:3-8 (6 wrapped lines) vs web/release-notes/index.html:228 (per-line regex filter) and :224 (each surviving line becomes its own <p>). LIVE on dist: document.getElementById('cl-body').textC…

**R3-01** · Scientific data · verdict CONFIRMED · fix V1  
*Claim/expectation:* web/release-notes/index.html:131 headline '14 entries deliberately stay uncited', body 'Cy2, Cy7 and TRITC had no primary source worth citing; DCFDA's source gives a range, not a peak. Nine more are ambiguous names rather than bad numbers -- see below.'  
*Observed:* 3 + 1 + 9 = 13, not 14. The same repo's own web/release-notes/CHANGELOG.md:164 says 'The other ten are ambiguous names' and then names exactly ten (CFP, GFP, IRFP, mRuby, BFP, YFP, GCaMP, miRFP, Hoechst, ER-Tracker), giving 3 + 1 + 10 = 14, which matches spectra.json's 14 claude-drafted entries. The 'Nine' on the hand-written card is wrong and contradicts both its own headline and the changelog rendered directly below it on the same page.  
*Evidence:* web/release-notes/index.html:131; web/release-notes/CHANGELOG.md:160-170; r3_diff.out section (c): "KB claude-drafted top-level (14): ['BFP','CFP','CY2','CY7','DCFDA','ERTRACKER','GCAMP','GFP','HOECHST','IRFP','MIRFP','…

**R4-02** · UX primary flow · verdict CONFIRMED · fix A2b  
*Claim/expectation:* In-app Data plan text: 'Date, sample ID, and instrument label may be assigned later on acquisition day; until then previews use clearly labelled placeholders.'  
*Observed:* A measurement with no acquisition date renders the Unix epoch '1970-01-01' as a real-looking date in the registry row filename preview and in the STUDY-WIDE ISSUES warning ("all produce the identical base name '1970-01-01_UNKNOWN_UNKNOWN_UNKNOWN_UNKNOWN'"). Nothing on that surface labels it a placeholder; every other unset field uses the explicit 'UNKNOWN' token. Review's Decisions list does call it a placeholder, so the app knows -- the registry/preview surface does not say so.  
*Evidence:* <scratch>/screens/r4/39-copygroups-badge-freshness.png ; <scratch>/screens/r4/16-registry-filter-empty.png ; registry row dump: "Measurement 2 / ... / 1970-01-01_UNKNOWN_UNKNOWN_UNKNOWN_UNKNOWN"

**R4-03** · UX primary flow · verdict CONFIRMED · fix A4, A2a, A2b  
*Claim/expectation:* Committing a field on the Acquisition sub-section should update every derived preview and every other control bound to the same value on the same screen.  
*Observed:* After 'Update & reconfirm' on MARKERS (and MODALITY), the rest of the measurement page keeps the previous value until a route round-trip: the Samples & design 'EVERY FILE STARTS WITH' base name, all 12 CONDITION ROWS filename previews, and the Data plan section's own MARKERS input all stay stale. Result: two inputs both labelled 'Markers' visible on one screen with different values (acquisition='PI-SYTOX', data plan='DAPI-GFP'). A hash round-trip (#/study -> #/measurement) or reload fixes it.  
*Evidence:* <scratch>/screens/r4/26-stale-filename-preview.png ; <scratch>/screens/r4/27-two-markers-fields-disagree.png ; s57.py output: now=['DAPI-GFP','ALEXA488-FITC'] / after route round-trip=['DAPI-GFP','DAPI-GFP']

**R4-05** · UX primary flow · verdict CONFIRMED · fix C3  
*Claim/expectation:* At phone width every control must be reachable; content wider than the viewport belongs in an overflow-x:auto container.  
*Observed:* At 400px the Panel assembly channel rows are 406 px wide inside a 266 px card, and the ancestor <details class='microscopy-section'> has overflow-x: clip (scrollWidth 422 vs clientWidth 298). The target input, conjugation select, fluorophore select and filter inputs are cut off at the right edge with NO horizontal scroll -- they cannot be read or reached. Document-level overflow is 0 on all 8 routes, so this is invisible to a scrollWidth check.  
*Evidence:* <scratch>/screens/r4/41-400px-measurement-panel-overflow.png ; <scratch>/screens/r4/40-400px-measurement.png ; s85.py ancestor dump: DETAILS.microscopy-section ox=clip w=300 sw=422 cw=298 ; <scratch>/findings/r4/overflo…

**R4-06** · UX primary flow · verdict CONFIRMED · fix A2c  
*Claim/expectation:* panel.js:327 'Drag channel handles or use the arrow buttons to reorder' -- a keyboard user should be able to press the arrow button repeatedly.  
*Observed:* Activating 'Move channel down' re-renders the list and drops focus to <body>. document.activeElement after the click is BODY, so a keyboard user must tab from the start of the document again for every single position moved.  
*Evidence:* <scratch>/screens/r4/25-panel-reordered.png ; s50.py output: focus button 'Move channel down: FITC' -> True; after click activeElement = 'BODY#/sel=-/val='

**R5-02** · UX utilities/edges · verdict CONFIRMED · fix D2  
*Claim/expectation:* The Feedback page offers 'Open GitHub issue' as an action, and ui/feedbackHandoff.js's modal promises 'Sign in to GitHub if needed, then paste the copied package into the new issue.' TASKS.md:10-20 says 'Copy, Download and the GitHub issue path all work with no setup'.  
*Observed:* When the clipboard write fails (the documented, expected fallback path -- ui/clipboard.js, B44), showFeedbackHandoffModal gates the proceed button on `copied` (feedbackHandoff.js:103 `if (copied && config.proceedLabel)`), so the modal renders ONLY a 'Done' button: there is no way to reach GitHub at all. The message shown is also wrong for that channel -- 'Could not copy the feedback package ... Use Download feedback package instead' -- advice that has nothing to do with the action the user clicked. Clicking 'Open GitHub issue' is therefore a silent no-op dead end whenever clipboard access is denied (Firefox with…  
*Evidence:* denied-clipboard run: <scratch>/findings/r5/a3.out (github_modal_title='Could not copy the feedback package', github_modal_buttons=['Done'], window_open_urls=[]) + <scratch>/screens/r5/22-feedback-github-modal.png. gran…

**R5-03** · UX utilities/edges · verdict CONFIRMED · fix E2, D3  
*Claim/expectation:* In-app copy in four user-visible places calls the guided example a 'seven-step walkthrough': guide.js:262 body text and the Start/Resume/Restart button tooltips at guide.js:162,168,174 (B6 in the claims inventory).  
*Observed:* The walkthrough has FIVE steps. Driven end to end in the practice tab on the built artifact, the panel reads 'Example walkthrough · Step 1 of 5' ... 'Step 5 of 5' and its completion screen says 'You have reviewed 5 workflow steps.' The source of truth is engine/workflowProgress.js:23-29 PRIMARY_WORKFLOW (home, describe, study, measurement, overview = 5) and engine/guidedExample.js's five templateFor cases. web/tests/guideStep.test.js:201-207 asserts the stale 'seven-step' wording, so the test suite locks the wrong claim in.  
*Evidence:* <scratch>/findings/r5/a2.out (guide_button_title='Open the optional seven-step example walkthrough without changing this study.'; guide_seven_step_mentions; walkthrough_steps Step 1..5 of 5; walkthrough_end_state 'You h…

**R6-01** · UI wiring (code) · verdict CONFIRMED · fix A4, A2b, A2c  
*Claim/expectation:* panel.js:268 tells the user 'fill in the markers field on the Data plan step to see a color panel here'. On the composed Measurement page the Data plan IS the same page, three sections down.  
*Observed:* Typing markers in the Data plan section writes the store but never re-paints the Acquisition section. The colour panel, the spillover flags and the spectral view all keep showing the PREVIOUS markers -- including the literal sentence telling the user to do the thing they just did. Nothing subscribes to the store on this page: main.js:346-354 re-renders only when activeAssayId changes or `assays` gets a NEW array reference, and store.setPath mutates in place, so it never fires for a field edit.  
*Evidence:* web/src/ui/steps/naming.js:195-203 (markers input calls only the local update()); web/src/ui/steps/panel.js:191-765 (paint() is only re-entered from panel's OWN onCommit); web/src/main.js:346-354. Repro output: 'BUG: Ac…

**R6-02** · UI wiring (code) · verdict CONFIRMED · fix A4, A2a  
*Claim/expectation:* naming.js:150-155 states the read-only Group row is 'updated by update() below from the same planned rows the filename preview uses, so this line can never disagree with the {group} token actually embedded in the filenames.'  
*Observed:* True within naming.js, false on the page. Renaming a group in Samples & design writes design.groups but only re-renders design's own condition table. The Data plan's Group row and the whole planned-filename list keep the pre-edit group, so the filenames shown to the user are for groups that no longer exist. Same mechanism as R6-01 (lesson 49: two renders of one fact, no shared refresh authority).  
*Evidence:* web/src/ui/steps/design.js:143-160 (writeGroups -> renderConditions only); web/src/ui/steps/naming.js:404-418. Repro output: 'BUG: Data plan\'s Group row still reads ["CT"] after the group was renamed to TREATED on the …

**R6-07** · UI wiring (code) · verdict CONFIRMED · fix A5  
*Claim/expectation:* One fact should have one editor, or two editors that agree (lessons 49/50).  
*Observed:* design.biologicalReplicates and design.technicalReplicates each have TWO editors on the SAME Measurement page under DIFFERENT labels: design.js's number rows ('Biological / independent replicates', 'Technical replicates') and the microscopy-phase interview boxes in Acquisition ('Biological replicates', 'Technical replicates', questions.json ids biologicalReplicates/technicalReplicates). Answering the Acquisition box writes 9; the Samples & design box one section up still shows 3, indefinitely. Either editor can silently overwrite the other's value with no indication the two are the same field.  
*Evidence:* web/kb/questions.json -> biologicalReplicates [phase=microscopy] -> design.biologicalReplicates; web/src/ui/steps/design.js:229-262; web/src/ui/steps/panel.js:218-228. Repro output: 'BUG: Samples & design still shows "3…

**R6-08** · UI wiring (code) · verdict CONFIRMED · fix A4  
*Claim/expectation:* The three measurement status badges (definition / plan / export scopes) tell the user where this measurement stands. Lesson 37: what user action clears the flag?  
*Observed:* None available on the page. The badges are built once from options.workflowProgress at render time and nothing on the page re-renders the header (measurement.js's own comment acknowledges this as 'pre-existing behaviour'). A user can add groups, name markers and fill the plan and the badges stay frozen at ['Draft','Plan open','Not checked']; only navigating away and back updates them. The badges are the page's own progress feedback, so freezing them is the failure mode lesson 37 names.  
*Evidence:* web/src/ui/steps/measurement.js:19-24, 124-134; web/src/main.js:293-315. Repro output: 'BUG: header badges are frozen at ["Draft","Plan open","Not checked"] no matter what the user does on this page'.

**V1-N1** · Docs · verdict VERIFIER-NEW · fix V1  
*Claim/expectation:* web/release-notes/CHANGELOG.md:3 'All notable changes to the Micronaut Planner web app are documented here. This project uses Semantic Versioning'; web/src/ui/steps/settings.js:78 renders 'Version ${APP_VERSION}' = 0.20.0 to the user.  
*Observed:* The shipped build contains the ENTIRE [Unreleased] feature set, so the version the app reports is not the version it is. web/release-notes/CHANGELOG.md:10-104 files under [Unreleased]: the practice tab (index.html?demo=1, core/storageScope.js, ui/newTab.js), restoreWhenLabel(), tab-scoped clearAll, and the three-axis measurement status. All are in dist/index.html (grep -c: 'demo=1' 19, 'storageScope' 10, 'restoreWhenLabel' 3, 'Ready to acquire' 2, 'All export checks pass' 2) and dist/index.html:8612 is `const APP_VERSION = '0.20.0'`. The only guard, web/tests/version.test.js:18-21, compares APP_VERSION to the ne…  
*Evidence:* web/release-notes/CHANGELOG.md:10-104,105; web/src/core/version.js:5; dist/index.html:8612,23199; web/tests/version.test.js:18-21; grep counts above

**V2-NEW-01** · In-app copy/privacy · verdict VERIFIER-NEW · fix V2  
*Claim/expectation:* web/release-notes/index.html renders web/release-notes/CHANGELOG.md as the public 'Full changelog' -- 'Every version, newest first' (index.html:127) -- so a visitor can read what shipped.  
*Observed:* The renderer is line-oriented and the source markdown is soft-wrapped, so EVERY continuation line of EVERY multi-line bullet is emitted as its own <p> OUTSIDE the list, and closeList() tears the <ul> down each time. R2 found this on the 4-line intro only; it applies to the whole document. Measured live on dist: #cl-body contains 228 <p>, 68 <ul> and 79 <li> for a CHANGELOG.md holding exactly 79 bullet lines and 221 indented continuation lines. Visually the first release note renders as a one-line bullet ('Opening the shipped example study now opens it in a second browser tab --') followed by eight unindented orp…  
*Evidence:* web/release-notes/index.html:216-231 (render(): `md.split('\n').forEach(...)`, closeList() before the paragraph branch at :226, `out += '<p>' + inline(line) + '</p>'` at :228). LIVE on dist over http: {p:228, ul:68, li:…

**V2-NEW-02** · In-app copy/privacy · verdict VERIFIER-NEW · fix D2  
*Claim/expectation:* guide.js:381-383: '"Open GitHub issue" next to it copies that same report, then opens GitHub's new-issue page labeled feedback'. README.md:20-22: the app 'runs identically from file://, a local server, or GitHub Pages'.  
*Observed:* When the clipboard is unavailable, 'Open GitHub issue' does not open GitHub at all and never says so. showFeedbackHandoffModal gates the proceed button on `copied && config.proceedLabel` (feedbackHandoff.js:104), so a failed copy removes the only control that navigates to GitHub; the modal offers a single 'Done' button plus the channel-independent 'Use Download feedback package instead' text. This is the DEFAULT outcome over file://, the very mode clipboard.js:8-10 exists to work around and that README advertises as identical. The user's chosen action silently does nothing.  
*Evidence:* Reproduced on the BUILT artifact over file:// with no stubbing at all: opened file:///home/user/micronaut-explorer/dist/index.html#/feedback (app booted, 6 children under #app, zero console errors), clicked 'Open GitHub…

**V2-NEW-03** · In-app copy/privacy · verdict VERIFIER-NEW · fix B3  
*Claim/expectation:* core/appController.js:325 toast 'Cleared all locally stored data. Your open study is unaffected, and saving has resumed.'; web/manual/saving-privacy.html:107 'a second click within that window actually clears everything'.  
*Observed:* The sweep is not 'all' in EITHER scope. persist.js:251-262 collects only keys that startsWith(STORAGE_PREFIX) -- 'micronaut.v1.' or 'micronaut.demo.v1.'. Four app-owned key families sit outside that prefix and survive: micronaut[.demo].guidedProgress.v1 (core/guidedProgress.js:15), micronaut.theme (shell.js:32), micronaut.navCollapsed (shell.js:37) and micronaut.onboarding.{stage,experience,completed} (core/onboarding.js:20-22). The guided-progress residue is user-observable: after clearing, a reload still offers 'Continue walkthrough -- Reopen the walkthrough panel where you left it' instead of a fresh start. T…  
*Evidence:* LIVE on dist (<scratch>/verify/v2b/t9.py): started the example walkthrough, confirmed localStorage['micronaut.demo.guidedProgress.v1'] = '{"version":1,"status":"active","currentStepId":"home","completedStepIds":[],"comp…

**V3-N1** · Scientific data · verdict VERIFIER-NEW · fix A2, A3, A2c  
*Claim/expectation:* web/src/ui/steps/panel.js:233 and README.md:71 describe the Color panel as 'A qualitative check for spectral spillover ... excitation/emission peak proximity only, not a spectral-overlap integral', and spectra.json's overlapRules carry reviewStatus='claude-drafted'. A user would read that as advisory.  
*Observed:* It is not advisory: flagPanelOverlaps' emission flag is severity 'error', conformance.js:17 BLOCKING_SEVERITIES={'error','fatal'}, summarizeReadiness turns one such flag into readiness='blocked', report.pass=false, and overview.js:561-566 permitFinalExport() then REFUSES every final export ('Export blocked: N blocking issue(s) need correction first.'). Proven live in the BUILT artifact: dist served over http on :8813, a study seeded into micronaut.v1.slot.s1 whose markers field reads 'GFP,YFP' renders 'Blocked: 1 issue(s) need correction before final export.' with the line 'GFP and YFP: emission peaks 20 nm apar…  
*Evidence:* <scratch>/verify/v3/v3_conf.out (checkConformance over the real KB: 'GFP,YFP' -> pass=false readiness=blocked; 'GFP,mCherry' -> pass=true); <scratch>/verify/v3/live.json (same result in dist over http, with the control)…

**V4-N1** · UX primary flow · verdict VERIFIER-NEW · fix E1  
*Claim/expectation:* engine/naming.js sanitizeToken is described as producing 'a filesystem-safe variant'; the Design step shows each condition row's Group value and its planned filename side by side, and the app's own validators report every naming problem it detects.  
*Observed:* A group or factor level written in a non-Latin script is silently replaced by the literal token 'UNSPECIFIED' in every filename, because namingConfig.js:42 safeCharPattern is '[^A-Za-z0-9_-]+' and naming.js:49-52 falls back to 'UNSPECIFIED' when sanitising empties the string. Live in dist: with groups.levels[0]='\u5bf9\u7167\u7ec4' the condition row reads 'group=\u5bf9\u7167\u7ec4' and, three columns over in the SAME row, 'UNSPECIFIED-WT' and '..._UNSPECIFIED-WT_UNKNOWN_B01.tif'. Every such group collides with every other, and the only message the user gets is "factors: Multiple condition rows produce the identi…  
*Evidence:* <scratch>/verify/v4/screens/w31-unicode-unspecified.png and w30-unicode-groups.png; w30.py / w31.py transcripts (each group value with its rendered row and the issue list); web/src/engine/naming.js:49-52; web/src/engine…

**V4-N2** · UX primary flow · verdict VERIFIER-NEW · fix A2c  
*Claim/expectation:* panel.js:192-196 describes the boxes as 'fill a box and use its explicit confirmation action; leave it empty to skip'. A user who fills a box has stated a fact; leaving the page should not silently discard it, and Enter is the universal commit gesture in a one-line text field.  
*Observed:* Typed text that has not been Confirmed is discarded with no warning and no trace. Live, one page session: focus #field-interview-markers, type 'GFP' with real key events -> input.value==='GFP', state label still 'Unconfirmed'; press Enter -> nothing happens (store markers stays null, activeElement unchanged, no toast, no error); blur -> store still null; navigate #/study then back to #/measurement -> the input is empty and the value is gone. Nothing anywhere on the page says the typing is unsaved (/unsaved/uncommitted/not yet confirmed/i over document.body.innerText === false), and the only cue is the word 'Unco…  
*Evidence:* <scratch>/verify/v4/screens/w46-uncommitted-loss.png; w46.py transcript ('typed: GFP' / 'store after blur: null' / 'value after round-trip: ""'); w44.py (Enter dispatched as a real keyDown/keyUp with code Enter -> store…

**V5-NEW-01** · UX utilities/edges · verdict VERIFIER-NEW · fix D2  
*Claim/expectation:* feedbackHandoff.js CHANNELS.download promises the modal 'Feedback package downloaded and copied' / 'Attach the downloaded micronaut-feedback.txt file...'; B13/B44 say the copy-failure text is the fallback for a failed COPY.  
*Observed:* When the clipboard is denied, clicking 'Download feedback package' - which SUCCEEDS: micronaut-feedback.txt (2308 bytes, full study JSON) really lands in the download dir - opens a modal titled 'Could not copy the feedback package' whose only text is 'Your browser did not allow the package to be copied. Use Download feedback package instead, then attach or paste that file where you are sharing feedback.' It tells the user their action failed, never mentions the file that was written, and prescribes as the remedy the exact action just performed. Cause is the same `copied` gate as R5-02: handoffFeedback() runs dow…  
*Evidence:* <scratch>/verify/v5/t16_download.py output (modal_title='Could not copy the feedback package', modal_buttons=['Done'], dl_files=['micronaut-feedback.txt'], dl_len=2308, dl_has_study_json=true); screenshot <scratch>/veri…

**V6-NEW-03** · UI wiring (code) · verdict VERIFIER-NEW · fix B4  
*Claim/expectation:* Button 'Copy groups to measurements that have none' (study.js:176); design.js renders 'No groups yet -- add at least a control group to start.' for such a measurement. R6's checked_ok #3 asserts 'no slot can be permanently locked (lesson 37)'.  
*Observed:* store.js's clearing exception only treats '' / null / undefined as a clear; an empty ARRAY is not a clear. design.js:143-147 writes {levels: []} tagged 'user' (STRONG) when the user removes the last group row, so provenance.js:53-61 makes every later WEAK write refuse forever. study.js:195 writes 'kb-default' (WEAK), so the button can never fill that measurement, and reports it in the toast as one that 'already has custom groups' while the page says it has none. Lesson 37: the only action that clears it is typing the groups by hand -- the exact work the button exists to save. The same STRONG-empty lock applies t…  
*Evidence:* <scratch>/verify/v6/emptyGroupsLock.test.js (drives the REAL designStep Remove button then the REAL studyStep button): fails with 'assay two still has no groups after the copy. Toast said: ["Applied to 1 measurement(s);…

### Minor (56)

**R1-02** · Docs · verdict CONFIRMED · fix V4  
*Claim/expectation:* ROADMAP.md:35-36 'the real Romo-Rico et al. oregano study is the app's default'.  
*Observed:* A first run starts blank. ROADMAP.md:92-93 in the same file says 'a first run starts blank rather than inside the shipped example', TASKS.md:56 says the same, and web/src/main.js:65-71 and :102-114 make emptyExperiment the fallback factory outside the practice tab (IS_SANDBOX ? sandboxFallback : emptyExperiment).  
*Evidence:* ROADMAP.md:35; ROADMAP.md:92-93; TASKS.md:56; web/src/main.js:65-71,102-114

**R1-06** · Docs · verdict CONFIRMED · fix V3  
*Claim/expectation:* web/release-notes/index.html:129 'Each corrected value now carries the manufacturer page it came from, with the date it was read.' Reinforced in-app by panel.js:112 'Spectral value matches a cited vendor/publication source'.  
*Observed:* web/kb/spectra.json contains zero sourceUrl and zero retrievalDate fields -- every entry has only {excitationPeakNm, emissionPeakNm, emissionFwhmNm, reviewStatus, note?}. The URLs and dates live only in docs/references/planner-fluorophore-sources.json, which is NOT shipped: dist/index.html contains 0 occurrences of 'thermofisher' and 0 of 'fpbase'. A user of the published app or page can never reach the 'manufacturer page' the release notes say the value carries.  
*Evidence:* grep -c sourceUrl web/kb/spectra.json -> 0 ; grep -c retrievalDate web/kb/spectra.json -> 0 ; grep -c thermofisher dist/index.html -> 0 ; grep -c fpbase dist/index.html -> 0 ; web/release-notes/index.html:129

**R1-07** · Docs · verdict CONFIRMED · fix V3  
*Claim/expectation:* README.md:12-14 Classic 'was archived at tag classic-final and _archive/micronaut-classic-2026-08-18.tar.gz'; ROADMAP.md:157-158 'The code moved to _archive/micronaut-classic-2026-08-18.tar.gz (tag classic-final)'; ROADMAP.md:15-16 refers, present tense, to Micronaut Classic '(src/, app_streamlit.py)'.  
*Observed:* _archive/ does not exist in the working tree, is absent from git ls-tree -r HEAD, and no commit in the available history touches it. No .tar.gz exists anywhere under the repo. src/ and app_streamlit.py do not exist. The tag cannot be confirmed here: git tag -l returns nothing, but the clone is shallow (git rev-parse --is-shallow-repository -> true), so the tag claim is [Unverified] rather than disproved. The two file-path claims are disproved outright, and they are the ones a reader would act on.  
*Evidence:* ls -la _archive -> No such file or directory ; git ls-tree -r HEAD --name-only / grep -i archive -> (empty) ; find . -name '*.tar.gz' -> (empty) ; git log --oneline --all -- _archive -> (empty) ; ls src app_streamlit.py…

**R1-09** · Docs · verdict CONFIRMED · fix V4  
*Claim/expectation:* ROADMAP.md:29 'Modality advice: 16 rules across STED / confocal / widefield / light-sheet / SEM-TEM / Raman (web/kb/advisor.json)'.  
*Observed:* advisor.json holds 17 rules.  
*Evidence:* python3 -c "import json;print(len(json.load(open('web/kb/advisor.json'))['rules']))" -> 17 ; ROADMAP.md:29

**R1-10** · Docs · verdict CONFIRMED · fix V1  
*Claim/expectation:* web/release-notes/index.html:131 '14 entries deliberately stay uncited. Cy2, Cy7 and TRITC had no primary source worth citing; DCFDA's source gives a range, not a peak. Nine more are ambiguous names rather than bad numbers.'  
*Observed:* 3 + 1 + 9 = 13, not 14. The remainder after the four named is ten (BFP, CFP, ERTRACKER, GCAMP, GFP, HOECHST, IRFP, MIRFP, MRUBY, YFP). 'Nine more' should read 'Ten more'.  
*Evidence:* recomputed uncited set (14) minus {CY2, CY7, TRITC, DCFDA} = 10 ; web/release-notes/index.html:131

**R1-11** · Docs · verdict CONFIRMED · fix V1  
*Claim/expectation:* web/release-notes/index.html:114 '... 26 of them turned out to be wrong -- including Alexa Fluor 488 and DRAQ5, whose stored emission was off by 16 nm.'  
*Observed:* Alexa Fluor 488's stored emission moved 525 -> 519 nm, i.e. 6 nm, not 16. DRAQ5's moved 681 -> 697 nm, which is the 16 nm case. The page's own Highlights card at :129 states this correctly ('Alexa Fluor 488 was stored as 490/525 nm; Thermo's own table says 495/519. DRAQ5's emission was 16 nm low.'), so the hero lede contradicts the card 15 lines below it. The counts around it are exact: 85 drafted before, 26 changed, 72 -> 143 cited.  
*Evidence:* git show 0ae8524^:web/kb/spectra.json vs web/kb/spectra.json -> ALEXA488 (490,525)->(495,519); DRAQ5 (646,681)->(646,697); 26 entries changed; old source-cited count 72, old drafted 85

**R1-12** · Docs · verdict CONFIRMED · fix V3  
*Claim/expectation:* README.md:221-224 'CI runs the JS suite plus the Planner's own Python build-pipeline tests (tests/test_single_file_build.py, tests/test_kb_json_valid.py, tests/test_regex_conformance.py)'.  
*Observed:* .github/workflows/ci.yml runs those three plus tests/test_browser_cdp.py in the 'test' job, and a whole second 'e2e' job that hard-requires a browser and runs tests/test_e2e_flows.py. A contributor reading the README would not know a browser end-to-end suite gates their PR.  
*Evidence:* .github/workflows/ci.yml (test job: 'python -m pytest -q tests/test_single_file_build.py tests/test_kb_json_valid.py tests/test_regex_conformance.py tests/test_browser_cdp.py'; e2e job: 'python -m pytest -q tests/test_e…

**R1-13** · Docs · verdict CONFIRMED · fix V3  
*Claim/expectation:* README.md:193-208 presents a 'Repository layout' block. Every path it lists exists (verified individually).  
*Observed:* It omits four real, load-bearing directories: web/manual/ (the 11-chapter user manual shipped in 0.20.0 and deployed), web/release-notes/ (the public what's-new page), web/styles/, and the repo-root tests/ Python suite that CI actually gates on. A reader is told where everything lives and is not shown the two largest user-facing doc surfaces.  
*Evidence:* ls web -> index.html kb kb.dev.js manual package.json release-notes src styles tests ; ls tests -> conftest.py fixtures test_browser_cdp.py test_e2e_flows.py test_kb_json_valid.py test_regex_conformance.py test_single_f…

**R1-17** · Docs · verdict CONFIRMED · fix V1, V4  
*Claim/expectation:* CHANGELOG.md:5-6 'The format is based on Keep a Changelog ... and this project adheres to Semantic Versioning'; :9-10 'The entries below record what shipped before it was parked.'  
*Observed:* The file contains exactly one heading, '## [Unreleased]' (line 14), and 34 bullets under it. Everything the file says already shipped is filed as unreleased, which is the one thing Keep a Changelog's [Unreleased] section explicitly is not for, and no version has ever been cut in this file despite the SemVer claim.  
*Evidence:* grep -c '^## ' CHANGELOG.md -> 1 (only '## [Unreleased]' at line 14) ; grep -c '^- ' CHANGELOG.md -> 34 ; CHANGELOG.md:5-6,9-10

**R2-05** · In-app copy/privacy · verdict CONFIRMED · fix V2  
*Claim/expectation:* D. Links rendered inside the changelog should reach their targets. CHANGELOG.md carries three relative markdown links: [ROADMAP.md](../../ROADMAP.md), [TASKS.md](../../TASKS.md), [docs/plans/status-scopes.md](../../docs/plans/status-scopes.md).  
*Observed:* All three 404 on the deployed site. The renderer passes the raw relative href through safeHref() (index.html:200) and emits it with target=_blank; from /release-notes/index.html the browser resolves '../../ROADMAP.md' to the site root, i.e. /ROADMAP.md, /TASKS.md, /docs/plans/status-scopes.md. .github/workflows/deploy.yml:116-129 publishes ONLY index.html, release-notes/ and manual/ to the Pages repo, so none of those paths exist in production. The same page's own hand-written callout (index.html:166) links ROADMAP.md and TASKS.md via correct absolute github.com URLs -- the same fact rendered two ways, one right…  
*Evidence:* LIVE on dist: Array.from(document.querySelectorAll('#cl-body a')).map(a=>a.href) => ['http://127.0.0.1:8861/ROADMAP.md','http://127.0.0.1:8861/TASKS.md','http://127.0.0.1:8861/docs/plans/status-scopes.md']. curl -s -o /…

**R2-06** · In-app copy/privacy · verdict PARTIALLY REFUTED · fix V1  
*Claim/expectation:* A38/A39. web/release-notes/CHANGELOG.md:3 'All notable changes to the Micronaut Planner web app are documented here', with versions as annotated git tags; the release-notes page renders this file as the record of 'what's actually shipped, by version' (index.html:166).  
*Observed:* Features that are LIVE in the built artifact are filed under '## [Unreleased]' (CHANGELOG.md:10-104): the practice tab at index.html?demo=1 with core/storageScope.js and ui/newTab.js, the scope-limited 'Clear all stored data', restoreWhenLabel()'s '5m ago'/'Sep 11, 2026' save-time labels, and the three-status-axis vocabulary. I exercised all of these live in dist (practice-tab banner 'Practice tab — example data...' with 'Reset to the example'; scoped clearAll verified by key inspection). '## [0.20.0] - 2026-09-07', the newest released heading and the one APP_VERSION is guarded against, contains only the user ma…  
*Evidence:* web/release-notes/CHANGELOG.md:10-41 (practice tab, under [Unreleased]) and :105-133 (0.20.0 = manual only) vs web/src/core/version.js:5. LIVE on dist: http://127.0.0.1:8861/index.html?demo=1 renders the practice-tab ba…

**R2-07** · In-app copy/privacy · verdict CONFIRMED · fix V5  
*Claim/expectation:* web/manual/saving-privacy.html:84 'Open Settings (or the Utilities menu) and click Download project backup (Utilities calls it "Export project backup" — same action)'; :42 'use Download project backup whenever the work matters'.  
*Observed:* There is no 'Download project backup' button on Settings. The Settings control is labelled 'Project backup (.micronaut.json, importable)' (web/src/ui/steps/settings.js:62), which is what the in-app Guide correctly quotes (guide.js:361). 'Download project backup' exists only inside the guided-walkthrough panel (ui/walkthrough.js:294). A reader following the manual scans Settings for a button name that is not there. The manual's own alt text for the Settings screenshot (:75) names the buttons correctly, so the two halves of one chapter disagree.  
*Evidence:* web/manual/saving-privacy.html:42,84 vs web/src/ui/steps/settings.js:62 and web/src/ui/steps/guide.js:361. LIVE on dist (#/settings): buttons = ['Project backup (.micronaut.json, importable)','Import project backup','St…

**R2-08** · In-app copy/privacy · verdict CONFIRMED · fix V5  
*Claim/expectation:* tools/serve_dir.py:86-105 rewrites '/release-notes/images/<name>' to docs/images/<name> so the release-notes screenshots work when web/ is served unbuilt; the manual should behave the same way.  
*Observed:* The rewrite covers ONLY '/release-notes/images/'. Serving web/ locally, all ten manual chapter screenshots 404. Verified per-URL on http://127.0.0.1:8862: manual/images/{06-guide,01-study-map,02-research-brief,03-measurements-registry,08-measurement-design,11-overview-controls,04-measurement-acquisition,09-measurement-dataplan,05-overview-review,10-settings-storage}.png => 404 each, while release-notes/images/01-study-map.png => 200 from the same server. Degrades gracefully (each <figure class="shot"> has onerror -> .pending and a 'Snapshot pending' placeholder), and dist/ is unaffected (all 10 return 200), whic…  
*Evidence:* tools/serve_dir.py:86-105 (translate_path special-cases only '/release-notes/images/'). Crawler output (<scratch>/crawl.py against http://127.0.0.1:8862): 10 'RES web manual/*.html -> images/*.png = 404'; the same crawl…

**R2-09** · In-app copy/privacy · verdict CONFIRMED · fix V5  
*Claim/expectation:* web/release-notes/index.html:155 alt='Acquisition panel for a measurement, showing fluorophore channels seeded from the markers field, an unreviewed-badge spectral overlap chart, and the structured panel-assembly editor.'  
*Observed:* The image it describes shows SOURCE-CITED badges, not unreviewed ones. In docs/images/04-measurement-acquisition.png both fluorophore rows carry a 'source-cited' badge and the banner reads 'Spectral values below match cited vendor or publication sources...'. The current app agrees: live on dist the badges are ['source-cited','source-cited'] and the all-cited banner variant renders. The figcaption on the same <figure> ('each flagged as source-cited or unreviewed') is correct, so only the alt -- the text a screen-reader user gets instead of the picture -- is stale from before 0.19.0's citation sweep.  
*Evidence:* web/release-notes/index.html:155 vs :156 (figcaption) and the image itself (<scratch>/screens/r2/04-src.png). LIVE on dist (#/measurement, sections opened): Array.from(document.querySelectorAll('.panel-badge')).map(b=>b…

**R2-11** · In-app copy/privacy · verdict CONFIRMED · fix D2  
*Claim/expectation:* B44. On a clipboard failure the handoff modal says 'Your browser did not allow the package to be copied. Use Download feedback package instead, then attach or paste that file where you are sharing feedback.' (web/src/ui/feedbackHandoff.js:91-93).  
*Observed:* That sentence is shown for EVERY channel, including the download channel -- where the download has already happened. handoffFeedback (feedbackHandoff.js:130-135) runs download() first, then attempts the copy, then shows the modal; when the copy fails after a successful Download click the user is told to do the thing they just did, and is never told that micronaut-feedback.txt was in fact written. The advice is false for that branch and hides a successful outcome.  
*Evidence:* web/src/ui/feedbackHandoff.js:130-135 (download() before copyToClipboard) and :91-93 (channel-independent failure text); web/src/ui/steps/feedback.js:29-35 wires channel:'download' with the download callback.

**R3-02** · Scientific data · verdict CONFIRMED · fix —  
*Claim/expectation:* web/release-notes/index.html:132, card 'Some names mean more than one dye': 'The numbers are real, but the key doesn't say which variant it means.'  
*Observed:* The four keys that card is about (CFP, GFP, IRFP, mRuby) are exactly four of the 14 entries spectra.json marks reviewStatus='claude-drafted', which the app itself badges 'unreviewed' with the tooltip 'drafted by Claude from common published references' (web/src/ui/steps/panel.js:112-115). Telling users 'the numbers are real' about values the shipped app flags as unreviewed asserts a correctness the pack explicitly withholds -- and the very next card on the same page says a cited entry 'does not mean a microscopist checked it'. Three of the four (CFP, GFP, mRuby) have no reference record anywhere in the repo.  
*Evidence:* web/release-notes/index.html:132; web/kb/spectra.json CFP/GFP/IRFP/MRUBY reviewStatus='claude-drafted'; web/src/ui/steps/panel.js:112-115; r3_diff.out section (l); live: curl http://127.0.0.1:8731/release-notes/index.ht…

**R3-03** **[Unverified]** · Scientific data · verdict CONFIRMED · fix —  
*Claim/expectation:* [Unverified] web/release-notes/index.html:132 and CHANGELOG.md:164-166: 'CFP stores the values of ECFP; GFP stores EGFP's; IRFP stores iRFP713's; mRuby stores the original, not mRuby2.'  
*Observed:* Only the IRFP half is supportable from this repo: spectra.json IRFP = 690/713 and IRFP713 = 690/713, backed by a reference record (fpbase.org/protein/irfp713/). ECFP, EGFP, mRuby(1) and mRuby2 appear in NO file in this repo -- not in web/kb/spectra.json, not in docs/references/planner-fluorophore-sources.json -- so there is nothing in the repo against which CFP=434/477, GFP=488/507 or mRuby=558/605 can be checked. The page states these identities as established fact. (mRuby3 IS present, source-cited at 558/592; mRuby shares its excitation but not its emission, which is consistent with but does not prove the clai…  
*Evidence:* r3_diff.out section (l): 'CFP = (434, 477)   ECFP present in KB/refs: KB=False REF=False'; 'GFP = (488, 507)   EGFP present in KB/refs: KB=False REF=False'; 'MRUBY = (558, 605)   MRUBY2 present in KB/refs: KB=False REF=…

**R3-04** · Scientific data · verdict CONFIRMED · fix A1, A2c  
*Claim/expectation:* web/kb/spectra.json entries carry an authored `note` field (55 distinct strings) and web/src/engine/spectra.js:134 lists 'note' in KNOWN_FLUOROPHORE_KEYS, so a reader would expect the caveats to reach the user.  
*Observed:* normalizeFluorophoreEntry never returns `note` (web/src/engine/spectra.js:172-173 and 239-240 return only isFamily/reviewStatus/excitationPeakNm/emissionPeakNm/emissionFwhmNm), and no module under web/src reads a spectra entry's note. The caveats are stripped at load and consumed by nothing. The scientifically load-bearing ones are lost: DCFDA's 'Peaks are for the oxidized, fluorescent DCF product -- the non-fluorescent DCFH-DA/H2DCFDA loading form has no meaningful excitation/emission peak until intracellular oxidation converts it', and miRFP's 'Approximate; several named miRFP variants (miRFP670/703/720) diffe…  
*Evidence:* r3_engine.out (node harness running the real loadSpectraKb over the shipped pack): "DCFDA normalized: {\"isFamily\":false,\"reviewStatus\":\"claude-drafted\",\"excitationPeakNm\":495,\"emissionPeakNm\":529,\"emissionFwh…

**R3-05** · Scientific data · verdict CONFIRMED · fix V6  
*Claim/expectation:* docs/references/planner-fluorophore-sources.json is the provenance authority for the pack (web/release-notes/CHANGELOG.md:150-152: 'each corrected or confirmed value is recorded in docs/references/planner-fluorophore-sources.json with the URL it came from and the date it was read'), and declares editedBy='gpt-5.6-sol medium', retrievalDate='2026-08-13', collaborationTag='Codex:planner-web-fluorophore-expansion/T1'.  
*Observed:* Those three top-level fields are byte-identical to the 83-record version at f3579a1, but the file now holds 176 records: 93 of them carry retrievalDate '2026-09-05' and were added by commit 0ae8524 (author: Claude), plus a later edit 40066ea. The provenance file therefore misstates its own retrieval date and its own author for 93 of 176 records (53%) and is internally inconsistent with its own per-record retrievalDate values.  
*Evidence:* r3_diff.out section (k): "top-level retrievalDate = '2026-08-13', editedBy = 'gpt-5.6-sol medium', collaborationTag = 'Codex:planner-web-fluorophore-expansion/T1'"; "per-record retrievalDate histogram: {'2026-08-13': 83…

**R3-06** · Scientific data · verdict CONFIRMED · fix —  
*Claim/expectation:* web/kb/spectra.json overlapRules.note justifies emissionProximityNm=25 with 'typical bandpass emission filters are 20-40 nm wide and many dye/FP emission curves have a 40-60 nm FWHM, so peaks this close will substantially co-register', and adds 'Each fluorophore now also carries its own emissionFwhmNm ... so the explanatory plot's curve widths differ by fluorophore instead of sharing one shape'. engine/spectra.js:55…  
*Observed:* flagPanelOverlaps (web/src/engine/spectra.js:537-580) compares peak distance ONLY; emissionFwhmNm is never referenced in that function and reaches only engine/spectralView.js:119 (curve drawing). The per-fluorophore widths shipped in the pack range 25-80 nm, so the single 25 nm threshold is simultaneously too wide for the narrow class and too narrow for the broad class the note itself names. Proven live against the real engine: a pair of 25 nm-FWHM BODIPY-class dyes 26 nm apart produces NO flag (correct), and a pair of 80/75 nm-FWHM DNA-bound dyes (DRAQ5-class) also 26 nm apart produces NO emission flag (a false…  
*Evidence:* r3_engine.out: '-- narrow BODIPY-class pair (each emissionFwhmNm 25) 26 nm apart --' -> []; '-- broad DNA-dye pair (emissionFwhmNm 80 and 75) 26 nm apart --' -> only the excitation warning, no emission error; non-vacuit…

**R3-07** · Scientific data · verdict CONFIRMED · fix V6  
*Claim/expectation:* advisor.json rule confocal-sequential-scanning: title 'Overlapping emission spectra need sequential scanning, not simultaneous'; body 'If your markers' emission spectra overlap, scan sequentially, one laser line at a time.'  
*Observed:* Stated unconditionally, but line/frame-sequential scanning separates channels by EXCITATION, so it removes crosstalk only for dyes that are separable by excitation. The app's own second overlap rule identifies exactly the failing case -- engine/spectra.js:569 warns 'excitation peaks N nm apart (under the 20 nm proximity threshold) -- likely both excited by a single laser line' -- and the two are never cross-referenced: a panel can receive the emission error, be advised to scan sequentially, and simultaneously receive the excitation warning that says the single laser line will excite both. Reproduced: a synthetic…  
*Evidence:* web/kb/advisor.json rule id 'confocal-sequential-scanning' (r3_diff.out section (i)); web/src/engine/spectra.js:558 and :569; r3_engine.out '-- excitation-proximity remedy check: two dyes 0 nm apart in EXCITATION and 60…

**R3-10** · Scientific data · verdict CONFIRMED · fix V6  
*Claim/expectation:* The DCFDA entry: index.html:131 calls it 'DCFDA', CHANGELOG.md:162-163 calls it 'H2DCFDA' and says it stays drafted because 'H2DCFDA's source gives a range instead of a peak'.  
*Observed:* Three names for one key across two files and the data (spectra.json key = DCFDA), and two non-equivalent reasons for the same entry: the changelog says the source gives a range, while spectra.json's own note gives a different reason entirely -- 'Peaks are for the oxidized, fluorescent DCF product -- the non-fluorescent DCFH-DA/H2DCFDA loading form has no meaningful excitation/emission peak until intracellular oxidation converts it.' The stored 495/529 are the DCF product's peaks, which is a stronger and more useful caveat than 'the source gives a range', and it is the one the user never sees (see R3-04).  
*Evidence:* r3_diff.out section (c): 'drafted-but-not-named : [\'DCFDA\']' / 'named-but-not-drafted : [\'H2DCFDA\']'; section (l) DCFDA note; web/release-notes/CHANGELOG.md:162-163; web/release-notes/index.html:131

**R3-11** · Scientific data · verdict CONFIRMED · fix V1  
*Claim/expectation:* web/release-notes/CHANGELOG.md:137-145 enumerates the 26 corrected fluorophores: 'The two that mattered most: Alexa Fluor 488 ... and DRAQ5 ... Nine ATTO dyes were out by 1-6 nm, and Calcein, CFSE, FITC, Nile Red, propidium iodide, TMRE, TMRM, Texas Red, DyLight 650, SYTO 9 and SYTO 85 were each out by a few nm.'  
*Observed:* That enumeration accounts for 2 + 9 + 11 = 22 of the 26, and is written as if complete (no 'among others'). The four unlisted corrections are ALEXA405 (401->402 ex), ALEXA514 (517/542 -> 518/540), ALEXA532 (532/553 -> 531/554) and ALEXA647 (665 -> 668 em). Separately, Nile Red moved 552/636 -> 549/628, i.e. 8 nm in emission -- outside the '1-6 nm' band quoted for ATTO and a stretch for 'a few nm'.  
*Evidence:* r3_diff.out section (d), the 26-line delta table, and 'changed spectra that are neither ATTO nor named in the changelog: [\'ALEXA405\', \'ALEXA488\', \'ALEXA514\', \'ALEXA532\', \'ALEXA647\', \'DRAQ5\']' (ALEXA488 and D…

**R3-12** · Scientific data · verdict CONFIRMED · fix —  
*Claim/expectation:* web/release-notes/index.html:114 '143 of the pack's 157 entries now carry a source' and 'Every one of the 85 fluorophores that had only ever been drafted was checked'; index.html:130 '143 of 157 entries now cite a source'.  
*Observed:* Both counts are correct at the level of top-level JSON entries, but 8 of the 157 are family entries (BODIPY, CELLMASK, ERTRACKER, LIVEDEAD, LYSOTRACKER, MITOTRACKER, SYTO, SYTOX) holding 41 distinct named dyes between them. At the level a user actually picks a fluorophore, the pack ships 190 spectra, 174 cited and 16 drafted (the 14 leaf drafts plus ER-Tracker's three variants, two of which do have reference records). '157 entries' is defensible; calling them '85 fluorophores' / '157 entries' interchangeably with fluorophores understates the pack by 33 and makes '143 of 157' a different ratio from the 174/190 a …  
*Evidence:* r3_diff.out section 0: 'top-level fluorophore entries   : 157   (leaf 149, family 8)'; 'family variants: 41'; 'leaf-level spectra (join units) : 190'; section (b): 'claude-drafted spectra (16)'; section (a): '174 source…

**R3-13** · Scientific data · verdict CONFIRMED · fix —  
*Claim/expectation:* README.md:67-77 (claim A6) says the Color panel's knowledge-pack 'content is Claude-drafted and flagged unreviewed in web/kb/spectra.json'. web/src/ui/steps/overview.js:538 tells users 'every fact below comes from parameters you entered or from authored knowledge-pack content'.  
*Observed:* The flagging exists ONLY for spectra.json. advisor.json and controls.json carry no reviewStatus, no note, no source and no provenance field of any kind at either the pack or the rule level (union of rule fields: id, surfaces/kind, concept, title, body/why, when, priority), yet between them they ship 29 rules containing hard, unattributed numbers a user would reasonably read as sourced: 'STED resolution is roughly 30-80 nm', 'Light-sheet datasets are routinely hundreds of GB to TB per sample', 'about 2.3x the feature size', 'The default pinhole size of 1 Airy Unit', 'ATTO 647N and Abberior STAR dyes hold up; many…  
*Evidence:* r3_diff.out sections (i) and (j) -- the full dump of all 17 advisor rules and 12 controls rules shows no provenance field on any of them; README.md:67-77; web/src/ui/steps/overview.js:538

**R4-04** · UX primary flow · verdict CONFIRMED (core) / sub-claims REFUTED · fix A3, C2  
*Claim/expectation:* A blocked export should name what blocks it so the user can clear it (lesson 37: what user action clears the flag?).  
*Observed:* 'EXPORT CHECKS -- Blocked: 1 issue(s) need correction before final export.' never identifies the issue. The Decisions list above it held 19 entries (2 of which were the actual blockers) -- none marked blocking. Every export button stays enabled and, when clicked, only emits a transient live-region toast 'Export blocked: 1 blocking issue(s) need correction first.' which also names nothing. The count itself disagreed with the display: 2 panel entries were listed while the banner said '1 issue(s)'.  
*Evidence:* <scratch>/screens/r4/31-overview-export-blocked-unnamed.png ; <scratch>/screens/r4/45-overview-duplicate-decisions.png ; s73/s74 output: 5 export buttons -> 'Export blocked: 1 blocking issue(s) need correction first.'; …

**R4-07** · UX primary flow · verdict CONFIRMED (overstated) · fix A3, C2  
*Claim/expectation:* Each outstanding decision should identify the measurement it belongs to.  
*Observed:* With two undefined measurements, Review's decision list repeats six items verbatim, twice each, with no measurement name: 'Imaging modality -- modality is not answered yet...', 'Experiment type...', 'Markers...', 'Magnification...', 'Acquisition date...', 'Sample ID...'. 19 items total. A user cannot tell which measurement any of them refers to, and the duplication reads as a rendering bug.  
*Evidence:* <scratch>/screens/r4/45-overview-duplicate-decisions.png ; s99.py Counter output: 6 items each appearing x2, total items: 19

**R4-08** · UX primary flow · verdict CONFIRMED · fix —  
*Claim/expectation:* One measurement's state should read the same way wherever it is shown (task scope: status badges vs what the user actually did).  
*Observed:* At one moment, the same measurement 'Biofilm viability' is labelled: nav step 'In progress'; measurement pill 'Checks pass'; registry row three badges 'Checks pass' + 'Defined' + 'Ready to acquire'. Across the session the pill also used 'Draft', 'Blocked' and 'Needs a decision' while the nav used 'Not started', 'Ready for now' and 'Decision needed' -- three separate vocabularies for one state machine. Separately, answering study-map question 1 flipped the 'Measurements' nav step from 'Not started' to 'In progress' before the user had opened it.  
*Evidence:* <scratch>/screens/r4/34-status-vocabularies.png ; <scratch>/screens/r4/23-panel-spillover-missed-alexa488-fitc.png ; s87.py: nav 'Biofilm viabilityIn progress' vs registry row 'Checks pass / Defined / Ready to acquire'

**R4-09** · UX primary flow · verdict CONFIRMED · fix C2  
*Claim/expectation:* The UI consistently calls the unit a 'measurement'.  
*Observed:* Review's STUDY DIAGRAM labels the second one 'Assay 2' (while the pill, nav and registry all say 'Measurement 2'), and the exported File manifest (.csv) uses 'assay' as its first column header.  
*Evidence:* <scratch>/screens/r4/28-overview.png ; <scratch>/findings/r4/dl/92ab3c15-9a77-412e-94e9-0caf464fee1f (header: assay,modality,group,factors,...)

**R4-10** · UX primary flow · verdict CONFIRMED (counts understated) · fix A2c  
*Claim/expectation:* Every form control carries a programmatic label.  
*Observed:* Accessibility.getFullAXTree across 8 routes (home, describe, study, measurement, overview, guide, settings, feedback) found exactly ONE control with no accessible name: the panel channel's conjugation <select class='panel-row-text'> (options 'Direct-conjugate antibody' ...). A further 7 controls have no <label>/aria-label/aria-labelledby/title and are named only by their placeholder (which disappears once typed into): .question-other-input (describe), the panel Target input, four .duration-input minute fields in SCHEDULE, and the Feedback page's .describe-textarea. Also two buttons share the identical accessible…  
*Evidence:* <scratch>/findings/r4/axtree.json ; <scratch>/findings/r4/unlabeled.json ; <scratch>/screens/r4/18-measurement-top.png ; <scratch>/screens/r4/37-feedback.png

**R4-11** · UX primary flow · verdict CONFIRMED (count differs) · fix C3  
*Claim/expectation:* Text meets WCAG AA (4.5:1 normal, 3:1 large) in both themes.  
*Observed:* Computed from live getComputedStyle over all leaf text nodes on home/study/measurement/overview in BOTH themes: only 3 failures, all in light theme, all in the Spectral view chart -- the fluorophore-coloured labels ('ALEXA488', '519 nm', '519/30 nm') render at 1.53:1 against the white plot background (needs 4.5:1). Dark theme: zero failures on all four routes.  
*Evidence:* <scratch>/screens/r4/33-light-spectral-label-contrast.png ; <scratch>/findings/r4/contrast.json ; <scratch>/findings/r4/contrast.js

**R4-12** · UX primary flow · verdict CONFIRMED (count differs) · fix A2a  
*Claim/expectation:* The action the UI asks for ('add at least a control group to start') should not itself produce errors.  
*Observed:* Clicking 'Add group' twice (as the empty state instructs) immediately renders five red validation errors -- 'Group has an invalid level at position 0 (must be a non-empty value)' x2 plus three 'Multiple condition rows produce the identical name segment UNSPECIFIEDB0n -- they would overwrite each other' -- before the user has typed a single character.  
*Evidence:* <scratch>/screens/r4/19-design-empty-groups-errors.png ; s32.py dump of the GROUPS block

**R4-13** · UX primary flow · verdict CONFIRMED · fix —  
*Claim/expectation:* An unanswered single-choice field should show the neutral '-- choose --' option.  
*Observed:* On a brand-new measurement (acquisition.modality === '') the MODALITY <select> is pre-selected on 'Other...' (value __other__, selectedIndex 11) with an empty 'Type it in' box beside it, so an untouched field looks like a deliberate 'Other' answer. Same shape on the Research-brief READOUT select.  
*Evidence:* <scratch>/screens/r4/44-fresh-modality-select.png ; s98.py: modality select ['__other__','Other...'] while store modality === ''

**R4-14** · UX primary flow · verdict CONFIRMED · fix C2  
*Claim/expectation:* B44/clipboard.js: a copy failure should point the user at an equivalent way to get the SAME content.  
*Observed:* With navigator.clipboard.writeText forced to reject, 'Copy prompt for your own LLM' reports 'Could not copy automatically -- use Export study -> Study report data (.json, not importable) instead.' The JSON report is not the LLM prompt; the prompt text is then unreachable. (In a real user gesture the copy presumably succeeds; the fallback wording is the defect.)  
*Evidence:* <scratch>/screens/r4/32-copy-prompt-clipboard-denied.png ; s78.py status output

**R5-04** · UX utilities/edges · verdict CONFIRMED · fix D1  
*Claim/expectation:* main.js:267-270 warns 'Knowledge pack loaded with N issue(s) -- some markers or guidance may be unavailable.' so a user is told when guidance content is degraded.  
*Observed:* ui/shell.js:969-974 showToast writes into ONE `.shell-status` element with no queue, and main.js:273-283 fires the recovery toast immediately after the KB toast in the same synchronous block, so the KB warning is overwritten before a frame is painted. Reproduced live on a scratch copy of web/ with a deliberately broken KB (markers/advisor/controls corrupted in that copy's kb.dev.js only) plus a ring holding one unreadable autosave: the status element read ONLY 'Recovered your work -- skipped 1 unreadable autosave(s) and used an older one instead.' for its entire 3-second visible window (sampled every 0.25s from …  
*Evidence:* <scratch>/findings/r5/a8.out (toast_timeline: 23 samples 0.28s-5.8s, all the recovery text; kb_only_toast_timeline: 'Knowledge pack loaded with 4 issue(s)'); screenshots <scratch>/screens/r5/50-broken-kb-boot-toast.png …

**R5-05** · UX utilities/edges · verdict CONFIRMED · fix V1  
*Claim/expectation:* web/release-notes/index.html:192 hard-codes `<span id="footer-version">v0.19.0</span>` as the fallback used when the runtime fetch of ./CHANGELOG.md cannot run, and index.html:112 hard-codes the hero eyebrow 'Release 0.19.0 · 05 Sep 2026'. The app's own version is 0.20.0 (core/version.js; Settings renders 'Version 0.20.0').  
*Observed:* Served over http the footer self-heals to v0.20.0 (fetch of CHANGELOG.md succeeds), but opened the way the README advertises -- a single downloaded file under file:// -- the fetch is blocked by CORS and the page falls back to the STALE hard-coded v0.19.0 while the running app is 0.20.0. The hero eyebrow says 'Release 0.19.0 · 05 Sep 2026' in BOTH modes. So the same release-notes page shows two different version numbers depending on delivery mode, and neither matches Settings in the file:// case.  
*Evidence:* <scratch>/findings/r5/a5.out (rn_file_footer='Micronaut Planner · v0.19.0 ...' with the CORS console error quoted; rn_http_footer='... v0.20.0 ...'); <scratch>/findings/r5/a6b.out (dist_rn_hero_all[1]='Release 0.19.0 · …

**R5-06** · UX utilities/edges · verdict CONFIRMED · fix V2  
*Claim/expectation:* The release-notes page renders web/release-notes/CHANGELOG.md inline ('This is the one section that IS mechanical: it fetches ./CHANGELOG.md'), and that markdown links to ROADMAP.md, TASKS.md and docs/plans/status-scopes.md.  
*Observed:* Those markdown links are repo-relative (`../../ROADMAP.md`, `../../TASKS.md`, `../../docs/plans/status-scopes.md` at web/release-notes/CHANGELOG.md:5,6,78). Rendered inside /release-notes/index.html they resolve above the served root and 404 on the dist server, on the web server, and (same layout) on GitHub Pages, where the site root is web/. Three dead links on the rendered page.  
*Evidence:* browser-read hrefs: <scratch>/findings/r5/a6b.out dist_rn_nav_links includes {t:'ROADMAP.md',h:'../../ROADMAP.md'}, {t:'TASKS.md',h:'../../TASKS.md'}, {t:'docs/plans/status-scopes.md',h:'../../docs/plans/status-scopes.m…

**R5-07** · UX utilities/edges · verdict CONFIRMED · fix D3  
*Claim/expectation:* guide.js:390-396 links out to the 'full user manual', and the shell nav offers 'User manual' and 'Release notes'; README.md:20-22 claims the app 'runs identically from file://, a local server, or GitHub Pages'.  
*Observed:* Both links are directory hrefs (`manual/`, `release-notes/`). Under file:// a directory href does not resolve to index.html, so the reader lands on Chrome's raw file listing -- document.title 'Index of /home/user/micronaut-explorer/dist/manual/' -- instead of the manual. Over http the same href correctly serves the manual ('Micronaut Planner — User Manual'). The app itself boots and runs fine under file:// (localStorage works, no console errors), so this is specifically the documentation links, not the app.  
*Evidence:* literal outputs: file_manual_dir_title='Index of /home/user/micronaut-explorer/dist/manual/', http_manual_dir_title='Micronaut Planner — User Manual' (inline script run, quoted in <scratch>/findings/R5.md); anchors read…

**R5-08** · UX utilities/edges · verdict CONFIRMED · fix D2  
*Claim/expectation:* The handoff dialog sets role="dialog" and aria-modal="true" (feedbackHandoff.js:77-81), which asserts that content outside it is inert.  
*Observed:* There is no focus trap and nothing outside the dialog is inert or aria-hidden: pressing Tab from the dialog's focused 'Done' button walks straight out into the page behind it (six consecutive Tabs landed on body, the brand button, Utilities, the next-decision button, the measurement pill and '+ Add measurement' -- every one with closest('.feedback-handoff-dialog') === null). Escape and the backdrop click do close the dialog and focus is restored to the invoking button, so the rest of the dialog contract holds.  
*Evidence:* <scratch>/findings/r5/a3c.out tab_sequence_in_modal (all six entries end in '/inDialog=false'); <scratch>/screens/r5/25-copy-modal-focused.png; code web/src/ui/feedbackHandoff.js:71-135 (no focus trap, no inert/aria-hid…

**R5-09** · UX utilities/edges · verdict CONFIRMED · fix B2  
*Claim/expectation:* ui/shell.js:56-65's save indicator is the surface for local-save state ('Saving locally…', 'Saved locally · Ns ago', 'Changes are not saved locally.').  
*Observed:* A failed project import writes a raw JSON.parse message into BOTH the toast and the persistent save indicator: 'Could not import that project: Expected \',\' or \'}\' after property value in JSON at position 51 (line 1 column 52)'. That is engine-level text shown to a researcher, and it occupies the save-state surface, implying autosave is broken when it is not. It does clear correctly on the next edit (indicator returned to 'Saved locally · just now'), so lesson 37's 'what user action clears it?' is satisfied -- the issue is only the wording and the surface.  
*Evidence:* <scratch>/findings/r5/a4d.out (after_malformed_indicator / after_malformed_toast identical raw parser text; indicator_after_edit='Saved locally · just now'); screenshots <scratch>/screens/r5/37-import-malformed-indicato…

**R5-10** · UX utilities/edges · verdict CONFIRMED · fix D3  
*Claim/expectation:* guide.js:262 'This list is a quick reference for what each step in the left nav means', followed by seven definition terms: Study map, Research brief, Measurements, Samples & design, Acquisition, Data plan, Review.  
*Observed:* The left nav has five workflow entries (Study map, Research brief, Measurements, <the active measurement's name>, Review). 'Samples & design', 'Acquisition' and 'Data plan' are sections INSIDE the measurement page, not nav steps, and the nav entry the reader actually sees ('Bacterial viability' in the example) appears nowhere in the list. A reader following the sentence literally looks for three nav items that do not exist.  
*Evidence:* <scratch>/findings/r5/a2.out: guide_step_list (7 terms) vs nav_items ['Study map...','Research brief...','Measurements...','Bacterial viability...','Review...','Guide',...]; screenshot <scratch>/screens/r5/10-guide.png

**R6-06** · UI wiring (code) · verdict CONFIRMED · fix D1  
*Claim/expectation:* main.js:272-276 asserts the two boot toasts are ordered by consequence: 'shell.js's showToast is a single status element, not a queue -- the later call wins the visible window'.  
*Observed:* Not merely deprioritised: destroyed. Both calls happen in the same synchronous block, so the knowledge-pack warning ('some markers or guidance may be unavailable') is overwritten before a single frame is painted and is never observable at all. A user booting with both a damaged KB pack and an unreadable autosave is silently left with a degraded marker/advice set. This is a spec decision that ships a defect (lesson 30) -- the fix is a queue or a combined message, not reordering.  
*Evidence:* web/src/main.js:267-283; web/src/ui/shell.js:968-974 (status.textContent = message, single element). Repro renders the REAL renderShell and asserts the first message is absent from the DOM after the second call: 'BUG: t…

**R6-09** **[Unverified]** · UI wiring (code) · verdict CONFIRMED (upgraded from [Unverified] -- I wrote the missing repro) · fix B4  
*Claim/expectation:* 'Copy groups to measurements that have none' -- the title says it copies into every OTHER measurement.  
*Observed:* The loop iterates every assay INCLUDING the source, so the source is counted in `applied` or (when its own groups are user-tagged STRONG, the normal case) in `skipped`. A one-measurement study therefore reports 'Applied to 0 measurement(s); skipped 1 that already have custom groups.' for a button whose own tooltip promised to leave that measurement alone. [Unverified] only in the sense that no failing repro is attached -- the arithmetic is visible in the source and my LEAD-2 test observes the same loop.  
*Evidence:* web/src/ui/steps/study.js:180-205 (`for (const assay of assays)` with no `assay.id !== experiment.activeAssayId` filter; tooltip at :177-178).

**V1-N2** · Docs · verdict VERIFIER-NEW · fix V3  
*Claim/expectation:* README.md:82-83 'Review -- ... a conformance check (one pass/fail verdict composed from every validator the app already runs)'.  
*Observed:* The app itself denies this in the shipped build: web/src/ui/steps/overview.js:711 renders 'Export checks do not validate scientific validity, statistical power, ethics approval, biosafety, or instrument suitability, and they do not check your Study map decisions (research question, system, comparison mode, or experimental unit)'. The heading was deliberately renamed to 'Export checks' (overview.js:695) and web/release-notes/CHANGELOG.md:85-89 records that the previous 'All planner checks complete' wording was 'overstated' and replaced. README kept the overstated framing that the release it documents exists to re…  
*Evidence:* README.md:82-83; web/src/ui/steps/overview.js:695,711; web/release-notes/CHANGELOG.md:85-89

**V1-N3** · Docs · verdict VERIFIER-NEW · fix V3  
*Claim/expectation:* README.md:91-92 'Guide / walkthrough -- an in-app user guide, plus a deterministic guided walkthrough over the shipped example study; always in the step nav.'  
*Observed:* The walkthrough is not available where the Guide is. web/src/ui/steps/guide.js:132,150 gates the WHOLE walkthrough action set on isExampleOrigin(store.get().meta?.origin); a normal tab starts blank (main.js:113) and openExampleStudy refuses to run outside the practice tab, so in the reader's own tab the button is permanently 'Explain the workflow' plus an offer to open the practice tab (guide.js:190-196). home.js:96 states the real rule ('The walkthrough only runs on the finished example study -- open it in a separate practice tab'). README describes the pre-practice-tab behaviour.  
*Evidence:* README.md:91-92; web/src/ui/steps/guide.js:132,150-155,188-196; web/src/ui/steps/home.js:96; web/src/main.js:113

**V1-N4** · Docs · verdict VERIFIER-NEW · fix V4  
*Claim/expectation:* .github/ISSUE_TEMPLATE/config.yml:1-13, a comment explicitly dated 'Checked 2026-09-11', asserts 'knowledge-pack MISSING (knowledge_pack.yml)' and 'feedback MISSING ... quietly inert for as long as that button has existed', and tells the next editor to 'Create the missing two'. TASKS.md:31-36 likewise says the label path 'Requires the feedback label to exist in the repo' and supplies an un-run gh label create comman…  
*Observed:* Both labels exist in the live repo. GitHub API get_label: feedback -> color 0e8a16, description 'Opened from the planner in-app Feedback page'; knowledge-pack -> color 5319e7, description 'A correction to the shipped knowledge pack (markers, spectra, controls, vocabularies)'. The comment is false in the direction that causes work: it invites someone to re-create existing labels, and it is precisely what led R1 to file a major finding (R1-03) against a README statement that is true.  
*Evidence:* .github/ISSUE_TEMPLATE/config.yml:1-13; TASKS.md:31-36; mcp github get_label Daniel-Waiger/micronaut-explorer {feedback, knowledge-pack}

**V1-N5** · Docs · verdict VERIFIER-NEW · fix V4  
*Claim/expectation:* .github/workflows/deploy.yml:6-7 'The source repo (this one) stays private; only the compiled index.html is published.'  
*Observed:* Daniel-Waiger/micronaut-explorer is PUBLIC: the GitHub API reports "private": false, "visibility": "public", has_issues: true, has_discussions: true. The comment is the stale half of the contradiction R1 filed as R1-08 against the README. It matters because it is the stated rationale for the whole two-repo deploy design and for treating source-repo links as internal.  
*Evidence:* .github/workflows/deploy.yml:4-7; GitHub API search_repositories repo:Daniel-Waiger/micronaut-explorer -> private:false, visibility:public

**V2-NEW-04** · In-app copy/privacy · verdict VERIFIER-NEW · fix E1  
*Claim/expectation:* web/src/engine/validation.js:55-62 docstring: 'This must be checked against the FULL path (directory + filename), not just the filename, since it is the combined length that Win32 rejects'; the emitted message ends "Full path: '<pathStr>'".  
*Observed:* No caller honours that contract. All three live call sites pass a bare filename -- ui/steps/naming.js:469 (`name` from currentFilenames()), ui/steps/design.js:505 (`entry.filename`), engine/conformance.js:107 (`entry.filename`). Consequences: (a) the MAX_PATH warning the function exists to raise can only fire when the FILENAME alone exceeds 260 characters, so the realistic case (a 60-character planned name inside a deep network share) is never detected; (b) when it does fire it labels a bare filename 'Full path:'. The only coverage (web/tests/validation.test.js:127-152) feeds it synthetic full paths, exercising …  
*Evidence:* `grep -rn validateTargetPath web/src/` -> the three call sites above plus the definition. Executed: node -e "import('./web/src/engine/validation.js').then(m=>console.log(m.validateTargetPath('A'.repeat(265)+'.tif')[0].m…

**V2-NEW-05** · In-app copy/privacy · verdict VERIFIER-NEW · fix D3  
*Claim/expectation:* A green `node --test web/tests/*.test.js` is the repo's gate on Guide copy (README.md:182-187).  
*Observed:* web/tests/guideStep.test.js:201, 204 and 207 assert the wrong number as a hard requirement: assert.match(start.title, /open the optional seven-step example walkthrough/i) plus the resume/restart equivalents. The walkthrough has five steps (R2-01), so the suite actively defends the false string: correcting the Guide copy turns three tests red, and the existence of these assertions is plausibly why 'seven-step' survived the five-step restructure documented at workflowProgress.js:14-18. Lesson-44 shape: a passing suite proves the tests that were written, not the right ones.  
*Evidence:* web/tests/guideStep.test.js:199-215 read verbatim; `grep -rn seven web/tests/` returns exactly those three lines.

**V3-N2** · Scientific data · verdict VERIFIER-NEW · fix V6  
*Claim/expectation:* web/kb/questions.json's 'modality' question offers 10 options and its own `why` says the answer exists so pitfalls can be flagged; README.md:67-69 advertises modality-specific advice from web/kb/advisor.json.  
*Observed:* 3 of the 10 offered options match ZERO advisor rules: 'spinning-disk confocal', 'two-photon' and 'TIRF' (selectAdvice returns [] on all four surfaces). 'spinning-disk confocal' is the sharpest case -- the predicate is exact string match {'in':['acquisition.modality',['confocal']]}, so choosing it silently loses all three confocal rules (pinhole, Nyquist, sequential scanning), including the only rule that surfaces on the Color panel -- and advisor.json's own widefield-thick-sample-blur rule recommends 'switch to confocal or spinning-disk' as the remedy.  
*Evidence:* <scratch>/verify/v3/v3_advisor.out: 'spinning-disk confocal total 0', 'two-photon total 0', 'TIRF total 0' vs 'confocal total 3'. web/kb/questions.json modality.options; web/src/engine/advisor.js:218-229 (selectAdvice) …

**V3-N3** · Scientific data · verdict VERIFIER-NEW · fix V6  
*Claim/expectation:* Task R3 item (e): internal consistency of the overlapRules thresholds against their own note. The note justifies excitationProximityNm by 'standard laser lines are spaced 40-100+ nm apart specifically so one line excites one dye class', and emissionProximityNm by 'typical bandpass emission filters are 20-40 nm wide'.  
*Observed:* Both thresholds sit BELOW the bottom of the band their own rationale names, so the note's reasoning implies a wider flag than the data ships. excitationProximityNm=20 is half the note's own minimum 40 nm laser spacing: 1607 of 17955 shipped leaf pairs (9.0%) have excitation peaks in [20,40) nm -- inside one laser line by the note's own argument, never warned. emissionProximityNm=25 against '20-40 nm wide' filters leaves 1338 pairs in [25,40) nm unflagged. R3 checked the note's FWHM class examples and its 40-60 nm band but never tested the thresholds against the note's stated rationale, which is what the task ask…  
*Evidence:* <scratch>/verify/v3/v3_overlap.out: 'pairs total 17955; excitation gap <20 (flagged) 2222; gap in [20,40) UNFLAGGED ... 1607 (9.0%)'; 'emission gap in [25,40) UNFLAGGED but inside the note's own 20-40 nm filter width: 1…

**V3-N4** · Scientific data · verdict VERIFIER-NEW · fix V1  
*Claim/expectation:* README.md:20-22 claims the app 'runs identically from file://, a local server, or GitHub Pages' with no network; web/release-notes/index.html:114 claims 'the 14 that do not are named below' and :131 ends '-- see below'.  
*Observed:* Over file:// the browser blocks fetch('./CHANGELOG.md'), the changelog region collapses to the 53-character fallback “Couldn’t load the changelog here — read it on GitHub.”, and only 8 of the 14 uncited entries are named anywhere on the page (missing: BFP, ER-Tracker, GCaMP, Hoechst, miRFP, YFP). The '-- see below' pointer dead-ends, and the only remaining route to the promised content is an external github.com link -- a network round-trip on the deployment mode the README sells as offline. The footer also falls back to its hand-maintained 'v0.19.0' while web/src/core/version.js:5 is APP_VERSION='0.20.0'. Over h…  
*Evidence:* <scratch>/verify/v3/relnotes.json, real Chromium via tools/browser_cdp.py with no file-access flags: {'label':'http dist','cl_body_len':20277,'count_named':14,'footer_version':'v0.20.0'} vs {'label':'file:// dist','cl_b…

**V4-N3** · UX primary flow · verdict VERIFIER-NEW · fix A2c  
*Claim/expectation:* Sibling controls on the same row should be equally announceable; panel.js:602 already proves the pattern by labelling the move buttons 'Move channel down: ALEXA488'.  
*Observed:* The channel REMOVE button next to them (panel.js:610-615) sets only textContent '\u00d7' and title='Remove this channel', so its computed accessible name is '\u00d7' -- identical for every channel, with nothing saying which fluorophore it deletes, on a destructive action that has no confirmation. Live AX dump: {role:'button', name:'\u00d7'}. The four SCHEDULE duration spinbuttons resolve to the accessible name '0' (their placeholder) with aria-label null and no associated <label>; the visible 'h' / 'min' text is a sibling span outside the label association.  
*Evidence:* <scratch>/verify/v4/axtree_v4.json (6 controls with empty or <=2-char accessible names); w37.py output; w38.py (duration inputs: aria-label null, closest('label') NOLABEL, placeholder '0'); w07.py (['\u00d7','Remove thi…

**V5-NEW-02** · UX utilities/edges · verdict VERIFIER-NEW · fix B1  
*Claim/expectation:* persist.js:32 RING_SIZE=5 and the comment at :127-129 say protected snapshots 'deliberately' extend the list beyond five - implying a bounded exception.  
*Observed:* The exception has no bound at all. Every 'Start a blank study' adds one permanently protected slot and nothing ever removes it, so the ring grows monotonically: ring length 6 after six clicks, with zero unprotected entries (t01_ring.py). Each snapshot is a full study document (1.3 KB for an empty study, 7 KB for the example, arbitrarily large for a real one), so repeatedly starting blank studies is an unbounded localStorage growth path that ends in the quota-full state - and, per R5-01, every ordinary autosave in between is silently discarded on the way there. The only pruning is the user manually deleting Resto…  
*Evidence:* <scratch>/verify/v5/t01_ring.py (rounds[5] ring=6 prot=6 unprot=0, slots=6) and t12_starve_escape.py (ring stays 5/5 protected, then 4/4 after one manual delete); code web/src/core/persist.js:122-131 + appController.js:…

**V6-NEW-02** · UI wiring (code) · verdict VERIFIER-NEW · fix B4  
*Claim/expectation:* study.js:177-178 tooltip: "Copies the active measurement's groups into every OTHER measurement that has not defined its own".  
*Observed:* core/assay.js:279-290 groupSeedLevels PREFERS the active measurement but falls back to the first measurement that has any groups. With the active measurement having none, the button silently copies a DIFFERENT measurement's groups (including into the active one), which the tooltip says it does not do.  
*Evidence:* <scratch>/verify/v6/copyGroups.test.js test 'V6-NEW-02' fails: the active (groupless) measurement ends up with ['FROM-OTHER-MEASUREMENT'] after a click whose tooltip named it as the source.

**V6-NEW-04** · UI wiring (code) · verdict VERIFIER-NEW · fix D1  
*Claim/expectation:* The header's save indicator reads 'Saved locally - just now' / '- Ns ago' / '- Nm ago' (shell.js:55-65), i.e. it claims to say HOW LONG AGO the study was saved.  
*Observed:* renderSaveState() (shell.js:244-250) runs only when setSaveState is called, and there is no timer anywhere in the app (grep -rn 'setInterval' web/src/ -> no matches). Once the user stops editing, the label freezes at whatever it said at the last save and keeps asserting 'just now' indefinitely. The same freeze applies to the Restore list's per-slot 'Nm ago' labels (renderRecoveryEntries is only re-run from setRecoveryEntries).  
*Evidence:* LIVE on the BUILT dist: after one edit the indicator read 'Saved locally · just now'; 26 s idle later it still read 'Saved locally · just now' (saveLabel would return '26s ago' if re-rendered). Script/output in this run…

### Nit (30)

**R1-14** · Docs · verdict CONFIRMED · fix V4  
*Claim/expectation:* TASKS.md:93-95 under 'Known and deliberately not fixed': 'The browser's automatic /favicon.ico request 404s when served from a plain static server. Cosmetic, console-only, pre-existing.'  
*Observed:* web/index.html:23 declares an inline SVG data-URI favicon (<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,...">), and the file's own comment at :8 describes the no-favicon state in the past tense. Two full page loads of dist/index.html through headless Chrome produced no /favicon.ico request in the static server's access log.  
*Evidence:* web/index.html:8,23 ; python3 tools/serve_dir.py dist access log after two CDP page loads: only '"GET /index.html HTTP/1.1" 200' twice, no favicon.ico line

**R1-15** · Docs · verdict CONFIRMED · fix V4  
*Claim/expectation:* ROADMAP.md:3 and TASKS.md:3 both read 'Last updated: 2026-09-10'.  
*Observed:* Both files were last modified on 2026-09-11 by commit ca65e5c ('docs: reconcile the manual and README with what the app actually does'). The self-reported date is stale by one day at the moment of review, and the line is hand-maintained with no guard.  
*Evidence:* git log -1 --format='%ad %s' --date=short -- ROADMAP.md -> 2026-09-11 docs: reconcile the manual and README with what the app actually does ; same for TASKS.md ; ROADMAP.md:3 ; TASKS.md:3

**R1-16** · Docs · verdict CONFIRMED · fix V3  
*Claim/expectation:* README.md:61-63 'Each row shows a single headline badge drawn from three independently scoped statuses -- definition, plan, and export conformance -- never one collapsed word'.  
*Observed:* The registry row renders the headline badge AND the other two axes as secondary chips, i.e. three badges per row. web/src/ui/steps/study.js:405-422 appends headlineBadge then loops the remaining scopes appending a chip each; the module's own comment at :107-109 says 'the registry renders the headline as the row's main badge and the OTHER two [as chips]'. docs/images/03-measurements-registry.png shows the Bacterial viability row carrying 'Needs a decision', 'Defined' and 'Needs review' side by side. 'A single headline badge' understates what a reader will see.  
*Evidence:* web/src/ui/steps/study.js:107-109,401-422 ; docs/images/03-measurements-registry.png (row 1: three badges) ; README.md:61-63

**R1-18** · Docs · verdict CONFIRMED · fix V3  
*Claim/expectation:* README.md:170-171 'The build enforces hard gates (no fetch(), no type="module", no duplicate exports, no import cycles, size ceiling)'.  
*Observed:* The list is incomplete and one item is imprecise. tools/build_single_file.py also hard-fails on top-level await (:19, _check_no_top_level_await), on a surviving static import statement (:66-75 -- the gate lesson 47 exists for), and on XMLHttpRequest / WebSocket() / navigator.sendBeacon / EventSource() (:86-90), which are the gates that actually back the app's no-network promise. 'No duplicate exports' is narrower than the real gate: _check_duplicate_declarations rejects duplicate top-level symbol names 'exported or not' (:315-330).  
*Evidence:* tools/build_single_file.py:15-26 (docstring gate list), :64-90 (FORBIDDEN_IN_OUTPUT), :195 (_check_no_top_level_await), :315-330 (_check_duplicate_declarations) ; README.md:170-171

**R1-19** · Docs · verdict CONFIRMED · fix V4  
*Claim/expectation:* ROADMAP.md:58-59 'web/kb/markers.json/spectra.json gained the default study's own missing markers (SYTO9, DCF) plus a ~20-entry common-dye sweep'.  
*Observed:* Neither SYTO9 nor DCF exists as a canonical in markers.json or as a key in spectra.json. 'syto9' is an alias/variant of the SYTO family and 'dcf' is an alias of DCFDA, so the substance holds (both markers resolve), but the backticked names read as canonicals and will not be found by anyone grepping for them.  
*Evidence:* python3: 'SYTO9' in markers -> False ; 'DCF' in markers -> False ; alias owner of 'syto9' -> SYTO ; alias owner of 'dcf' -> DCFDA ; spectra keys contain SYTO, SYTOX, DCFDA but no SYTO9/DCF

**R2-12** · In-app copy/privacy · verdict CONFIRMED · fix A2c  
*Claim/expectation:* B24. web/src/ui/steps/panel.js:115 badge.textContent = entry.reviewStatus === 'claude-drafted' ? 'unreviewed' : entry.reviewStatus.  
*Observed:* Only the drafted branch is humanized. A cited entry's badge shows the raw internal enum token 'source-cited' (hyphenated machine value) to the user; verified live on dist and in the shipped screenshot. Everything else on the screen uses sentence-case prose.  
*Evidence:* web/src/ui/steps/panel.js:115. LIVE on dist: badges = ['source-cited','source-cited']; also legible in <scratch>/screens/r2/04-src.png.

**R2-13** · In-app copy/privacy · verdict CONFIRMED · fix V5  
*Claim/expectation:* The Feedback step and the manual both call the artifact a 'feedback package' (feedback.js:28 'Copy feedback package'; manual/saving-privacy.html 'What "Copy feedback package" actually shares').  
*Observed:* The header Utilities menu names the same action 'Copy feedback report'. Two names for one action, one of them absent from the manual.  
*Evidence:* LIVE on dist: Utilities menu items = ['Open example in a practice tab','Export project backup','Import project backup','Copy feedback report','Open GitHub issue']; #/feedback buttons = ['Copy feedback package','Download…

**R2-14** · In-app copy/privacy · verdict CONFIRMED · fix —  
*Claim/expectation:* web/manual/saving-privacy.html:75-77 presents 10-settings-storage.png as 'the Settings screen's backup and storage controls' in a chapter that carefully distinguishes your own tab from the practice tab.  
*Observed:* The shot was captured in the PRACTICE tab: the teal bar 'Practice tab — example data, saved separately from your own study. Nothing you do here changes your work.' with 'Why a separate tab?' and 'Reset to the example' is the top band of the image. The chapter's surrounding text is about the reader's own study, so the illustration shows a context the text is explicitly telling them is different. (Cosmetic; the buttons it is there to show are correct.)  
*Evidence:* docs/images/10-settings-storage.png, copied to <scratch>/screens/r2/10-settings-storage.png -- practice-tab banner visible along the top edge. Referenced by web/manual/saving-privacy.html:75.

**R2-15** · In-app copy/privacy · verdict CONFIRMED · fix B3  
*Claim/expectation:* B18. web/src/core/appController.js:325 'Cleared all locally stored data. Your open study is unaffected, and saving has resumed.'  
*Observed:* The toast is scope-blind: run from the practice tab it still says 'all locally stored data' although only the 'micronaut.demo.*' keys were removed (verified live -- see checked_ok #11). The Settings body copy immediately above it does say 'for this tab', so this is a wording inconsistency rather than a false promise about data, hence nit.  
*Evidence:* web/src/core/appController.js:325. LIVE on dist in the practice tab after a two-click clear: toast matched /Cleared all locally stored data\./ while Object.keys(localStorage) still contained micronaut.v1.ring, micronaut…

**R3-08** · Scientific data · verdict CONFIRMED · fix —  
*Claim/expectation:* web/release-notes/CHANGELOG.md:164-168 puts ER-Tracker in the bucket 'The other ten are ambiguous names rather than wrong numbers'.  
*Observed:* The same changelog, 9 lines earlier (:155-157), gives ER-Tracker's actual reason: 'ER-Tracker still is [drafted]: its Blue-White DPX variant has an emission range rather than a peak'. That is the range-not-a-peak reason the changelog used to put H2DCFDA in the FIRST bucket ('no primary source worth citing ... source gives a range'). ER-Tracker is classified against the changelog's own stated criterion. Confirmed in the data: er-tracker blue-white dpx is the only one of the 41 family variants with no familyVariantRecord.  
*Evidence:* web/release-notes/CHANGELOG.md:155-157 and :164-168; r3_diff.out section (d): 'ERTRACKER      status=claude-drafted 3 variants; variants with NO reference record: [\'er-tracker blue-white dpx\']' while the other seven f…

**R3-09** · Scientific data · verdict CONFIRMED · fix —  
*Claim/expectation:* web/release-notes/CHANGELOG.md:166-167: 'BFP, YFP, GCaMP, miRFP and Hoechst are similarly generic' (i.e. ambiguous names, which is why they stay drafted).  
*Observed:* spectra.json's own notes assert the opposite for two of them: HOECHST note = 'Hoechst 33342, the variant overwhelmingly used for live-cell DNA stain.' (a named, specific compound, not a generic name) and GCAMP note = 'Spectrally ~one dye (cpEGFP) across every GCaMP variant despite markers.json's isFamily:true -- variants (6f/6s/7/...) differ in Ca2+ affinity and kinetics, not color'. By the pack's own reasoning neither is spectrally ambiguous, so the changelog's stated rationale does not explain why they remain uncited.  
*Evidence:* r3_diff.out section (l), HOECHST and GCAMP note strings; web/release-notes/CHANGELOG.md:166-167

**R3-14** · Scientific data · verdict CONFIRMED · fix V6  
*Claim/expectation:* advisor.json rule confocal-nyquist, title 'Check your pixel size against Nyquist sampling before you commit to a design'.  
*Observed:* The body then says 'The correct step size depends on numerical aperture and emission wavelength'. 'Step size' conventionally means the axial z-step, not the lateral pixel size the title and the rule's own concept ('undersampling') are about. Title and body name two different quantities.  
*Evidence:* r3_diff.out section (i), rule id 'confocal-nyquist'

**R3-15** **[Unverified]** · Scientific data · verdict CONFIRMED · fix —  
*Claim/expectation:* [Unverified] advisor.json rule smallest-feature-pixel-size: 'sample at roughly 2 to 3 times finer than the smallest feature that matters -- Nyquist sampling. A common practical figure is about 2.3x the feature size, since the true optical resolution of a system is rarely known exactly at acquisition time.'  
*Observed:* Two issues I can support from repo files: (a) the rule anchors Nyquist on the FEATURE size while the co-firing rule confocal-nyquist anchors the same quantity on 'numerical aperture and emission wavelength' -- both are surfaced on 'design', and both fire together whenever modality=confocal and acquisition.smallestFeatureNm exists, giving the user two different derivations of one number with nothing to reconcile them; (b) the '2.3x' figure carries no source and advisor.json has no provenance field (see R3-13). Whether 2.3x is the right factor is [Unverified] -- it is not derivable from anything in this repo.  
*Evidence:* r3_diff.out section (i): rule 'smallest-feature-pixel-size' when={'exists':'acquisition.smallestFeatureNm'}, surfaces ['describe','design'], priority 15; rule 'confocal-nyquist' when={'in':['acquisition.modality',['conf…

**R3-16** · Scientific data · verdict CONFIRMED · fix V6  
*Claim/expectation:* controls.json rule panel-fmo-control, why: 'Once a panel passes about three colors, spectral spillover from every OTHER channel can shift where a real positive/negative boundary sits'.  
*Observed:* Its predicate is {'gt': ['panel.derived.fluorophoreCount', 2]}, i.e. the rule fires AT three colours, not once a panel passes three. The prose and the predicate describe different trigger points (the 'about' hedges it, hence nit).  
*Evidence:* r3_diff.out section (j), rule id 'panel-fmo-control'

**R3-17** · Scientific data · verdict CONFIRMED · fix —  
*Claim/expectation:* web/src/ui/spectralView.js:459 caption: 'Filter bands use an emission-derived suggestion until you enter the microscope's actual detection filter.'  
*Observed:* The suggestion is centre = round(emission peak), width = 30 nm (engine/panelAssembly.js:64,72-75). Its own comment sources the 30 nm to spectra.json's overlapRules note ('the midpoint of the "20-40 nm wide" range spectra.json's own overlapRules note already documents'), i.e. a claude-drafted, reviewStatus='claude-drafted' note is the authority for a second shipped constant. The caption calls the width 'emission-derived' without flagging that provenance, and the same caption already flags the CURVE widths as drafted ('schematic from each fluorophore's emission peak and drafted width'). Whether a real bandpass sho…  
*Evidence:* web/src/engine/panelAssembly.js:54-75; web/src/ui/spectralView.js:459; web/kb/spectra.json overlapRules.reviewStatus='claude-drafted'

**R4-15** · UX primary flow · verdict CONFIRMED · fix D1  
*Claim/expectation:* A transient status toast should not outlive its context.  
*Observed:* .shell-status keeps its last message indefinitely in the DOM (it only fades visually). 'Downloaded micronaut-schedule.ics -- import it into your calendar app.' was still the live-region content minutes later, across four route changes, and is read at the bottom of #app's innerText on Settings, Feedback and Guide.  
*Evidence:* <scratch>/screens/r4/35-settings.png ; <scratch>/screens/r4/37-feedback.png ; s90/s92 output: status still 'Downloaded micronaut-schedule.ics...' on #/settings and #/feedback

**R4-16** · UX primary flow · verdict CONFIRMED · fix D1  
*Claim/expectation:* Delete confirm text should match what the app actually keeps.  
*Observed:* Deleting a measurement warns 'This cannot be undone.' while the Utilities > Restore ring still holds prior versions of the study that include the deleted measurement, and Settings' own copy tells users their work 'remains available in Restore'.  
*Evidence:* <scratch>/screens/r4/17-registry-after-delete.png ; s29.py: confirm text 'Delete "Measurement 3" and all its design, panel, and naming data?\n\nThis cannot be undone.'

**R4-17** **[Unverified]** · UX primary flow · verdict UNVERIFIABLE · fix —  
*Claim/expectation:* Two progress counters on one screen should not both read '... of 5' for different things.  
*Observed:* The Study map shows 'STUDY MAP - QUESTION 3 OF 5' in the body while the workflow footer simultaneously reads 'Step 1 of 5' (route position). Both are '/5'.  
*Evidence:* <scratch>/screens/r4/02-study-map-complete.png ; s04.py body dump

**R4-18** · UX primary flow · verdict CONFIRMED · fix —  
*Claim/expectation:* An unrecognised marker message should point at the field the user just edited.  
*Observed:* Entering markers 'PI-SYTOX' in the Acquisition sub-section yields '"PI" isn't a marker this app recognizes yet -- check the spelling on the Data plan step.' The field just edited is in Acquisition (the Data plan has a second, separate Markers input). 'PI' is also the standard abbreviation for propidium iodide, which the KB does recognise as PROPIDIUMIODIDE.  
*Evidence:* <scratch>/screens/r4/30-measurement-says-no-recognized-fluorophores.png ; s61.py output

**R4-19** · UX primary flow · verdict CONFIRMED · fix —  
*Claim/expectation:* A saved study should be identifiable in the Restore list.  
*Observed:* There is no control anywhere in the workflow that sets the study title: meta.title stays '' and the exported JSON has "title": "". Every entry in Utilities > Restore therefore reads 'Untitled study' (5 identical entries differing only by relative time), even after the research question has been answered.  
*Evidence:* <scratch>/screens/r4/04-describe-empty.png ; s14.py store dump: meta.title=''; s10.py control dump: 5x 'Untitled study ...' restore buttons

**R4-20** · UX primary flow · verdict CONFIRMED · fix —  
*Claim/expectation:* One date format across the app.  
*Observed:* The Data plan DATE control is a native <input type=date> rendering '03/14/2026' (locale order) while every other surface -- filename previews, suggestions, the Acquisition DATE field -- uses ISO '2026-03-14'.  
*Evidence:* <scratch>/screens/r4/27-two-markers-fields-disagree.png

**R5-11** · UX utilities/edges · verdict CONFIRMED · fix D3  
*Claim/expectation:* engine/guidedExample.js:120 builds the Study-map summary as `${plural(facts.assayCount,'measurement')} are currently included...`, and plural() (guidedExample.js:69-71) correctly returns '1 measurement' for a count of one.  
*Observed:* The verb is hard-coded plural, so a one-measurement study renders 'In this study now: 1 measurement are currently included.' -- seen live in a blank study's 'Explain the workflow' panel.  
*Evidence:* <scratch>/findings/r5/a2.out feature_walkthrough_text: 'In this study now1 measurement are currently included.'; screenshot <scratch>/screens/r5/13-feature-walkthrough.png; code web/src/engine/guidedExample.js:120

**R5-12** · UX utilities/edges · verdict CONFIRMED · fix —  
*Claim/expectation:* Keyboard-only use should not require traversing the whole chrome before reaching page content; a skip link is the usual remedy.  
*Observed:* There is no skip link (querySelector for .skip-link/.skip-to-content/a.skip -> false). A keyboard user Tabs through 18 header/nav/utility controls before the first in-content control on EVERY route. Everything else in the keyboard pass was clean: 27 consecutive Tab stops all had a visible focus ring (outline 2-3px solid), none were offscreen, Escape closed the Utilities menu and returned focus to its toggle, and Enter activated a nav item (hash became #/guide).  
*Evidence:* <scratch>/findings/r5/a7.out (has_skip_link=false; tab_order 27 entries each with outline 'solid 2px/3px ...'; focusables_without_visible_ring=[]; menu_after_escape=false; focus_after_escape='shell-utility-toggle'; rout…

**R5-13** · UX utilities/edges · verdict CONFIRMED · fix V5  
*Claim/expectation:* tools/serve_dir.py:85-105 maps /release-notes/images/<name> onto docs/images/<name> when serving web/, so the release-notes screenshots work unbuilt.  
*Observed:* The same mapping is NOT applied to /manual/images/, so every manual chapter served from web/ shows its 'Snapshot pending — images/NN-....' placeholder and logs a 404, while the release-notes page on the same server renders its screenshots fine. dist is unaffected (build_single_file copies 10 PNGs into dist/manual/images and all 12 manual pages had 0 broken resources there).  
*Evidence:* <scratch>/findings/r5/a6.out (web: 9 of 12 manual pages have exactly one 404 image; dist: 0 broken across all 12); <scratch>/findings/r5/a6b.out (web_manual_placeholder_text='Snapshot pending — images/01-study-map.', we…

**R6-03** · UI wiring (code) · verdict CONFIRMED (source-verified) / repro NON-PROBATIVE · fix C2  
*Claim/expectation:* Exports should be named after the study.  
*Observed:* `(freshDoc.study.title // fallbackName).replace(/[^A-Za-z0-9_-]+/g,'-')` -- a title that is non-empty but has no ASCII alphanumerics (all whitespace, all punctuation, or any non-Latin script such as Hebrew/Japanese) is truthy, so the fallback never fires and every export is named '-.md' / '-.csv' / '-.svg' / '-.json'. appController.projectFilename() already solves this correctly (it trims the collapsed dashes and re-applies its fallback); overview.js does not reuse it. [Unverified] as a live path: nothing in the current UI writes meta.title, so this is only reachable through an imported backup or a migrated v1 s…  
*Evidence:* web/src/ui/steps/overview.js:594-597 vs web/src/core/appController.js:31-37. Repro output: 'BUG: a non-Latin title produces the filename "-.md"'. Grep for a writer of meta.title across web/src/ui returns nothing (only s…

**V1-N6** · Docs · verdict VERIFIER-NEW · fix —  
*Claim/expectation:* web/release-notes/index.html:114 'the 14 that do not are named below'; :190 footer fallback comment 'Bump this by hand ... on every release'.  
*Observed:* Both promises depend on a fetch. index.html:234 fetch('./CHANGELOG.md') is the only thing that renders the 0.19.0 'Known gaps' block naming all 14, and the only thing that corrects the footer from the hard-coded v0.19.0 (:192). Opened from file:// the fetch is blocked, the catch at :241 replaces the changelog with 'Couldn't load the changelog here', and a reader then sees a lede promising 14 names with none present plus a two-releases-stale footer. This is the residual of R1-05 after that finding was refuted for the served page.  
*Evidence:* web/release-notes/index.html:114,190-192,232-242; web/release-notes/CHANGELOG.md:159-170

**V3-N5** · Scientific data · verdict VERIFIER-NEW · fix A1, A2c  
*Claim/expectation:* R3 checked_ok item B28 asserts panel.js's filter input bounds 'match' engine/spectralView.js's constants.  
*Observed:* They agree today, but by coincidence, not by construction: panel.js:664-665 passes bare literals 300,900 and 1,300 while SPECTRAL_VIEW_MIN_FILTER_WIDTH_NM / MAX_FILTER_WIDTH_NM are module-private (not exported) in engine/spectralView.js:19-20, and MIN_NM/MAX_NM are exported but unused by panel.js. Changing the engine bound opens exactly the accept-then-reject window R3 declared closed (lesson 40 class: a mirrored constant that is not generated from its producer).  
*Evidence:* web/src/ui/steps/panel.js:664-665; web/src/engine/spectralView.js:14-20 ('export const SPECTRAL_VIEW_MIN_NM = 300' / non-exported 'const SPECTRAL_VIEW_MIN_FILTER_WIDTH_NM = 1'); grep shows panel.js imports no bound cons…

**V4-N4** · UX primary flow · verdict VERIFIER-NEW · fix A2a  
*Claim/expectation:* When a field is rejected as invalid, the previews derived from it should not silently substitute a different value.  
*Observed:* Setting BIOLOGICAL / INDEPENDENT REPLICATES to -5 or 0 raises the correct error ('biologicalReplicates: Must be a positive integer; got -5.') but the condition-row previews below keep rendering 'bio=B01' and full .tif filenames as if the answer were 1 -- the user sees a plan built from a number the app has just refused. By contrast 10000 and 999999999 are handled well ('exceeds the 99-replicate cap for a 2-digit token', 'Design expands to 3999999996 rows, exceeding the cap of 1000', and the rows collapse to 'No rows to show -- see the issues above.'), and a 240-character group name correctly produces the 302-cha…  
*Evidence:* <scratch>/verify/v4/screens/w29-huge-replicates.png; w29.py transcript (the -5 and 0 cases show both the error and 'bio=B01' rows in the same dump); w31.py (302-character path error text).

**V5-NEW-03** · UX utilities/edges · verdict VERIFIER-NEW · fix D1  
*Claim/expectation:* shell.js's Restore list is the recovery surface settings.js:65 points users at ('Your current work remains available in Restore.') and each row carries aria-label 'Permanently delete the saved version "<title>"'.  
*Observed:* Untitled studies are indistinguishable: after six blank-study rounds the list is six rows reading 'Untitled study' plus a relative time, and all six delete buttons share the identical accessible name 'Permanently delete the saved version "Untitled study"'. A user told to recover their work from Restore (and, per R5-01, forced to delete a row to un-jam autosaving) has only '19s ago'/'22s ago' to choose by, and a screen-reader user has nothing.  
*Evidence:* <scratch>/verify/v5/t01b.py (app text 'Latest: Untitled study19s ago Untitled study22s ago ...'), t12_starve_escape.py delete_buttons = three identical aria-labels; screenshot shots/17-starve-escape.png

**V6-NEW-05** · UI wiring (code) · verdict VERIFIER-NEW · fix —  
*Claim/expectation:* measurement.js:20-24: 'The embedded sub-steps below it re-render themselves on their own store subscriptions, so the header can go stale relative to them -- pre-existing behaviour, not introduced by this module.'  
*Observed:* No step subscribes to the store at all: grep -rn 'store.subscribe' web/src/ui -> shell.js:962 and walkthrough.js:378 only. Each embedded step re-renders only from its OWN handlers, which is why a write from a SIBLING section never reaches it. The comment states as fact the very mechanism whose absence causes R6-01/R6-02/R6-07, and scopes the staleness to the header alone -- a reader trusting it would not look for the cross-section bug.  
*Evidence:* grep -rn 'store.subscribe' web/src/ui/ ; web/src/ui/steps/measurement.js:20-24 ; web/src/main.js:346-354.

## Appendix A — refuted by verifiers (kept for the record)

- **R1-03** (Docs): README.md:98-101 'The GitHub issue path pre-applies the feedback label ... so feedback opened from the app is one filterable group inside the repo'; TASKS.md:25-29 repeats it as shipped, under a head… — *Refutation:* The live repo HAS the label. mcp github get_label Daniel-Waiger/micronaut-explorer name=feedback -> {"name":"feedback","color":"0e8a16","description":"Opened from the planner in-app Feedback page"}; get_label knowledge-pack -> exists too ({"color":"5319e7"}). README.md:98-101's claim is therefore TRUE and TASKS.md:25-…
- **R1-05** (Docs): web/release-notes/index.html:114 '143 of the pack's 157 entries now carry a source; the 14 that do not are named below, because an honest gap is more useful than a confident guess.' — *Refutation:* The page names all 14. index.html:232-238 fetches ./CHANGELOG.md and renders it into #cl-body BELOW the hero, and web/release-notes/CHANGELOG.md:159-170 (the 0.19.0 'Known gaps' block) names Cy2, Cy7, TRITC, H2DCFDA, CFP, GFP, IRFP, mRuby, BFP, YFP, GCaMP, miRFP, Hoechst and ER-Tracker = exactly my recomputed uncited …
- **R1-08** (Docs): README.md:247-249 'One privacy note that applies to all of them: this repository is public, and the Feedback package ends with your entire study as JSON ... Paste the short header lines, not the stud… — *Refutation:* The repository IS public, so README.md:247-249 is correct. GitHub API (search_repositories repo:Daniel-Waiger/micronaut-explorer) returns "private": false, "visibility": "public", has_issues:true, has_discussions:true. I read .github/workflows/deploy.yml in full (139 lines): its lines 4-7 are a HEADER COMMENT explaini…
- **R1-20** (Docs): [Unverified] A37 (CHANGELOG.md:17-147, ~34 Micronaut Classic behavioural claims) and A30 (ROADMAP.md:159-183, Classic's feature and backlog list), plus ROADMAP.md:123-126's '~2,500 lines of source pl… — *Refutation:* A37/A30 ARE verifiable read-only. refs/tags/classic-final resolves on origin (git ls-remote) and the Classic tree is readable there. Sampled A37 item 'extraction is now bounded by a per-file process timeout (extraction_timeout_seconds, default 20s)' -> src/microscopy_naming_assistant/config.py at refs/tags/classic-fin…
- **R2-10** (In-app copy/privacy): B36. web/src/engine/validation.js:76-79 emits 'This filename would be ${pathStr.length} characters long, which is longer than Windows allows (260). ... Full path: '${pathStr}''. — *Refutation:* R2 asserts the message quotes the length of the FULL path while calling it a filename. I checked every call site: ui/steps/naming.js:469 passes `name` from currentFilenames(); ui/steps/design.js:505 passes `entry.filename`; engine/conformance.js:107 passes `entry.filename`. No caller ever prepends a directory, so the …

## Appendix B — follow-ups not turned into tasks

- `[Unverified]` R3-03 (ECFP/EGFP/mRuby2 values absent from every repo file — needs FPbase records added), R3-15 (Nyquist anchoring across two co-firing advisor rules), R4-17 (Study map "question 3 of 5" vs footer "step 1 of 5" — state unreachable in the verifier's profile), R6-09 as originally stated (superseded by the verified version fixed in B4).
- R3-13: advisor.json / controls.json carried no provenance model — batch F5 (W2) added a pack-level `reviewStatus`/`note` surfaced in the UI; per-rule sourcing of the 29 hard numbers remains open.
- R3-12: "157 fluorophores" counts top-level entries; users pick among 190 leaf spectra — both counts now stated (W1).
- V3-N2 partial: `two-photon` and `TIRF` match zero advisor rules; only spinning-disk is folded into confocal rules in V6.
- R3-08/09/17, R4-18/19/20: fixed in batch F5 (W1–W3). R1-15: nit noted, not scheduled.
- R3-06: the flag ignores FWHM by documented design; the note (V6) and the flag message (W2) now say so; the model is not changed.

## Method

Batch 1 (six parallel Opus reviewers, read-only, each with a contract in `docs/plans/app-review-2026-09-11-task-graph.json` and the claims inventory embedded there). Batch 2 (six Opus adversarial verifiers): every finding independently reproduced (command, file read, or a fresh headless-Chromium drive of the built artifact over http), verdict CONFIRMED / REFUTED / UNVERIFIABLE with the verifier's own evidence, ≥6 `checked_ok` items per track attacked, then a missed-defect hunt (lesson 44). All six verifications returned `pass=true`. Merge: `review/merge.py` (verifier severity wins). The orchestrator re-scanned every minor/nit entry (lesson 30) and promoted six into tasks (R3-04, R4-04, R4-12, R5-08, R5-09, V2-NEW-03; R4-13 left as a follow-up).

Incidents: the Opus session limit (reset 00:50 UTC, 2026-09-12) killed R5 after it had written its deliverables (inspected and accepted per lesson 45) and killed V2/V4 mid-run with no output; both were re-dispatched to Opus after the reset — no model substitution. Two agents (R2, V6) `pkill`ed sibling servers by name mid-run; one resulting false alarm was recorded by R5 and re-verified clean by V5. Verifiers used the GitHub API (read-only) to settle three docs claims (label existence, repo visibility, tag existence).

## Screenshot index (ephemeral)

`<scratch>/screens/r2/`, `r4/` (58), `r5/` (52), `<scratch>/verify/v4/screens/`, `v5/shots/` (24). Regenerated reference screenshots for the docs are produced at the end of the remediation run with `tools/capture_screenshots.py`.


## Addendum — remediation run 2026-09-12 (fixes applied in this branch)

User decision after the findings landed: fix the confirmed findings in the same run, with Sonnet (high effort) executing, Opus red-teaming each fix, and the orchestrator (Fable) doing final passes. Execution graph: `docs/plans/app-review-remediation-task-graph.json` (25 tasks, 7 batches). Final tree: **1011 JS tests / 88 Python tests passing, single-file build green**, 12 commits on `claude/eager-curie-8aqjwu` after the review commit.

| | blocking | major | minor | nit | total |
|---|---|---|---|---|---|
| Fixed in this run | 5 | 26 | 49 | 18 | 98 |
| Not scheduled (follow-ups / nits / unverified) | 0 | 0 | 7 | 12 | 19 |

### Task outcomes (dashboard vocabulary: `done` = first try passed red-team; `resolved` = failed once and was repaired)

| Task | Outcome | Note |
|---|---|---|
| A1 | resolved | Opus fail (bounds constant ≠ producer) → fixed by orchestrator |
| A2 | resolved | Opus fail (variant ids vs canonical) → fixed by orchestrator; later made variant-aware on both sides after A3 red-team |
| B1 | resolved | Opus pass; stale comment fixed by orchestrator |
| B3 | resolved | Opus pass; vacuous drift regex + build export gate hardened by orchestrator |
| E1 | resolved | Opus fail (issue never rendered; ASCII false positives; side channel) → Sonnet retry → Opus round-2 pass; total-loss gate fixed by orchestrator |
| E2 | done | Opus pass |
| A3 | resolved | Opus fail (canonical pair key collapsed family variants) → fixed by orchestrator (shared `fluorophoreEntryId`) |
| B2 | resolved | Opus pass; rollback orphan + double slot fixed by orchestrator |
| B4 | resolved | Opus fail (`[""]` not a clear; no heal) → retry → Opus round-2 fail (weak empty payload bypassed provenance) → fixed by orchestrator |
| A4 | resolved | Opus fail (union of sources; dead re-entrancy guard; unsatisfiable R6-08 test) → fixed by orchestrator |
| A2a | done | verified by orchestrator (suite + live) |
| A2b | done | verified by orchestrator (suite + live) |
| A2c | resolved | executor cut off (session limit) after writing code; orchestrator repaired a NUL byte and a duplicate top-level constant, wrote `panelStep.test.js`, verified live |
| A5 | done | orchestrator (never dispatched before the outage) |
| C2 | resolved | executor cut off; orchestrator verified live (Blocks export label, dedupe, toast, exports) |
| C3 | done | orchestrator; live 400 px scroll + 15.4:1 contrast |
| D1 | resolved | Opus pass; tick focus loss + false "three most recent" wording + unhandled import rejection fixed by orchestrator |
| D2 | resolved | Opus fail (focus theft on failed copy; vacuous test; copy channel dead end) → retry → round-2 red-team cut off; orchestrator verified by tests + live modal |
| D3 | done | Opus pass |
| V1 | done | red-team cut off; orchestrator verified (guard falsification, live hero/footer both modes, changelog vs commits) |
| V2 | done | red-team cut off; orchestrator verified live (87 `<li>` for 87 bullets) |
| V3 | resolved | Opus fail (CI "one job"; walkthrough gate wording) → fixed by orchestrator |
| V4 | resolved | Opus fail (TASKS claimed UI not yet landed) → wording fixed; claim held until the UI landed |
| V5 | resolved | executor cut off; orchestrator finished the manual sentences |
| V6 | done | red-team cut off; orchestrator verified (KB valid, selectAdvice spinning-disk/TIRF) |

### Per-finding status

| Finding | Severity | Status | Task |
|---|---|---|---|
| R4-01 | blocking | fixed | A1, A3, A2c |
| R5-01 | blocking | fixed | B1 |
| R6-04 | blocking | fixed | B2 |
| R6-05 | blocking | fixed | B2 |
| V6-NEW-01 | blocking | fixed | B2 |
| R1-01 | major | fixed | V3, V4 |
| R1-04 | major | fixed | V1 |
| R2-01 | major | fixed | E2, D3 |
| R2-02 | major | fixed | V1 |
| R2-03 | major | fixed | D3 |
| R2-04 | major | fixed | V2 |
| R3-01 | major | fixed | V1 |
| R4-02 | major | fixed | A2b |
| R4-03 | major | fixed | A4, A2a, A2b |
| R4-05 | major | fixed | C3 |
| R4-06 | major | fixed | A2c |
| R5-02 | major | fixed | D2 |
| R5-03 | major | fixed | E2, D3 |
| R6-01 | major | fixed | A4, A2b, A2c |
| R6-02 | major | fixed | A4, A2a |
| R6-07 | major | fixed | A5 |
| R6-08 | major | fixed | A4 |
| V1-N1 | major | fixed | V1 |
| V2-NEW-01 | major | fixed | V2 |
| V2-NEW-02 | major | fixed | D2 |
| V2-NEW-03 | major | fixed | B3 |
| V3-N1 | major | fixed | A2, A3, A2c |
| V4-N1 | major | fixed | E1 |
| V4-N2 | major | fixed | A2c |
| V5-NEW-01 | major | fixed | D2 |
| V6-NEW-03 | major | fixed | B4 |
| R1-02 | minor | fixed | V4 |
| R1-06 | minor | fixed | V3 |
| R1-07 | minor | fixed | V3 |
| R1-09 | minor | fixed | V4 |
| R1-10 | minor | fixed | V1 |
| R1-11 | minor | fixed | V1 |
| R1-12 | minor | fixed | V3 |
| R1-13 | minor | fixed | V3 |
| R1-17 | minor | fixed | V1, V4 |
| R2-05 | minor | fixed | V2 |
| R2-06 | minor | fixed | V1 |
| R2-07 | minor | fixed | V5 |
| R2-08 | minor | fixed | V5 |
| R2-09 | minor | fixed | V5 |
| R2-11 | minor | fixed | D2 |
| R3-02 | minor | fixed | W1 |
| R3-03 | minor | fixed | W1 |
| R3-04 | minor | fixed | A1, A2c |
| R3-05 | minor | fixed | V6 |
| R3-06 | minor | fixed | W2 |
| R3-07 | minor | fixed | V6 |
| R3-10 | minor | fixed | V6 |
| R3-11 | minor | fixed | V1 |
| R3-12 | minor | fixed | W1 |
| R3-13 | minor | fixed | W2 |
| R4-04 | minor | fixed | A3, C2 |
| R4-07 | minor | fixed | A3, C2 |
| R4-08 | minor | fixed | W4 |
| R4-09 | minor | fixed | C2 |
| R4-10 | minor | fixed | A2c |
| R4-11 | minor | fixed | C3 |
| R4-12 | minor | fixed | A2a |
| R4-13 | minor | fixed | W3 |
| R4-14 | minor | fixed | C2 |
| R5-04 | minor | fixed | D1 |
| R5-05 | minor | fixed | V1 |
| R5-06 | minor | fixed | V2 |
| R5-07 | minor | fixed | D3 |
| R5-08 | minor | fixed | D2 |
| R5-09 | minor | fixed | B2 |
| R5-10 | minor | fixed | D3 |
| R6-06 | minor | fixed | D1 |
| R6-09 | minor | fixed | B4 |
| V1-N2 | minor | fixed | V3 |
| V1-N3 | minor | fixed | V3 |
| V1-N4 | minor | fixed | V4 |
| V1-N5 | minor | fixed | V4 |
| V2-NEW-04 | minor | fixed | E1 |
| V2-NEW-05 | minor | fixed | D3 |
| V3-N2 | minor | fixed | V6 |
| V3-N3 | minor | fixed | V6 |
| V3-N4 | minor | fixed | V1 |
| V4-N3 | minor | fixed | A2c |
| V5-NEW-02 | minor | fixed | B1 |
| V6-NEW-02 | minor | fixed | B4 |
| V6-NEW-04 | minor | fixed | D1 |
| R1-14 | nit | fixed | V4 |
| R1-15 | nit | fixed | V4 |
| R1-16 | nit | fixed | V3 |
| R1-18 | nit | fixed | V3 |
| R1-19 | nit | fixed | V4 |
| R2-12 | nit | fixed | A2c |
| R2-13 | nit | fixed | V5 |
| R2-14 | nit | fixed | W1 |
| R2-15 | nit | fixed | B3 |
| R3-08 | nit | fixed | W1 |
| R3-09 | nit | fixed | W1 |
| R3-14 | nit | fixed | V6 |
| R3-15 | nit | fixed | W2 |
| R3-16 | nit | fixed | V6 |
| R3-17 | nit | fixed | W2 |
| R4-15 | nit | fixed | D1 |
| R4-16 | nit | fixed | D1 |
| R4-17 | nit | follow-up | — |
| R4-18 | nit | fixed | W2 |
| R4-19 | nit | fixed | W3 |
| R4-20 | nit | fixed | W3 |
| R5-11 | nit | fixed | D3 |
| R5-12 | nit | fixed | W3 |
| R5-13 | nit | fixed | V5 |
| R6-03 | nit | fixed | C2 |
| V1-N6 | nit | fixed | W1 |
| V3-N5 | nit | fixed | A1, A2c |
| V4-N4 | nit | fixed | A2a |
| V5-NEW-03 | nit | fixed | D1 |
| V6-NEW-05 | nit | fixed | W3 |

### Batch F5 — follow-ups (W1–W4, after PR review)
The 19 minor/nit findings left as follow-ups were fixed in a fifth batch (four Sonnet executors at high effort; the orchestrator verified each on disk, ran both suites, rebuilt `dist` and drove it over http, with no separate red-team). W1 (R3-02/03/08/09/12, V1-N6, R2-14): release-notes and manual wording — the "ambiguous names" card no longer asserts which variant CFP/GFP/mRuby store, counts are given at both the top-level (143/157) and selectable-spectrum (174/190) level, the 14 uncited entries are named inline, manual captions say the screenshots show the practice tab. W2 (R3-13/15/17, R3-06, R4-18): `advisor.json`/`controls.json` gain a pack-level `reviewStatus`/`note` that the loaders carry and the Guidance/Controls panels caption as unreviewed; the two Nyquist rules cross-reference each other; the 30 nm default filter band moves from a literal in `panelAssembly.js` to `spectra.json`'s `overlapRules.filterBandDefaultNm` (test pins engine default == pack value); overlap flag messages say "peak-to-peak distance … curve widths are not considered"; `pi` resolves to propidium iodide and the unrecognised-marker message is location-neutral. W3 (R4-13/19/20, R5-12, V6-NEW-05): selects start on a disabled "Choose…" placeholder; the Data plan date shows an ISO helper; a Study title field on the Study map writes `meta.title` so Restore rows are identifiable; a skip link targets the `<main>` shell.js renders (the orchestrator moved the id into shell.js and removed W3's MutationObserver workaround once W4 released that file); V6-NEW-05 was already true. W4 (R4-08): the nav entry for the active measurement reads the same `workflowProgress.assays[i].status` headline as the registry row and the switcher pill (verified live in Draft, Needs a decision and Blocked). R4-17 stays `[Unverified]` (unreachable). While driving the build the orchestrator also found and fixed a pre-existing defect: Review's "Readout:" line resolved its label from the stored `readout` id, which only the example study writes, so every user-typed readout rendered as "Readout: null" (`studydoc.js`, regression test added).

### Follow-ups surfaced by the red-teams (not fixed here)
- persist.js: a save whose ring-index write fails after a *protected-slot* eviction now restores the pre-save ring, but a save that fails on the *protected-slots key* write still reports failure while the write succeeded elsewhere; and restoring the oldest unprotected slot can evict that very slot (B1/B2 red-teams).
- Review tiers a blocking non-Latin group error under "Can be assigned later" (`tierForField` knows `groups`, not `group`); the Name builder surface shows no sanitization message beside its own box; sanitization issues are not exported to the CSV manifest (E1 round 2).
- Panel: a duplicate dye in two channels yields a `X|X` self-pair error that cannot be acknowledged by design (correct) but its message says "0 nm apart" rather than "the same fluorophore twice" (A3 red-team).
- Shell: toast queue keeps the 3 most recent and does not de-duplicate; `destroy()` leaves the toast timer running; the 60-char research-question excerpt cuts mid-word (D1 red-team).
- Feedback: on the Utilities-menu path focus returns to the Utilities toggle, not the menu item (the item is hidden once the menu closes) — a convention, flagged for a UX decision (D2 retry).
- README's walkthrough sentence describes the origin gate correctly, but an imported practice backup can still reach the walkthrough outside `?demo=1` (V3 red-team).
- Build tool: multi-line `export { … }` lists are now rejected by the output gate (falsification-tested) but not folded like imports are (B3 red-team).

### Method (this run)
Two session-limit outages interrupted the pipeline (00:50 UTC and 07:45 UTC). In the first, one reviewer and two verifiers were lost and re-run on the same model. In the second, three executors (A2c, C2, V5) and two red-teams (D2 round 2; V1+V2+V6) were killed with the reset three hours away; per lesson 42 the orchestrator substituted a declared warm-context loop — inspect what each interrupted agent left on disk, repair, write missing tests, run both suites and the build gate, drive the built artifact over http with CDP (headless Chromium cannot hold focus, so focus behaviour was proven in DOM-stub tests instead), and record the substitution per task on the dashboard and in the table above. A5 and C3 were never dispatched to an executor and were done by the orchestrator directly. Red-team verdicts and scripts live under the session scratch dir `review/redteam/`; they are not committed.
