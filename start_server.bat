@echo off
rem Start the History Atlas on Windows (no dependencies required).
rem Prefers serve.ps1 (it also persists Marker-Editor changes to disk).
start "" http://localhost:8123/
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" 8123
