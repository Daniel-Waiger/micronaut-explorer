"""Native folder-picker dialog, run as its own process.

Tkinter's event loop must own the main thread of whatever process it runs in.
Streamlit executes the app script on a ScriptRunner *worker* thread, so calling
tkinter inline from the app raises `RuntimeError: main thread is not in main
loop`. Spawning this module as a subprocess gives the dialog a real main
thread; the selected path comes back on stdout, and an empty stdout means the
user cancelled.

Run directly (not with `-m`) so it works regardless of whether the package is
importable in the child's environment:

    python folder_picker.py [initial_dir]
"""

from __future__ import annotations

import sys


def main() -> int:
    import tkinter as tk
    from tkinter import filedialog

    initial_dir = sys.argv[1] if len(sys.argv) > 1 else ""

    # A merely withdrawn root is not enough to get the dialog in front of the
    # browser: an unmapped window can't take focus, so the dialog inherits none
    # and opens behind whatever the user was looking at. Since the app blocks
    # while the dialog is up, a hidden dialog is indistinguishable from a hang.
    # Instead keep a fully transparent 1x1 always-on-top root, map it, force
    # focus onto it, and parent the dialog to that.
    root = tk.Tk()
    root.attributes("-alpha", 0.0)
    root.attributes("-topmost", True)
    root.geometry("1x1+0+0")
    root.deiconify()
    root.lift()
    root.focus_force()
    root.update()

    try:
        selected = filedialog.askdirectory(
            parent=root, initialdir=initial_dir or None, mustexist=True
        )
    finally:
        root.destroy()

    if selected:
        sys.stdout.write(selected)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
