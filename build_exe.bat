@echo off
REM This script is used to build the standalone executable using PyInstaller.
REM We use --onedir instead of --onefile so the app starts up extremely fast.

echo Cleaning old builds...
rmdir /s /q build
rmdir /s /q dist

echo Building executable...
python -m PyInstaller --noconfirm ^
  --onedir ^
  --windowed ^
  --paths src ^
  --add-data "app_streamlit.py;." ^
  --collect-all streamlit ^
  --collect-all bioio ^
  --hidden-import "microscopy_naming_assistant" ^
  run_main.py

echo Build complete! The executable is in the dist/run_main folder.