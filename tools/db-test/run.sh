#!/usr/bin/env bash
# =============================================================================
# tools/db-test/run.sh — local test harness for the NomadCare Supabase backend.
#
# Resets two throwaway databases on a local PostgreSQL + PostGIS server and:
#   nc_test       shim (with realtime + fake pg_net/pg_cron) → every migration
#                 in order → every migration AGAIN (idempotency) → seed (twice
#                 when it is supabase/seed.sql: idempotency) → tests
#   nc_test_bare  shim (no realtime, no pg_net, no pg_cron) → supabase/setup_all.sql
#                 (bundle regenerated from the migrations) → seed → tests
# Seed = supabase/seed.sql when present, else tools/db-test/fixtures.sql.
# Parity: with supabase/seed.sql and node on PATH, tools/db-test/expected_packs.js
# builds every route × carrier pack the way the browser does (seed-core.js +
# backend-local.js) and tests.sql compares get_data_pack/build_data_pack and
# admin_kpis with it (sections 2b/2c). Without node these checks are skipped.
#
# Usage:
#   tools/db-test/run.sh [--cluster DIR] [--port N] [--pg-bin DIR] [--keep] [--quiet] [--no-parity]
#     --cluster DIR  create (initdb) / start a private cluster in DIR, stop it at the end
#     --port N       port (default 55432 with --cluster, else $PGPORT or 5432)
#     --pg-bin DIR   directory containing psql / initdb / pg_ctl (default: PATH)
#     --keep         leave the private cluster running
#     --quiet        only print failures and the summary
#     --no-parity    skip the browser-parity checks
# Without --cluster it connects with the usual PGHOST / PGPORT / PGUSER env vars
# (the user needs CREATEDB + CREATEROLE, e.g. a local superuser).
# NEVER point this at a real Supabase project: it drops databases.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
BUNDLE="$ROOT/supabase/setup_all.sql"

CLUSTER=""; PORT=""; PG_BIN=""; KEEP=0; QUIET=0; PARITY=1
while [ $# -gt 0 ]; do
  case "$1" in
    --cluster) CLUSTER="$2"; shift 2 ;;
    --port)    PORT="$2"; shift 2 ;;
    --pg-bin)  PG_BIN="$2"; shift 2 ;;
    --keep)    KEEP=1; shift ;;
    --quiet)   QUIET=1; shift ;;
    --no-parity) PARITY=0; shift ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

bin() { if [ -n "$PG_BIN" ]; then echo "$PG_BIN/$1"; else echo "$1"; fi; }
PSQL="$(bin psql)"

