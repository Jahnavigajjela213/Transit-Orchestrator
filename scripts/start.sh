#!/usr/bin/env bash
# Starts backend (port 8000) and frontend (port 5173). Ctrl+C stops both.
cd "$(dirname "$0")/.."
( cd backend && . .venv/bin/activate && python run.py ) &
BACK=$!
( cd frontend && npm run dev ) &
FRONT=$!
trap "kill $BACK $FRONT 2>/dev/null" INT TERM EXIT
echo "Backend  http://localhost:8000/docs"
echo "Frontend http://localhost:5173"
wait
