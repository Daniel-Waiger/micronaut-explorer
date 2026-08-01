from __future__ import annotations

import stat
import sys
from pathlib import Path

import pytest

import microscopy_naming_assistant.safety as safety
import microscopy_naming_assistant.service as service
from microscopy_naming_assistant.config import default_config, save_config

WINDOWS_ONLY = pytest.mark.skipif(sys.platform != "win32", reason="Windows-only lock mechanism")


# --- Cloud-sync detection: real hits ----------------------------------------


def test_detects_google_drive_my_drive_component(tmp_path: Path) -> None:
    """This repo itself lives under a "My Drive" component -- the exact
    condition the plan says is real, not hypothetical."""
    f = tmp_path / "My Drive" / "FACSI" / "img.tif"
    f.parent.mkdir(parents=True)
    f.write_bytes(b"x")

    assert safety.detect_cloud_sync_root(f) == "Google Drive"


def test_detects_google_drive_literal_folder_name(tmp_path: Path) -> None:
    f = tmp_path / "Google Drive" / "img.tif"
    f.parent.mkdir(parents=True)
    f.write_bytes(b"x")

    assert safety.detect_cloud_sync_root(f) == "Google Drive"


def test_detects_onedrive(tmp_path: Path) -> None:
    f = tmp_path / "OneDrive" / "Documents" / "img.tif"
    f.parent.mkdir(parents=True)
    f.write_bytes(b"x")

    assert safety.detect_cloud_sync_root(f) == "OneDrive"


def test_detects_onedrive_business_variant(tmp_path: Path) -> None:
    f = tmp_path / "OneDrive - Acme Corp" / "img.tif"
    f.parent.mkdir(parents=True)
    f.write_bytes(b"x")

    assert safety.detect_cloud_sync_root(f) == "OneDrive"


def test_detects_dropbox(tmp_path: Path) -> None:
    f = tmp_path / "Dropbox" / "Lab" / "img.tif"
    f.parent.mkdir(parents=True)
    f.write_bytes(b"x")

    assert safety.detect_cloud_sync_root(f) == "Dropbox"


def test_detects_icloud(tmp_path: Path) -> None:
    f = tmp_path / "iCloudDrive" / "img.tif"
    f.parent.mkdir(parents=True)
    f.write_bytes(b"x")

    assert safety.detect_cloud_sync_root(f) == "iCloud"


def test_case_insensitive_match(tmp_path: Path) -> None:
    f = tmp_path / "dropbox" / "img.tif"  # lowercase
    f.parent.mkdir(parents=True)
    f.write_bytes(b"x")

    assert safety.detect_cloud_sync_root(f) == "Dropbox"


# --- Cloud-sync detection: guard against false positives -------------------


def test_plain_temp_path_produces_no_sync_warning(tmp_path: Path) -> None:
    f = tmp_path / "img.tif"
    f.write_bytes(b"x")

    assert safety.detect_cloud_sync_root(f) is None
    assert safety.check_source_safety(f) == []


def test_folder_merely_named_like_a_provider_is_not_misdetected(tmp_path: Path) -> None:
    """Matching rule: a WHOLE, casefolded path component must equal the known
    sync-root folder name (or, for OneDrive, the "OneDrive - <Org>" prefix).
    A folder that merely CONTAINS the substring "dropbox" must not match."""
    f = tmp_path / "my_dropbox_notes" / "img.tif"
    f.parent.mkdir(parents=True)
    f.write_bytes(b"x")

    assert safety.detect_cloud_sync_root(f) is None


def test_folder_containing_google_drive_substring_is_not_misdetected(tmp_path: Path) -> None:
    f = tmp_path / "not_google_drive_really" / "img.tif"
    f.parent.mkdir(parents=True)
    f.write_bytes(b"x")

    assert safety.detect_cloud_sync_root(f) is None


# --- Read-only detection -----------------------------------------------------


def test_probe_is_read_only_detects_readonly_file(tmp_path: Path) -> None:
    f = tmp_path / "img.tif"
    f.write_bytes(b"x")
    f.chmod(stat.S_IREAD)

    try:
        assert safety.probe_is_read_only(f) is True
    finally:
        # Restore write permission so pytest's tmp_path cleanup can delete it.
        f.chmod(stat.S_IWRITE | stat.S_IREAD)


def test_probe_is_read_only_false_for_writable_file(tmp_path: Path) -> None:
    f = tmp_path / "img.tif"
    f.write_bytes(b"x")

    assert safety.probe_is_read_only(f) is False


