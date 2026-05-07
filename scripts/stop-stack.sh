#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PIDS="$ROOT/.stack-pids"
for f in "$PIDS"/*.pid; do
  [ -f "$f" ] || continue
  pid=$(cat "$f")
  kill -TERM "$pid" 2>/dev/null || true
  rm -f "$f"
done
echo "[stack] stopped"
