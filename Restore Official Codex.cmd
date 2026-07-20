@echo off
setlocal
cd /d "%~dp0windows"
echo Restore the official Codex appearance and close the Dream Skin CDP session.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\restore-dream-skin.ps1" -RestoreBaseTheme -PromptRestart
if errorlevel 1 goto :failed
echo.
echo Official Codex appearance restored.
pause
exit /b 0

:failed
echo.
echo Restore did not complete. Review the message above before retrying.
pause
exit /b 1
