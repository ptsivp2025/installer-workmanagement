#!/usr/bin/env bash
# Database tests: applies every migration (001 → latest) to a throwaway local
# PostgreSQL, then runs tests.sql, which calls the real functions as the
# `anon` role with JWT claims set, the way PostgREST does.
#
# Needs PostgreSQL 15+ binaries (Ubuntu: apt install postgresql).
# Usage: npm run test:db
set -euo pipefail
cd "$(dirname "$0")/../.."

PGBIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)
[ -n "$PGBIN" ] || { echo "PostgreSQL binaries not found (apt install postgresql)"; exit 1; }
DIR=$(mktemp -d /var/tmp/iwm-dbtest.XXXXXX)
PORT=${PORT:-55439}
AS_PG=""; [ "$(id -u)" = "0" ] && { chown postgres "$DIR"; AS_PG="su postgres -c"; }
run_pg() { if [ -n "$AS_PG" ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
cleanup() { run_pg "$PGBIN/pg_ctl -D $DIR/data stop -m fast" >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT

run_pg "$PGBIN/initdb -D $DIR/data -A trust -U postgres" >/dev/null
run_pg "$PGBIN/pg_ctl -D $DIR/data -o '-p $PORT -k /tmp' -l $DIR/log start -w" >/dev/null
PSQL="psql -h /tmp -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -c "create database iwm"
$PSQL -d iwm -f scripts/db-test/supabase-stubs.sql

for f in supabase/migrations/*.sql; do
  $PSQL -d iwm -f "$f" >/dev/null 2>"$DIR/err" || { echo "✗ migration $(basename "$f") failed:"; cat "$DIR/err"; exit 1; }
done
echo "✓ migrations 001 → $(ls supabase/migrations | tail -1 | cut -d_ -f1) applied"

$PSQL -d iwm -f scripts/db-test/tests.sql 2>&1 | grep -E "^(psql:|NOTICE:  (✓|✗))" | sed 's/^NOTICE:  //;s/^psql:.*ERROR:  /✗ /'
