#!/usr/bin/env bash
# Start Postgres and/or Redis inside a ServerHoster CI job.
#
# ServerHoster runs CI in one unprivileged Docker container with no service
# containers and no apt, so the GitHub Actions `services:` block has no direct
# equivalent. This fetches the servers from conda-forge (cached in /cache
# between runs) and starts them on localhost with the usual ports.
#
#   .survhub/services.sh postgres=16 pguser=app pgpassword=app pgdb=app redis
#
# Later steps run `. /tmp/ci-services.env` to get psql / redis-cli on PATH.
set -euo pipefail

MAMBA_VERSION=2.9.0-0
MAMBA_SHA256=366cd9cd8be14df1ab8ed50352a82111082a36686b2d389fdb79a92c3fafb3e3
PG_VERSION="" PG_USER=postgres PG_PASSWORD=postgres PG_DB="" REDIS=0
for arg in "$@"; do
  case "$arg" in
    postgres=*) PG_VERSION=${arg#*=} ;;
    pguser=*) PG_USER=${arg#*=} ;;
    pgpassword=*) PG_PASSWORD=${arg#*=} ;;
    pgdb=*) PG_DB=${arg#*=} ;;
    redis) REDIS=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

ROOT=/cache/ci-services
mkdir -p "$ROOT" 2>/dev/null && [ -w "$ROOT" ] || ROOT=/tmp/ci-services
mkdir -p "$ROOT/bin" /tmp/ci-bin
MAMBA="$ROOT/bin/micromamba-$MAMBA_VERSION"
if [ ! -x "$MAMBA" ]; then
  curl -fsSL -o "$MAMBA.part" \
    "https://github.com/mamba-org/micromamba-releases/releases/download/$MAMBA_VERSION/micromamba-linux-64"
  echo "$MAMBA_SHA256  $MAMBA.part" | sha256sum -c --quiet
  chmod +x "$MAMBA.part" && mv "$MAMBA.part" "$MAMBA"
fi

specs=(nss_wrapper)
[ -n "$PG_VERSION" ] && specs+=("postgresql=$PG_VERSION")
[ "$REDIS" = 1 ] && specs+=(redis-server)
PREFIX="$ROOT/env-$(printf '%s ' "${specs[@]}" | sha256sum | cut -c1-12)"
if [ ! -e "$PREFIX/.ready" ]; then
  rm -rf "$PREFIX"
  MAMBA_ROOT_PREFIX="$ROOT/mamba" "$MAMBA" create -y -q -p "$PREFIX" \
    -c conda-forge --override-channels "${specs[@]}" >/dev/null
  touch "$PREFIX/.ready"
fi

# The job's uid has no /etc/passwd entry, and initdb refuses to run without one.
uid=$(id -u) gid=$(id -g)
echo "ci:x:$uid:$gid:ci:/tmp:/bin/sh" > /tmp/ci-passwd
echo "ci:x:$gid:" > /tmp/ci-group
cat > /tmp/ci-services.env <<ENV
export PATH="/tmp/ci-bin:\$PATH"
ENV
wrap() { # put a server tool on PATH with the passwd shim loaded
  cat > "/tmp/ci-bin/$1" <<SH
#!/bin/sh
LD_PRELOAD="$PREFIX/lib/libnss_wrapper.so" NSS_WRAPPER_PASSWD=/tmp/ci-passwd NSS_WRAPPER_GROUP=/tmp/ci-group exec "$PREFIX/bin/$1" "\$@"
SH
  chmod +x "/tmp/ci-bin/$1"
}

if [ -n "$PG_VERSION" ]; then
  for tool in initdb pg_ctl postgres psql pg_isready pg_dump createdb; do wrap "$tool"; done
  echo "$PG_PASSWORD" > /tmp/ci-pgpass
  /tmp/ci-bin/initdb -D /tmp/ci-pgdata -U "$PG_USER" --pwfile=/tmp/ci-pgpass \
    --auth=md5 --auth-local=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
  /tmp/ci-bin/pg_ctl -D /tmp/ci-pgdata -l /tmp/ci-postgres.log -w start \
    -o "-c listen_addresses=localhost -p 5432 -k /tmp -c fsync=off -c synchronous_commit=off -c full_page_writes=off" >/dev/null
  if [ -n "$PG_DB" ]; then
    /tmp/ci-bin/psql -h /tmp -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 -qtAc \
      "SELECT 1 FROM pg_database WHERE datname = '$PG_DB'" | grep -q 1 \
      || /tmp/ci-bin/psql -h /tmp -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 -qc "CREATE DATABASE \"$PG_DB\""
  fi
  echo "Postgres $("$PREFIX/bin/postgres" --version | awk '{print $3}') on localhost:5432 (user $PG_USER)"
fi

if [ "$REDIS" = 1 ]; then
  wrap redis-server; wrap redis-cli
  /tmp/ci-bin/redis-server --daemonize yes --port 6379 --bind 127.0.0.1 --save '' \
    --appendonly no --dir /tmp --logfile /tmp/ci-redis.log
  for _ in $(seq 1 50); do /tmp/ci-bin/redis-cli ping >/dev/null 2>&1 && break; sleep 0.1; done
  /tmp/ci-bin/redis-cli ping >/dev/null
  echo "Redis $("$PREFIX/bin/redis-server" --version | awk '{print $3}' | sed 's/^v=//') on localhost:6379"
fi
