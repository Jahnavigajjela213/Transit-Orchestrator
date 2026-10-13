#!/usr/bin/env bash
# One-time setup for macOS / Linux.
set -e
cd "$(dirname "$0")/.."
echo "==> Backend: creating virtual environment"
cd backend
# Needs Python 3.11-3.13. macOS ships an older python3, so prefer a versioned interpreter when present.
PY=""
for c in python3.12 python3.13 python3.11 python3; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if (3, 11) <= sys.version_info[:2] <= (3, 13) else 1)'; then PY="$c"; break; fi
done
[ -n "$PY" ] || { echo "Python 3.11, 3.12 or 3.13 is required (e.g. brew install python@3.12)"; exit 1; }
echo "    using $($PY --version)"
"$PY" -m venv .venv
. .venv/bin/activate
pip install --upgrade pip >/dev/null
pip install -r requirements.txt
[ -f .env ] || cp .env.example .env
deactivate
cd ../frontend
echo "==> Frontend: installing packages"
npm install
echo "Setup complete. Run ./scripts/start.sh"
