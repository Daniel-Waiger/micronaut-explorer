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
  --add-data "src;src" ^
  --collect-all streamlit ^
  --collect-all bioio ^
  --collect-all microscopy_naming_assistant ^
  --workpath "%TEMP_BUILD_DIR%\build" ^
  --distpath "%TEMP_BUILD_DIR%\dist" ^
  run_main.py

echo Renaming executable in the temp folder...
rename "%TEMP_BUILD_DIR%\dist\run_main\run_main.exe" MicroscopyNamingAssistant.exe

echo Zipping the final build...
powershell -Command "Compress-Archive -Path '%TEMP_BUILD_DIR%\dist\run_main' -DestinationPath 'MicroscopyNamingAssistant.zip' -Force"

echo Build complete! You can find MicroscopyNamingAssistant.zip in your project folder.