#!/usr/bin/env bash
# Applies the stub and every migration to a fresh database, then runs the
# SQL tests. Needs a Postgres 15+ server with pg_trgm.
#   PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")"
DB=${TEST_DB:-logistics_test}
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$@"; }
run 00_supabase_stub.sql
for f in ../migrations/*.sql; do run "$f"; done
for f in test_*.sql; do echo "== $f"; run "$f" -o /dev/null; done
echo "all tests passed"
