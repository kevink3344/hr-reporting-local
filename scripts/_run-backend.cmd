@echo off
REM Backend dev server launcher.
REM Started by the "HR-Reporting-Backend" scheduled task so it runs outside the
REM VS Code terminal job object (terminal-launched children get reaped with the
REM terminal, and inherit its console -- a Ctrl+C there kills them mid-run).
cd /d "%~dp0.."
npm run dev > ".logs\backend.log" 2>&1
