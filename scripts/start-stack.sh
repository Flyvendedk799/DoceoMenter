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
# One secret and one credential store across both processes, or the worker cannot read a
# subscription the browser connected. Deterministic for e2e: no machine login is consulted, so
# a developer's own `claude` session cannot change what the tests see.
export DOCEOMENTER_SECRET_KEY=${DOCEOMENTER_SECRET_KEY:-doceomenter-local-dev-secret}
export CREDENTIALS_DIR=${CREDENTIALS_DIR:-/tmp/doceomenter-credentials}
export ALLOW_LOCAL_CLI=${ALLOW_LOCAL_CLI:-false}

# Is Redis already listening?
#
# This used to ask `redis-cli`, which is not installed on a CI runner — so a perfectly healthy
# service container read as absent, the fallback reached for a `redis-server` that is not
# installed either, and the job died with "command not found". A bare TCP connect asks the only
# question that matters and needs nothing installed.
redis_target=${REDIS_URL#*://}
redis_target=${redis_target%%/*}
redis_host=${redis_target%%:*}
redis_port=${redis_target##*:}
[ "$redis_port" = "$redis_host" ] && redis_port=6379
[ -n "$redis_host" ] || redis_host=127.0.0.1

if (exec 3<>"/dev/tcp/$redis_host/$redis_port") 2>/dev/null; then
  echo "[stack] redis already listening on $redis_host:$redis_port"
elif command -v redis-server >/dev/null 2>&1; then
  echo "[stack] starting redis"
  redis-server --daemonize yes --dir /tmp --logfile /tmp/redis.log --port "$redis_port"
  sleep 0.5
else
  # Better than launching nothing and failing later inside the worker, where the message is
  # about a connection refused rather than about Redis being missing.
  echo "[stack] no redis listening on $redis_host:$redis_port, and no redis-server to start" >&2
  exit 1
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
