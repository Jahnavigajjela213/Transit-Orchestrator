@echo off
REM Opens two windows: backend on :8000 and frontend on :5173
cd /d "%~dp0\.."
start "Orchestrator backend" cmd /k "cd backend && .venv\Scripts\activate.bat && python run.py"
start "Orchestrator frontend" cmd /k "cd frontend && npm run dev"
echo Backend  http://localhost:8000/docs
echo Frontend http://localhost:5173