# temp files + (optional) private cluster are cleaned up on exit
WORK="$(mktemp -d "${TMPDIR:-/tmp}/nc-db-test.XXXXXX")"
STOP_CLUSTER=0
cleanup() {
  rm -rf "$WORK"
  if [ "$STOP_CLUSTER" -eq 1 ]; then
    "$(bin pg_ctl)" -D "$CLUSTER/data" -m fast stop >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# ------------------------------------------------------------ cluster ----
if [ -n "$CLUSTER" ]; then
  PORT="${PORT:-55432}"
  mkdir -p "$CLUSTER"
  if [ ! -f "$CLUSTER/data/PG_VERSION" ]; then
    echo "== initdb $CLUSTER/data"
    "$(bin initdb)" -D "$CLUSTER/data" -U postgres -A trust -E UTF8 --locale=C >/dev/null
  fi
  if ! "$(bin pg_ctl)" -D "$CLUSTER/data" status >/dev/null 2>&1; then
    echo "== starting PostgreSQL on port $PORT"
    "$(bin pg_ctl)" -D "$CLUSTER/data" -l "$CLUSTER/postgres.log" -w \
      -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c fsync=off -c timezone=UTC" \
      start >/dev/null   # TCP only: unix socket paths are limited to ~100 bytes
    STARTED=1
  else
    STARTED=0
  fi
  if [ "$KEEP" -eq 0 ] && [ "$STARTED" -eq 1 ]; then
    STOP_CLUSTER=1
  fi
  export PGHOST=127.0.0.1 PGPORT="$PORT" PGUSER=postgres
else
  [ -n "$PORT" ] && export PGPORT="$PORT"
fi
export PGDATABASE=postgres PGOPTIONS='-c client_min_messages=warning'

run_psql() {  # run_psql DB FILE [psql -v args…]
  local db="$1" file="$2" rc; shift 2
  if [ "$QUIET" -eq 1 ]; then
    set +e
    "$PSQL" -X -q -v ON_ERROR_STOP=1 "$@" -d "$db" -f "$file" 2>&1 | grep -vE 'NOTICE:  ok  '
    rc=${PIPESTATUS[0]}
    set -e
    return "$rc"
  fi
  "$PSQL" -X -q -v ON_ERROR_STOP=1 "$@" -d "$db" -f "$file"
}

reset_db() {
  "$PSQL" -X -q -d postgres -c "drop database if exists $1 with (force)" -c "create database $1" >/dev/null
}

seed_file() {
  if [ -f "$ROOT/supabase/seed.sql" ]; then echo "$ROOT/supabase/seed.sql"; else echo "$HERE/fixtures.sql"; fi
}
is_real_seed() { [ "$(seed_file)" = "$ROOT/supabase/seed.sql" ]; }

# ------------------------------------------- browser-side expectations ----
# TEST_VARS = extra psql -v args for tests.sql (parity input when available)
TEST_VARS=()
PARITY_NOTE="parity: off (--no-parity)"
if [ "$PARITY" -eq 1 ]; then
  if ! is_real_seed; then
    PARITY_NOTE="parity: skipped (fixtures.sql is not generated from seed-core.js)"
  elif ! command -v node >/dev/null 2>&1; then
    PARITY_NOTE="parity: SKIPPED (node not found on PATH)"
  else
    # a failure here (seed files missing/inconsistent) fails the whole run
    node "$HERE/expected_packs.js" --root "$ROOT" > "$WORK/expected_packs.json"
    TEST_VARS=(-v "expected_file=$WORK/expected_packs.json")
    PARITY_NOTE="parity: on ($(node -e 'const e=require(process.argv[1]);process.stdout.write(e.pairs.length+" packs, today "+e.source.today_vn)' "$WORK/expected_packs.json") VN)"
    if [ "$QUIET" -eq 0 ]; then
      echo "== browser packs from seed-core.js (tools/db-test/expected_packs.js)"
      node "$HERE/expected_packs.js" --root "$ROOT" --summary
    fi
  fi
fi

# ------------------------------------------------------ bundle (setup_all) ----
build_bundle() {
  {
    echo "-- ============================================================================="
    echo "-- NomadCare v2 — supabase/setup_all.sql (GENERATED by tools/db-test/run.sh)"
    echo "-- = every file of supabase/migrations/ in order. Do not edit: edit the"
    echo "-- migrations and re-run the harness. Paste into Supabase > SQL Editor > Run,"
    echo "-- then run supabase/seed.sql. Safe to run again (idempotent)."
    echo "-- ============================================================================="
    for f in "$MIG_DIR"/*.sql; do
      echo
      echo "-- >>> $(basename "$f")"
      cat "$f"
    done
  } > "$BUNDLE"
}

FAILED=0
step() { echo; echo "######## $*"; }

# --------------------------------------------------------- full database ----
step "nc_test: shim + migrations x2 + seed ($(basename "$(seed_file)"))$(is_real_seed && echo ' x2') + tests"
reset_db nc_test
run_psql nc_test "$HERE/supabase_shim.sql" -v with_realtime=on -v with_fakes=on
for pass in 1 2; do
  for f in "$MIG_DIR"/*.sql; do
    [ "$QUIET" -eq 1 ] || echo "-- [$pass] $(basename "$f")"
    run_psql nc_test "$f"
  done
done
run_psql nc_test "$(seed_file)"
if is_real_seed; then
  run_psql nc_test "$(seed_file)"   # re-run: the generated seed must be idempotent
fi
PGOPTIONS='-c client_min_messages=notice' run_psql nc_test "$HERE/tests.sql" -v with_fakes=on ${TEST_VARS[@]+"${TEST_VARS[@]}"} || FAILED=1

# --------------------------------------------------------- bare database ----
step "nc_test_bare: shim (no realtime/pg_net/pg_cron) + setup_all.sql + seed + tests"
build_bundle
reset_db nc_test_bare
run_psql nc_test_bare "$HERE/supabase_shim.sql" -v with_realtime=off -v with_fakes=off
run_psql nc_test_bare "$BUNDLE"
run_psql nc_test_bare "$(seed_file)"
PGOPTIONS='-c client_min_messages=notice' run_psql nc_test_bare "$HERE/tests.sql" -v with_fakes=off ${TEST_VARS[@]+"${TEST_VARS[@]}"} || FAILED=1

echo
if [ "$FAILED" -eq 0 ]; then
  echo "######## DB TESTS: ALL PASSED ($PARITY_NOTE)"
else
  echo "######## DB TESTS: FAILED ($PARITY_NOTE)" >&2
fi
exit "$FAILED"
