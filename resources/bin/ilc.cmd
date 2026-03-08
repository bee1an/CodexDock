@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "APP=%SCRIPT_DIR%..\..\Ilovecodex.exe"
if not exist "%APP%" set "APP=%SCRIPT_DIR%..\..\ilovecodex.exe"

if not exist "%APP%" (
  echo Unable to locate the bundled Ilovecodex executable 1>&2
  exit /b 3
)

"%APP%" --cli %*
