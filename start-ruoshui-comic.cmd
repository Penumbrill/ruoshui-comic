@echo off
chcp 65001 >nul
cd /d "%~dp0" || exit /b 1
if exist "%~dp0node_modules\electron\dist\electron.exe" (
  start "" "%~dp0node_modules\electron\dist\electron.exe" .
  exit /b
)
if exist "%~dp0release\win-unpacked\ruoshui-comic.exe" (
  start "" "%~dp0release\win-unpacked\ruoshui-comic.exe"
  exit /b
)
echo Ruoshui Comic was not found. Install source dependencies or use the release package.
pause
