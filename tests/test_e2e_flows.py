"""Browser end-to-end suite against the BUILT single-file artifact (AUD-19).

Exactly seven tests, deliberately kept to that count (see docs/cma-lessons.md
lesson 4: surface area predicts retries, and a sprawling e2e file is exactly
the surface area a fast unit-test layer should be absorbing instead). Each
test earns its place by covering something no lower layer can:

  1. blank first visit -- the cheapest possible "did the whole pipeline (this
     module's own build+serve+drive machinery, not just app code) actually
     work" smoke check, and the baseline every other test's setup relies on.
  2. localStorage-as-a-throwing-getter -- the white-screen boot regression
     guard for AUD-01. core/persist.js's defaultBackend() is a DEFAULT
     PARAMETER of ten exported functions; a unit test that constructs a
     fake storage object never exercises the moment `globalThis.localStorage`
     itself throws on *property access*, before any function body runs. Only
     a real browser page whose global is poisoned before any app script
     executes can reach that seam -- hence Page.addScriptToEvaluateOnNewDocument
     rather than a monkeypatch in `node --test`.
  3. open the example, then start the guided walkthrough -- AUD-13's fix.
     web/tests/guideStep.test.js unit-tests guide.js's own render() in
     isolation with an injected origin string; it cannot prove the ACTUAL
     runtime value main.js's openExampleStudy() writes (`'template'`) is the
     same string guide.js's gate now accepts, end to end, through a real
     click on the real Home page. That producer/consumer seam (cma-lessons.md
     lesson 36) is exactly what a browser test closes.
  4. pause -> reload -> resume at the same cursor -- guidedProgress.js's
     persistence is unit-tested against a fake storage; this proves a REAL
     full-page reload (not a simulated one) restores the walkthrough at the
     step the reader left it on, through the real main.js boot path.
  5. edit -> Start a blank study -> the edit survives in Restore -- AUD-08's
     flushAutosave-before-replace fix closes a real timing window (the
     pending 500ms debounce persisting the wrong study). Proving a timing
     window is closed needs a real clock and a real debounced subscriber, not
     a fake-timer unit test standing in for both.
  6. clear-all reports truthfully -- AUD-01/appController's clearAllStoredData
     must not claim success it did not achieve; this drives the real two-click
     armed button and reads the real toast and the real post-clear Restore
     list, rather than asserting on the return value of a directly-called
     function.
  7. the served artifact contains no static import/export statements --
     per cma-lessons.md lesson 48, "verified live" against a dev server can
     lie; this fetches the actual bytes tools/serve_dir.py answers with for
     the BUILT artifact (never web/'s unbundled source), which is what
     Pages actually ships.

Everything else this app does (every pure function, every render() in
isolation, every persistence edge case) belongs in web/tests/*.test.js under
plain `node --test` -- fast, dependency-free, and already 700+ tests deep.
This file exists only for the handful of behaviors that live in the seam
between real Chrome and the real built artifact.
"""

from __future__ import annotations

import json
import re
import urllib.request

PRIMARY_WORKFLOW_LENGTH = 5  # engine/workflowProgress.js's PRIMARY_WORKFLOW: home/describe/study/measurement/overview

# Study map offers the example either as a prominent panel above the map (a
# visitor with nothing answered yet -- the state every test here starts in) or
# as the quiet link below it (a study already in progress). ui/steps/home.js
# marks BOTH with data-action="open-example" precisely so callers like this one
# do not have to know which variant is on screen.
OPEN_EXAMPLE_SELECTOR = 'button[data-action="open-example"]'

THROWING_LOCAL_STORAGE_JS = """
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  get() { throw new Error('SecurityError: localStorage is disabled in this context'); }
});
"""


def _local_storage_contains(page, needle: str) -> bool:
    """True if ANY localStorage value on the current origin contains `needle`
    as a substring -- used to prove a specific edit landed in a Restore ring
    slot, without hardcoding persist.js's STORAGE_PREFIX/key-naming scheme
    (a schema-version bump would silently stop matching a literal prefix)."""
    script = """
    (() => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const value = localStorage.getItem(key);
        if (value && value.includes(%s)) return true;
      }
      return false;
    })()
    """ % json.dumps(needle)
    return bool(page.eval_js(script))


