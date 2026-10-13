@echo off
REM One-time setup for Windows (Command Prompt or double-click)
cd /d "%~dp0\..\backend"
echo ==^> Backend: creating virtual environment
python -m venv .venv || goto :error
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt || goto :error
if not exist .env copy .env.example .env
call deactivate
cd /d "%~dp0\..\frontend"
echo ==^> Frontend: installing packages
call npm install || goto :error
echo Setup complete. Run scripts\start.bat
goto :eof
:error
echo Setup failed. See the message above.
exit /b 1
