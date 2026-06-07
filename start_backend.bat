@echo off
REM Start Nexus Chess backend + tunnel (persistent)
REM Double-click this file to run

cd /d D:\xiangmu\nexus_chess
powershell -ExecutionPolicy Bypass -File nexus_server.ps1
pause
