@echo off
title Nexus DQN — Live Training from Human Games

echo ============================================
echo   Nexus DQN Live Training
echo   Learns from human games on the platform
echo   Runs continuously, polls every 30s
echo ============================================
echo.

cd /d "d:\xiangmu\nexus_chess\ai"
set PYTHON=C:\Users\dikdi\AppData\Local\Programs\Python\Python311\python.exe

%PYTHON% -m dqn.live_train

pause
