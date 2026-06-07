@echo off
cd /d "d:\xiangmu\nexus_chess\server"

:: Use the node that built better-sqlite3
set "NODE=C:\Users\dikdi\.workbuddy\binaries\node\versions\22.22.2\node.exe"
if not exist "%NODE%" set "NODE=node"

echo ============================================
echo   Nexus Server (persistent)
echo   Node: %NODE%
echo   Port: 3001
echo   Log:  server.log
echo ============================================

:loop
echo [%date% %time%] Starting server...
"%NODE%" "node_modules\tsx\dist\cli.mjs" "src\index.ts" >> server.log 2>&1
echo [%date% %time%] Server crashed, restarting in 3s...
timeout /t 3 /nobreak >nul
goto loop
