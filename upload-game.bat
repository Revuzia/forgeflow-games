@echo off
REM ForgeFlow Games — one-click uploader. Double-click this file.
REM Works from wherever the repo lives (this PC or a friend's), no setup baked in.
title ForgeFlow Games - Upload
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install it from https://www.python.org/downloads/ ^(check "Add to PATH"^), then run this again.
  echo.
  pause
  exit /b 1
)
python upload_game.py %*
echo.
echo ------------------------------------------------------------
echo Done. You can close this window.
pause
