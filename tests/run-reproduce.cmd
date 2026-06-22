@echo off
REM ============================================================
REM Wrapper to avoid PowerShell npm stderr sensitivity
REM ============================================================
setlocal
cd /d %~dp0\..
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Continue'; & '%~dp0\reproduce-license-block.ps1'"
endlocal
