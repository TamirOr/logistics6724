#!/usr/bin/env bash
# Applies the stub and every migration to a fresh database, then runs the
# SQL tests. Needs a Postgres 15+ server with pg_trgm.
#   PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")"
DB=${TEST_DB:-logistics_test}
./schema.sh "$DB"
echo "== seed_battalion.sql"; psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f seed_battalion.sql -o /dev/null
for f in test_*.sql; do echo "== $f"; psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$f" -o /dev/null; done
echo "all tests passed"
