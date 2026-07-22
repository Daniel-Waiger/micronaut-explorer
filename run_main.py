import sys
import os
import streamlit.web.cli as stcli

# Fix for Streamlit when running in windowed mode (no console)
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

def resolve_path(name):
    """Resolve the path to files bundled by PyInstaller."""
    if hasattr(sys, '_MEIPASS'):
        # PyInstaller creates a temp folder and stores path in _MEIPASS
        # But in --onedir mode, it's just the executable folder.
        return os.path.join(sys._MEIPASS, name)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), name)

if __name__ == "__main__":
    app_path = resolve_path("app_streamlit.py")
    
    # We want it to open the browser automatically, so no headless=true
    sys.argv = [
        "streamlit", 
        "run", 
        app_path, 
        "--global.developmentMode=false"
    ]
    sys.exit(stcli.main())
