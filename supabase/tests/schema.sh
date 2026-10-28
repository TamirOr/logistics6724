#!/usr/bin/env bash
# Creates a fresh database from the auth stub and every migration.
#   PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/schema.sh <database>
set -euo pipefail
cd "$(dirname "$0")"
DB=$1
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$@"; }
run 00_supabase_stub.sql
for f in ../migrations/*.sql; do run "$f"; done
