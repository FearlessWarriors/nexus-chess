@echo off
title Nexus Chess

echo ============================================
echo   Nexus Chess - Quick Start
echo ============================================
echo.

echo [1/2] Starting game server...
start "Nexus-Server" cmd /c "cd /d d:\xiangmu\nexus_chess\server && npx tsx src/index.ts"

echo [2/2] Starting frontend...
start "Nexus-Frontend" cmd /c "cd /d d:\xiangmu\nexus_chess\frontend && npx vite --host"

echo.
echo ============================================
echo   Ready!
echo   Frontend : http://localhost:5173
echo   Backend  : http://localhost:3001
echo ============================================
pause