def test_check_source_safety_reports_readonly_warning(tmp_path: Path) -> None:
    f = tmp_path / "img.tif"
    f.write_bytes(b"x")
    f.chmod(stat.S_IREAD)

    try:
        issues = safety.check_source_safety(f)
    finally:
        f.chmod(stat.S_IWRITE | stat.S_IREAD)

    assert len(issues) == 1
    assert issues[0].severity == "warning"
    assert "read-only" in issues[0].message


# --- Lock detection: error-code discrimination (Windows) --------------------
#
# These tests simulate CreateFileW failing with a specific GetLastError code
# by monkeypatching ctypes.WinDLL (so _win32_exclusive_open_probe gets a fake
# kernel32 whose CreateFileW always "fails") and ctypes.get_last_error (so
# the probe reads back exactly the code under test). This proves the check
# in safety.py is genuinely load-bearing -- i.e. that it is the error CODE,
# not just handle validity, that decides the return value.


def _simulate_createfilew_failure(monkeypatch, error_code: int) -> None:
    import ctypes

    invalid_handle_value = ctypes.c_void_p(-1).value

    class _FakeKernel32:
        CreateFileW = staticmethod(lambda *args, **kwargs: invalid_handle_value)
        CloseHandle = staticmethod(lambda handle: None)

    monkeypatch.setattr(ctypes, "WinDLL", lambda *args, **kwargs: _FakeKernel32())
    monkeypatch.setattr(ctypes, "get_last_error", lambda: error_code)


@WINDOWS_ONLY
@pytest.mark.parametrize(
    "error_code,label",
    [
        (2, "ERROR_FILE_NOT_FOUND"),
        (3, "ERROR_PATH_NOT_FOUND"),
        (5, "ERROR_ACCESS_DENIED"),
        (53, "ERROR_BAD_NETPATH"),
        (33, "ERROR_LOCK_VIOLATION (deliberately excluded, see safety.py)"),
    ],
)
def test_win32_probe_non_sharing_violation_codes_are_not_locked(
    monkeypatch, error_code: int, label: str
) -> None:
    _simulate_createfilew_failure(monkeypatch, error_code=error_code)

    assert safety._win32_exclusive_open_probe("irrelevant-path.tif") is False, label


@WINDOWS_ONLY
def test_win32_probe_sharing_violation_code_is_locked(monkeypatch) -> None:
    """The one code this probe treats as a genuine lock: ERROR_SHARING_VIOLATION
    (32)."""
    _simulate_createfilew_failure(monkeypatch, error_code=32)

    assert safety._win32_exclusive_open_probe("irrelevant-path.tif") is True


# --- Lock detection: real mechanism (Windows) -------------------------------


@WINDOWS_ONLY
def test_probe_is_locked_false_when_file_is_not_open_elsewhere(tmp_path: Path) -> None:
    f = tmp_path / "img.tif"
    f.write_bytes(b"x")

    assert safety.probe_is_locked(f) is False


@WINDOWS_ONLY
def test_probe_is_locked_detects_real_exclusive_open_conflict(tmp_path: Path) -> None:
    """Proves the MECHANISM, not just a monkeypatch: Windows' sharing check
    runs both ways, so a plain `open()` handle (default, permissive sharing)
    held elsewhere still causes our exclusive-open probe (dwShareMode=0) to
    hit ERROR_SHARING_VIOLATION."""
    f = tmp_path / "img.tif"
    f.write_bytes(b"x")

    handle = open(f, "r+b")
    try:
        assert safety.probe_is_locked(f) is True
    finally:
        handle.close()

    # And once the other handle is released, the probe clears.
    assert safety.probe_is_locked(f) is False


@WINDOWS_ONLY
def test_probe_is_locked_false_for_nonexistent_path(tmp_path: Path) -> None:
    """Regression: a nonexistent path must NOT be reported as locked. Before
    the fix, CreateFileW's ERROR_FILE_NOT_FOUND/ERROR_PATH_NOT_FOUND failure
    was conflated with a genuine sharing violation."""
    missing = tmp_path / "this" / "does_not_exist_ABC123.tif"

    assert safety.probe_is_locked(missing) is False
    assert safety.check_source_safety(missing) == []


@WINDOWS_ONLY
def test_probe_is_locked_false_for_directory(tmp_path: Path) -> None:
    """Regression: CreateFileW on a directory fails with ERROR_ACCESS_DENIED
    (5), which must not be reported as a lock."""
    d = tmp_path / "a_directory"
    d.mkdir()

    assert safety.probe_is_locked(d) is False
    assert safety.check_source_safety(d) == []


