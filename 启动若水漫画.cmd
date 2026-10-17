@echo off
chcp 65001 >nul
cd /d "%~dp0" || exit /b 1
if exist "%~dp0node_modules\electron\dist\electron.exe" (
  start "" "%~dp0node_modules\electron\dist\electron.exe" .
  exit /b
)
if exist "%~dp0release\win-unpacked\若水漫画.exe" (
  start "" "%~dp0release\win-unpacked\若水漫画.exe"
  exit /b
)
echo 未找到若水漫画客户端。请确认文件完整，或在源码目录安装依赖后运行。
pause
