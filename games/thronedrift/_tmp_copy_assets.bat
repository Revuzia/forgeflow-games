@echo off
set SRC=%~dp0assets
set DEST=F:\GrokUI\projects\default\public\assets
echo SRC=%SRC%
echo DEST=%DEST%
if not exist "F:\GrokUI\projects\default" (
  echo F project missing
  exit /b 2
)
mkdir "%DEST%" 2>nul
xcopy /E /I /Y "%SRC%\*" "%DEST%\"
echo DONE
dir /s /b "%DEST%" | find /c /v ""
