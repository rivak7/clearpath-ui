#!/usr/bin/env bash
set -euo pipefail

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to run ClearPath" >&2
  exit 1
fi

npm install
npm run build

echo "\nClearPath is ready."
echo "Vite client:        http://localhost:5173"
echo "API + static server: http://localhost:8080"

echo "Starting development servers (press Ctrl+C to stop)…"
exec npm run dev
