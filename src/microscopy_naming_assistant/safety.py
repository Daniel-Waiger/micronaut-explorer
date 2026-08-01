from __future__ import annotations

import os
import sys
from collections.abc import Callable
from pathlib import Path

from .validation import ValidationIssue

# --- Cloud-sync detection ---------------------------------------------------
#
# Path-heuristic detection of a cloud-sync provider's root/mirror folder.
# Deliberately matched against a WHOLE path component (case-insensitively),
# never a substring: a folder merely NAMED e.g. "my_dropbox_notes" must not
# be misdetected as a sync root just because "dropbox" appears in it. This
# repo itself lives under a path containing the "My Drive" component (Google
# Drive for desktop / File Stream mounts its sync root under that exact
# folder name), so this condition is real, not hypothetical.
#
# OneDrive's business/school variant renames the folder "OneDrive - <Org>",
# so that provider gets a prefix match instead of a pure exact match; every
# other provider below is an exact, whole-component match.


def _matches_google_drive(component: str) -> bool:
    return component in {"google drive", "googledrive", "my drive"}


def _matches_onedrive(component: str) -> bool:
    return component == "onedrive" or component.startswith("onedrive - ")


def _matches_dropbox(component: str) -> bool:
    return component == "dropbox"


def _matches_icloud(component: str) -> bool:
    # "iCloudDrive" (no space) is the Windows iCloud client's folder name;
    # "iCloud Drive" covers a spaced variant seen in some docs/UIs; the
    # "com~apple~clouddocs" component is macOS's actual on-disk folder name
    # under ~/Library/Mobile Documents.
    return component in {"iclouddrive", "icloud drive", "com~apple~clouddocs"}


_PROVIDER_MATCHERS: tuple[tuple[str, Callable[[str], bool]], ...] = (
    ("Google Drive", _matches_google_drive),
    ("OneDrive", _matches_onedrive),
    ("Dropbox", _matches_dropbox),
    ("iCloud", _matches_icloud),
)


def detect_cloud_sync_root(path: Path) -> str | None:
    """Return the cloud-sync provider's display name if `path` sits under a
    recognized sync-root folder component, else None.

    Cheap and pure: string comparisons over `path.parts` only, no filesystem
    or network access, so it can never hang and never raises on a well-formed
    Path. Ancestor components are checked (not just the immediate parent)
    because the sync root is usually several levels above the file, e.g.
    `.../My Drive/FACSI/Image Analysis/.../file.tif`.
    """
    for component in path.parts:
        folded = component.casefold()
        for provider, matches in _PROVIDER_MATCHERS:
            if matches(folded):
                return provider
    return None


# --- Lock / read-only detection ---------------------------------------------


def probe_is_read_only(path: Path) -> bool:
    """Best-effort: is `path` currently read-only for this process?

    Uses `os.access` rather than opening the file, so it never touches file
    contents. NEVER raises: any unexpected failure from the OS call itself
    degrades to "not known to be read-only" (no warning) rather than
    propagating, per this module's cheap-and-never-raise contract.
    """
    try:
        return path.exists() and not os.access(path, os.W_OK)
    except Exception:
        return False


# Win32 error codes (from winerror.h). Only ERROR_SHARING_VIOLATION indicates
# what this probe actually claims to detect -- "something else holds this
# file open in a way that conflicts with an exclusive open". Every other
# failure `CreateFileW` can return (file/path not found, access denied on a
# directory, a bad UNC/network path, ...) means the probe couldn't determine
# lock status at all and must degrade to "not locked", not be conflated with
# a real lock.
#
# ERROR_LOCK_VIOLATION (33) was considered and deliberately EXCLUDED: it is
# the error `ReadFile`/`WriteFile` return when a call touches a byte range
# another handle locked via `LockFileEx`. `CreateFileW` itself does not fail
# with 33 for a whole-file, share-mode-based open -- range locks are enforced
# at I/O time, not at open time -- so this probe (which only opens and
# immediately closes) has no evidence code 33 would ever legitimately mean
# "locked" here. Treating it as locked would be guessing, and this module's
# contract for an unknown/undiagnosed failure is False, not a bogus warning.
_ERROR_SHARING_VIOLATION = 32