@WINDOWS_ONLY
def test_probe_is_locked_false_for_simulated_bad_unc_path(monkeypatch) -> None:
    """Regression: a nonexistent UNC server (ERROR_BAD_NETPATH = 53) must not
    be reported as a lock. Simulated (not a real network call, which could
    hang on DNS/NetBIOS resolution) via the same CreateFileW/get_last_error
    monkeypatch used by the load-bearing error-code tests below."""
    _simulate_createfilew_failure(monkeypatch, error_code=53)

    bad_unc = r"\\STATION-DOES-NOT-EXIST-ABC123\share\file.tif"
    assert safety._win32_exclusive_open_probe(bad_unc) is False


@WINDOWS_ONLY
def test_check_source_safety_reports_locked_warning_via_real_open_handle(tmp_path: Path) -> None:
    f = tmp_path / "img.tif"
    f.write_bytes(b"x")

    handle = open(f, "r+b")
    try:
        issues = safety.check_source_safety(f)
    finally:
        handle.close()

    assert len(issues) == 1
    assert issues[0].severity == "warning"
    assert "open in another program" in issues[0].message


# --- Lock detection: monkeypatched probe (documents the escape hatch) ------


def test_check_source_safety_reports_locked_via_monkeypatched_probe(
    tmp_path: Path, monkeypatch
) -> None:
    """Per the plan: if the OS made true locking untestable in-process, a
    monkeypatched probe proves the code path. We already prove the real
    mechanism above on Windows; this additionally proves the aggregator
    wires probe_is_locked's result through correctly, independent of OS
    behavior."""
    f = tmp_path / "img.tif"
    f.write_bytes(b"x")

    monkeypatch.setattr(safety, "probe_is_locked", lambda path: True)

    issues = safety.check_source_safety(f)

    assert len(issues) == 1
    assert issues[0].severity == "warning"
    assert "open in another program" in issues[0].message


def test_readonly_and_locked_do_not_double_report_same_root_cause(
    tmp_path: Path, monkeypatch
) -> None:
    """read-only short-circuits the lock probe entirely (mutually exclusive
    messages for what is usually the same underlying permission problem)."""
    f = tmp_path / "img.tif"
    f.write_bytes(b"x")

    def boom(path: Path) -> bool:
        raise AssertionError("probe_is_locked must not be called when read-only")

    monkeypatch.setattr(safety, "probe_is_read_only", lambda path: True)
    monkeypatch.setattr(safety, "probe_is_locked", boom)

    issues = safety.check_source_safety(f)

    assert len(issues) == 1
    assert "read-only" in issues[0].message


# --- Degraded mode: a probe that RAISES produces no warning, no exception ---


def test_check_source_safety_swallows_raising_read_only_probe(tmp_path: Path, monkeypatch) -> None:
    f = tmp_path / "img.tif"
    f.write_bytes(b"x")

    def raiser(path: Path) -> bool:
        raise RuntimeError("simulated OS failure")

    monkeypatch.setattr(safety, "probe_is_read_only", raiser)

    issues = safety.check_source_safety(f)  # must not raise

    assert issues == []


def test_check_source_safety_swallows_raising_lock_probe(tmp_path: Path, monkeypatch) -> None:
    f = tmp_path / "img.tif"
    f.write_bytes(b"x")

    def raiser(path: Path) -> bool:
        raise RuntimeError("simulated OS failure")

    monkeypatch.setattr(safety, "probe_is_locked", raiser)

    issues = safety.check_source_safety(f)  # must not raise

    assert issues == []


def test_check_source_safety_swallows_raising_cloud_sync_probe(tmp_path: Path, monkeypatch) -> None:
    f = tmp_path / "img.tif"
    f.write_bytes(b"x")

    def raiser(path: Path) -> str | None:
        raise RuntimeError("simulated OS failure")

    monkeypatch.setattr(safety, "detect_cloud_sync_root", raiser)

    issues = safety.check_source_safety(f)  # must not raise

    assert issues == []


def test_check_source_safety_swallows_all_three_raising_probes_simultaneously(
    tmp_path: Path, monkeypatch
) -> None:
    f = tmp_path / "img.tif"
    f.write_bytes(b"x")

    def raiser(*_args, **_kwargs):
        raise RuntimeError("simulated OS failure")

    monkeypatch.setattr(safety, "probe_is_read_only", raiser)
    monkeypatch.setattr(safety, "probe_is_locked", raiser)
    monkeypatch.setattr(safety, "detect_cloud_sync_root", raiser)

    issues = safety.check_source_safety(f)  # must not raise, degrades to empty

    assert issues == []


def test_probe_is_locked_off_windows_returns_false_without_raising(
    tmp_path: Path, monkeypatch
) -> None:
    """Off-Windows there is no cheap reliable equivalent; the function must
    degrade to "not known to be locked" rather than guessing or raising."""
    f = tmp_path / "img.tif"
    f.write_bytes(b"x")

    monkeypatch.setattr(safety.sys, "platform", "linux")

    assert safety.probe_is_locked(f) is False