def _set_research_question(page, value: str) -> None:
    """Type into the Study map's research-question field the same way a real
    user would (set .value, dispatch a real 'input' event) -- this is the
    one field a fresh/blank study always shows on first load (see
    web/src/ui/studyMap.js's firstUnansweredStep), so it needs no example
    data and no prior navigation."""
    script = """
    (() => {
      const el = document.getElementById('study-map-research-question');
      if (!el) return false;
      el.value = %s;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()
    """ % json.dumps(value)
    found = page.eval_js(script)
    assert found, "expected #study-map-research-question on a fresh Study map"


def test_blank_first_visit_renders_with_no_console_errors(page, index_url):
    page.goto(index_url)
    assert page.exists(".shell-header")
    assert page.text("h1.step-heading") == "Study map"
    assert page.console_errors() == []


def test_app_boots_with_a_throwing_localStorage_getter(page, index_url):
    """The white-screen regression guard for AUD-01.

    Before AUD-01, core/persist.js's defaultBackend() read
    `globalThis.localStorage` with no try/catch, and it is a DEFAULT
    PARAMETER of every one of persist.js's ten exported functions -- so the
    very first persistence call (main.js's resolveInitialExperiment, at
    module-scope init()) threw before any internal guard ran, and the app
    never rendered anything into #app at all. Page.goto()'s default
    wait_for_app=True raises TimeoutError on exactly that failure mode, which
    is what makes this a real regression guard rather than an assertion that
    could quietly stop checking anything.
    """
    page.session.call("Page.addScriptToEvaluateOnNewDocument", {"source": THROWING_LOCAL_STORAGE_JS})
    page.goto(index_url)  # raises TimeoutError (via wait_for_app) on a white-screen boot
    assert page.text("h1.step-heading") == "Study map"
    assert page.console_errors() == []
    # Persistence degraded silently rather than throwing: no autosave could
    # ever have run, so the save indicator must read the same as a genuine
    # first run, not a stale/failed state.
    assert page.text(".shell-save-indicator") == "Not saved locally yet"


def test_open_example_then_start_guided_walkthrough(page, index_url):
    """AUD-13's fix: before it, ui/steps/guide.js:101 gated the walkthrough's
    Start button on `origin === 'example'`, but main.js retags an opened
    example `'template'` the moment it lands in the store and nothing in the
    current app ever writes the literal `'example'` tag -- so this path was
    UNREACHABLE. This is the one seam a `node --test` unit test cannot prove
    end to end: it can inject any origin string it likes into guide.js's
    render(), but it cannot prove that string is the one openExampleStudy()
    actually produces at runtime (cma-lessons.md lesson 36, producer/consumer
    across two files).
    """
    page.goto(index_url)
    assert page.click_text(OPEN_EXAMPLE_SELECTOR, "Open the example study")
    page.hash_nav("guide")
    # Before AUD-13 this button read "Explain the workflow" instead (the
    # not-'example'-origin fallback) -- asserting the exact label, not just
    # that SOME button exists, is what makes this a real regression check.
    assert page.text(".guide-tour-button") == "Start example walkthrough"
    assert page.click_text(".guide-tour-button", "Start example walkthrough")
    page.wait_for("document.querySelector('.guided-walkthrough-panel') !== null")
    position = page.text(".guided-walkthrough-position")
    assert position is not None
    assert position.startswith("Example walkthrough")
    assert f"Step 1 of {PRIMARY_WORKFLOW_LENGTH}" in position


def test_pause_reload_resume_keeps_the_same_cursor(page, index_url):
    page.goto(index_url)
    assert page.click_text(OPEN_EXAMPLE_SELECTOR, "Open the example study")
    page.hash_nav("guide")
    assert page.click_text(".guide-tour-button", "Start example walkthrough")
    page.wait_for("document.querySelector('.guided-walkthrough-panel') !== null")

    # Advance once so the paused cursor is not trivially step 1 of N (which a
    # bug that always resets to the first step would pass by accident).
    assert page.click("button.guided-walkthrough-next")
    page.wait_for(
        "document.querySelector('.guided-walkthrough-position')"
        f" && document.querySelector('.guided-walkthrough-position').textContent.includes('Step 2 of {PRIMARY_WORKFLOW_LENGTH}')"
    )
    position_before_pause = page.text(".guided-walkthrough-position")
    assert f"Step 2 of {PRIMARY_WORKFLOW_LENGTH}" in position_before_pause

    assert page.click("button.guided-walkthrough-pause")
    assert not page.exists(".guided-walkthrough-panel")

    page.reload()
    page.hash_nav("home")
    # Paused (not 'active'), so main.js does NOT auto-reopen the panel on
    # load -- the reader must explicitly resume it, and Home's card must
    # therefore offer "Resume walkthrough" rather than re-launching "Start".
    assert page.click_text(".home-card", "Resume walkthrough")
    page.wait_for("document.querySelector('.guided-walkthrough-panel') !== null")
    position_after_resume = page.text(".guided-walkthrough-position")
    assert position_after_resume == position_before_pause


