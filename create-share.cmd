@echo off
setlocal EnableExtensions

set "OUT=%CD%\galaxy-share"
set "ZIP=%CD%\galaxy-share.zip"

rmdir /S /Q "%OUT%" 2>nul
del /Q "%ZIP%" 2>nul
mkdir "%OUT%"

for %%D in (apps db packages scripts) do (
  if exist "%%D" (
    robocopy "%%D" "%OUT%\%%D" /E /R:0 /W:0 ^
      /XD node_modules dist build artifacts cache coverage .git .next .vite ^
      /XF *.env .env *.pem *.key *.p12 *.log >nul
  )
)

for %%F in (package.json package-lock.json README.md .gitignore .nvmrc hardhat.config.js hardhat.config.cjs hardhat.config.ts) do (
  if exist "%%F" copy /Y "%%F" "%OUT%\" >nul
)

tar -a -c -f "%ZIP%" -C "%OUT%" .
rmdir /S /Q "%OUT%"

echo.
echo Created: %ZIP%
pause