@echo off
:: iRonWaves Print Agent - Windows One-Click Installer Launcher
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
pause