def test_edit_then_start_blank_study_preserves_the_edit_in_restore(page, index_url):
    """AUD-08's flushAutosave-before-replace fix: without it, a pending
    500ms-debounced autosave timer survived store.replace() in
    startBlankStudy() and fired AFTERWARD, reading the (by then blank) store
    and persisting the wrong study -- while Settings' own confirm dialog and
    toast both promise "Your current work remains available in Restore."
    Editing and immediately starting a blank study (no wait for the debounce)
    is deliberate: it is the exact race the fix closes.
    """
    marker = "E2E-MARKER-do-not-collapse-this-edit"
    page.goto(index_url)
    _set_research_question(page, marker)
    # Auto-accept the window.confirm() Settings' "Start a blank study" button
    # guards itself with -- orthogonal to the fix under test here.
    page.eval_js("window.confirm = () => true;")

    page.hash_nav("settings")
    assert page.click_text("button.copy-button", "Start a blank study")
    page.wait_for(
        "document.querySelector('.shell-status')"
        " && document.querySelector('.shell-status').textContent.includes('Started a blank study')"
    )

    page.hash_nav("home")
    current_value = page.eval_js(
        "(() => { const el = document.getElementById('study-map-research-question'); return el ? el.value : null; })()"
    )
    assert current_value == "", "the live study must now be the fresh blank one, not the edited one"
    assert _local_storage_contains(page, marker), "the edited study must still be recoverable from Restore"


def test_clear_all_reports_truthfully(page, index_url):
    """AUD-01's clearAllStoredData must not claim success unless it actually
    cleared the ring AND re-saved the currently open study -- this drives
    the real two-click armed button (settings.js has no window.confirm() for
    this one, deliberately: clearing removes the restore ring itself) and
    reads the real toast plus the real post-clear Restore list, rather than
    asserting on a directly-called function's return value.
    """
    page.goto(index_url)

    def wait_for_saved():
        page.wait_for(
            "document.querySelector('.shell-save-indicator')"
            " && document.querySelector('.shell-save-indicator').textContent.includes('Saved locally')",
            timeout=10,
        )

    # Two DISTINCT autosave cycles (each waited out fully before the next
    # edit starts) produce two separate ring slots -- proving the clear
    # actually emptied more than one entry, not a no-op on an already-empty
    # ring.
    _set_research_question(page, "first edit before clearing")
    wait_for_saved()
    _set_research_question(page, "second edit before clearing")
    wait_for_saved()

    page.hash_nav("settings")
    rows_before = page.texts(".shell-restore-row")
    assert len(rows_before) >= 2

    assert page.click_text("button.settings-danger-button", "Clear all stored data")
    assert page.click_text("button.settings-danger-button", "Click again to permanently clear all stored data")

    page.wait_for(
        "document.querySelector('.shell-status')"
        " && document.querySelector('.shell-status').textContent.includes("
        "'Cleared all locally stored data. Your open study is unaffected, and saving has resumed.')"
    )
    rows_after = page.texts(".shell-restore-row")
    # clearAllStoredData wipes every ring slot, then re-saves the study
    # currently open (never touched in memory) exactly once.
    assert len(rows_after) == 1


def test_served_artifact_has_no_static_import_or_export_statements(index_url):
    """Independent of tools/build_single_file.py's own internal gates
    (test_single_file_build.py already exercises those against synthetic
    fixtures): this fetches the bytes tools/serve_dir.py actually answers
    with for the BUILT artifact and re-checks them, because "verified live"
    against a server can lie about what was actually shipped (cma-lessons.md
    lesson 48) -- the only trustworthy check is the served artifact itself.
    """
    with urllib.request.urlopen(index_url) as resp:
        html = resp.read().decode("utf-8")

    static_import = re.compile(r"""(?m)^\s*import\s+[{*'"A-Za-z_$]""")
    export_decl = re.compile(r"(?m)^\s*export\s+(default\b|const\b|let\b|var\b|function\b|class\b|\{)")
    assert not static_import.search(html), "a static import statement survived into the served artifact"
    assert not export_decl.search(html), "a top-level export statement survived into the served artifact"
