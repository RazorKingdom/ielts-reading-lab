@echo off
REM Launch IELTS Reading Lab (Windows).
REM Electron-based terminals (e.g. WorkBuddy) may inject ELECTRON_RUN_AS_NODE=1,
REM which makes the bundled electron.exe behave as plain Node instead of a desktop app.
set "ELECTRON_RUN_AS_NODE="
cd /d "%~dp0.."
call npm start
pause
