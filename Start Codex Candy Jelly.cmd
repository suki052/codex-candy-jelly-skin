@echo off
setlocal
cd /d "%~dp0windows"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\start-dream-skin.ps1" -PromptRestart
if errorlevel 1 pause
