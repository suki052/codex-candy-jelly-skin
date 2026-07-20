@echo off
setlocal
cd /d "%~dp0windows"
echo Codex Candy Jelly Skin - install or update
echo.
echo Save unsent input and close every Codex window before continuing.
echo Official Codex files are not modified.
echo.
pause
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\install-dream-skin.ps1"
if errorlevel 1 goto :failed
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\start-dream-skin.ps1" -PromptRestart
if errorlevel 1 goto :failed
echo.
echo Codex Candy Jelly Skin is installed and active.
pause
exit /b 0
:failed
echo.
echo Installation or launch failed. Official Codex files were not modified.
pause
exit /b 1