def _win32_exclusive_open_probe(path_str: str) -> bool:
    """Attempt a Win32 `CreateFileW` with `dwShareMode=0` (request exclusive
    access, denying all sharing).

    This is the reliable in-process lock probe the plan calls for: Windows'
    sharing-violation check runs both ways -- a new open whose OWN share mode
    denies access types already granted to an existing handle fails with
    `ERROR_SHARING_VIOLATION`, even if that existing handle itself was opened
    permissively (as plain Python `open()`/`os.open()` are by default, which
    is why those calls cannot detect this). Verified empirically: opening the
    same file a second time with `dwShareMode=0` while a plain `open()`
    handle is still held elsewhere raises `ERROR_SHARING_VIOLATION` (32);
    after that handle is closed, the same probe succeeds.

    A failed open is reported as "locked" ONLY when the Win32 error is
    exactly `ERROR_SHARING_VIOLATION` (32) -- see `_ERROR_SHARING_VIOLATION`
    above for why 33 is excluded and every other code degrades to False.
    Without this check, ANY invalid-handle failure (nonexistent path -> 2/3,
    a directory -> 5, a bad UNC path -> 53, ...) was being reported as
    "locked", which is the defect this check exists to fix.

    The DLL is loaded with `use_last_error=True` and the code is read back
    via `ctypes.get_last_error()` (a ctypes-managed, thread-local copy of the
    real `GetLastError()` captured immediately after the call) rather than
    calling the ambient `kernel32.GetLastError()` separately, which could be
    clobbered by any intervening call (e.g. this function's own `CloseHandle`
    on an unrelated code path, or anything else running on the thread).

    Returns True if the exclusive open failed with a genuine sharing
    violation (file is locked/in-use by something holding it open), False
    otherwise -- including when it succeeded (and is immediately closed
    again -- this probe never keeps a handle open) or failed for any other,
    non-lock reason.
    """
    import ctypes
    from ctypes import wintypes

    generic_read = 0x80000000
    generic_write = 0x40000000
    open_existing = 3
    file_attribute_normal = 0x80

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create_file_w = kernel32.CreateFileW
    create_file_w.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    ]
    create_file_w.restype = wintypes.HANDLE
    invalid_handle_value = ctypes.c_void_p(-1).value

    handle = create_file_w(
        path_str,
        generic_read | generic_write,
        0,  # dwShareMode = 0: request exclusive access (deny all sharing)
        None,
        open_existing,
        file_attribute_normal,
        None,
    )
    if handle is None or handle == invalid_handle_value:
        error = ctypes.get_last_error()
        return error == _ERROR_SHARING_VIOLATION
    kernel32.CloseHandle(handle)
    return False


def probe_is_locked(path: Path) -> bool:
    """Best-effort: is `path` currently open/locked by another process in a
    way that would block a rename?

    On Windows this uses `_win32_exclusive_open_probe` (see its docstring for
    the mechanism). Off Windows there is no cheap, reliable, non-invasive
    equivalent (POSIX file locks are advisory and not held by default), so
    this degrades to "not known to be locked" rather than guessing -- that is
    an accepted limitation of a cheap, non-blocking, never-raise check, not a
    correctness bug.

    NEVER raises: any OSError/unexpected exception (including "no such
    file") degrades to "not known to be locked" (no warning) rather than
    propagating.
    """
    if sys.platform != "win32":
        return False
    try:
        return _win32_exclusive_open_probe(str(path))
    except Exception:
        return False


def check_source_safety(path: Path) -> list[ValidationIssue]:
    """Cheap, never-raising safety probes for a single planned rename source.

    Returns WARNING-severity `ValidationIssue`s only -- this function never
    blocks a plan; the caller decides what to do with the warnings (surface
    them in the preview/report, let the user proceed anyway). Each probe is
    independently guarded: if a probe itself raises (e.g. because a caller
    monkeypatches it to simulate an unexpected OS failure), that probe's
    warning is simply omitted rather than the whole check failing or an
    exception propagating up into plan/preview generation.

    Read-only and "locked by another process" are reported as distinct,
    mutually exclusive conditions (checked in that order) so a single root
    cause (permission denied) doesn't surface as two overlapping warnings.
    """
    issues: list[ValidationIssue] = []

    try:
        read_only = probe_is_read_only(path)
    except Exception:
        read_only = False

    if read_only:
        issues.append(
            ValidationIssue(
                field="source",
                message=(
                    f"'{path.name}' is read-only; renaming may fail until its "
                    "permissions are changed."
                ),
                severity="warning",
            )
        )
    else:
        try:
            locked = probe_is_locked(path)
        except Exception:
            locked = False

        if locked:
            issues.append(
                ValidationIssue(
                    field="source",
                    message=(
                        f"'{path.name}' appears to be open in another program; "
                        "renaming may fail while it is in use."
                    ),
                    severity="warning",
                )
            )

    try:
        provider = detect_cloud_sync_root(path)
    except Exception:
        provider = None

    if provider:
        issues.append(
            ValidationIssue(
                field="source",
                message=(
                    f"'{path.name}' is inside a {provider} sync folder; renaming may "
                    "propagate remotely or race with the sync client."
                ),
                severity="warning",
            )
        )

    return issues
