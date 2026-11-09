#!/bin/sh
# Run Sudoku Battles on this computer and your Wi-Fi (macOS / Linux).
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js is not installed. Get 22 LTS or newer from https://nodejs.org"; exit 1; }
[ -d node_modules/ws ] || npm install --omit=dev --no-audit --no-fund || exit 1
exec node --no-warnings=ExperimentalWarning server/main.js
