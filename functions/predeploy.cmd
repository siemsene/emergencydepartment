@echo off
setlocal

call npm --prefix functions run lint
if errorlevel 1 exit /b 1

call npm --prefix functions run build
if errorlevel 1 exit /b 1

exit /b 0
