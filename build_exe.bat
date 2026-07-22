@echo off
REM This script is used to build the standalone executable using PyInstaller.
REM We use --onedir instead of --onefile so the app starts up extremely fast.

echo Cleaning old builds...
rmdir /s /q dist

set TEMP_BUILD_DIR=%TEMP%\mna_build
echo Building in a temporary local directory to avoid Google Drive sync locks: %TEMP_BUILD_DIR%

python -m PyInstaller --clean --noconfirm ^
  --onedir ^
  --windowed ^
  --paths src ^
  --add-data "app_streamlit.py;." ^
  --collect-all streamlit ^
  --collect-all bioio ^
  --hidden-import "microscopy_naming_assistant" ^
  --workpath "%TEMP_BUILD_DIR%\build" ^
  --distpath "%TEMP_BUILD_DIR%\dist" ^
  run_main.py

echo Copying the final build back to the project folder...
mkdir dist
xcopy /E /I /Y "%TEMP_BUILD_DIR%\dist\run_main" "dist\run_main"

echo Renaming executable...
rename dist\run_main\run_main.exe MicroscopyNamingAssistant.exe

echo Build complete! The executable is in the dist/run_main folder.