@echo off
setlocal
cd /d "%~dp0windows"
echo Starting with GPU acceleration disabled...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\start-dream-skin.ps1" -RestartExisting -DisableGpu
if errorlevel 1 pause
