@echo off
REM ------------------------------------------------------------------------
REM push_to_github.bat
REM A minimal Windows batch script to add, commit, and push your Git repo to GitHub.
REM Usage: Place this file in your repo root and double-click it.

REM Prompt for commit message
set /p commitMsg=Enter commit message: 
if "%commitMsg%"=="" (
    echo No commit message provided. Exiting.
    pause
    exit /b 1
)

echo.
echo >>> Staging changes...
git add .

echo.
echo >>> Committing changes...
git commit -m "%commitMsg%"
if errorlevel 1 (
    echo No changes to commit or commit failed.
    pause
    exit /b 1
)

echo.
echo >>> Pushing to GitHub...
git push origin main
if errorlevel 1 (
    echo Push failed. Check network/authentication.
    pause
    exit /b 1
)

echo.
echo Success! Your changes are now on GitHub.
pause
