#!/usr/bin/env bash
# Start LaTeX Studio (builds the web app and the Python environment on first run).
set -euo pipefail
cd "$(dirname "$0")"
[ -d .venv ] || { python3 -m venv .venv && .venv/bin/pip install -q -e .; }
[ -d web/dist ] || (cd web && npm install --silent && npm run build)
exec .venv/bin/python -m latexstudio "$@"
