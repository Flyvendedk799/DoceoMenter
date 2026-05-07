#!/usr/bin/env bash
# Start the full DoceoMenter stack for local dev / e2e tests.
# - Redis (if not already running)
# - Worker
# - Next.js dev server
# Pids are stored under .stack-pids/ so stop-stack.sh can clean up.

set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PIDS="$ROOT/.stack-pids"
mkdir -p "$PIDS"

export PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}
export DATA_ROOT=${DATA_ROOT:-/tmp/doceomenter-runs}
export REDIS_URL=${REDIS_URL:-redis://127.0.0.1:6379}
export PORT=${PORT:-3010}

if ! redis-cli -u "$REDIS_URL" ping >/dev/null 2>&1; then
  echo "[stack] starting redis"
  redis-server --daemonize yes --dir /tmp --logfile /tmp/redis.log --port 6379
  sleep 0.5
fi

echo "[stack] starting worker"
( cd "$ROOT/apps/worker" && node dist/index.js > /tmp/doceomenter-worker.log 2>&1 ) &
echo $! > "$PIDS/worker.pid"

echo "[stack] starting web"
( cd "$ROOT/apps/web" && pnpm next dev -p "$PORT" > /tmp/doceomenter-web.log 2>&1 ) &
echo $! > "$PIDS/web.pid"

echo "[stack] waiting for http://127.0.0.1:$PORT"
for i in {1..60}; do
  if curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT" 2>/dev/null | grep -q 200; then
    echo "[stack] up"
    exit 0
  fi
  sleep 1
done
echo "[stack] web did not become ready in time"
exit 1