def test_win32_probe_raising_internally_still_degrades_to_false(
    tmp_path: Path, monkeypatch
) -> None:
    """Even if the low-level ctypes call itself blew up unexpectedly, the
    public probe_is_locked must swallow it."""
    f = tmp_path / "img.tif"
    f.write_bytes(b"x")

    def raiser(path_str: str) -> bool:
        raise OSError("simulated ctypes failure")

    monkeypatch.setattr(safety, "_win32_exclusive_open_probe", raiser)
    monkeypatch.setattr(safety.sys, "platform", "win32")

    assert safety.probe_is_locked(f) is False


@WINDOWS_ONLY
def test_probe_is_locked_never_raises_on_embedded_nul_path() -> None:
    """A path string with an embedded NUL character makes the underlying
    ctypes/Win32 call itself raise (ValueError: embedded null character);
    probe_is_locked must swallow that, not propagate it."""
    bad_path = Path("weird\x00name.tif")

    assert safety.probe_is_locked(bad_path) is False


@WINDOWS_ONLY
def test_probe_is_locked_never_raises_on_very_long_path(tmp_path: Path) -> None:
    """A path far past MAX_PATH (260 chars) without \\\\?\\ long-path prefixing
    must degrade to False, not raise."""
    long_name = "x" * 5000 + ".tif"
    long_path = tmp_path / long_name

    assert safety.probe_is_locked(long_path) is False


@WINDOWS_ONLY
def test_rename_immediately_after_probe_still_succeeds(tmp_path: Path) -> None:
    """Regression guard for 'the probe must not leak a handle or lock the
    file itself': a rename performed right after probing (no other handle
    held) must succeed -- proves the probe's own CreateFileW handle was
    actually closed."""
    f = tmp_path / "img.tif"
    f.write_bytes(b"x")

    assert safety.probe_is_locked(f) is False

    target = tmp_path / "renamed.tif"
    f.rename(target)

    assert target.exists()
    assert not f.exists()


# --- Integration: surfaced through suggest_for_file / plan preview ----------


def _fake_extract_metadata_detailed(file_path, **kwargs):
    import microscopy_naming_assistant.metadata as metadata

    return {}, {}, metadata.ExtractionDetail()


def test_suggest_for_file_surfaces_cloud_sync_warning(tmp_path: Path, monkeypatch) -> None:
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    source_dir = tmp_path / "Dropbox" / "Lab"
    source_dir.mkdir(parents=True)
    source = source_dir / "test_E1.tif"
    source.write_bytes(b"x")

    monkeypatch.setattr(service, "extract_metadata_detailed", _fake_extract_metadata_detailed)

    result = service.suggest_for_file(file_path=source, config_path=config_path)

    warnings = [i for i in result.issues if i.severity == "warning"]
    assert any("Dropbox" in i.message for i in warnings)


def test_suggest_for_file_plain_path_has_no_safety_warnings(tmp_path: Path, monkeypatch) -> None:
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    source = tmp_path / "test_E1.tif"
    source.write_bytes(b"x")

    monkeypatch.setattr(service, "extract_metadata_detailed", _fake_extract_metadata_detailed)

    result = service.suggest_for_file(file_path=source, config_path=config_path)

    assert result.issues == []


def test_safety_warnings_never_alter_planned_count_or_targets(tmp_path: Path, monkeypatch) -> None:
    """INVARIANT: warnings are additive-only. A batch of files inside a
    simulated Dropbox folder must plan and (if applied) rename identically to
    one that isn't -- same `len(planned)`, same targets, same renamed count."""
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    source_dir = tmp_path / "Dropbox"
    source_dir.mkdir()
    sources = []
    for i in range(3):
        p = source_dir / f"test_E{i}.tif"
        p.write_bytes(b"x")
        sources.append(p)

    monkeypatch.setattr(service, "extract_metadata_detailed", _fake_extract_metadata_detailed)

    suggestions = [service.suggest_for_file(file_path=p, config_path=config_path) for p in sources]
    # Every suggestion carries the cloud-sync warning...
    for s in suggestions:
        assert any("Dropbox" in i.message for i in s.issues)

    batch = service.recalculate_batch(input_dir=source_dir, suggestions=suggestions)

    # ...but planned is still strictly 1:1 with the real files, unaffected by
    # the warnings.
    assert len(batch.planned) == 3
    assert {src.name for src, _ in batch.planned} == {p.name for p in sources}

    renamed, manifest_path = service.apply_batch(source_dir, batch.planned)
    assert renamed == 3
    assert manifest_path is not None
    for _, dst in batch.planned:
        assert dst.exists()
