@echo off
REM One-command runner shim for Windows CMD/PowerShell
setlocal enabledelayedexpansion

REM Prefer PowerShell if available
where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1"
  exit /b %ERRORLEVEL%
) else (
  where powershell >nul 2>nul
  if %ERRORLEVEL%==0 (
    powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1"
    exit /b %ERRORLEVEL%
  ) else (
    echo PowerShell is required to run this script. >&2
    exit /b 1
  )
)


