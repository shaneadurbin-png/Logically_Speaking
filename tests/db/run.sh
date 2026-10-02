#!/usr/bin/env bash
# run.sh - apply the migrations and seed to a throwaway database on the local
# Postgres 16 (with the Supabase stub), then run every supabase/tests/*.sql
# and fail on any "not ok". Usage: tests/db/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
# With PGURL set (postgresql://user:pass@host:port, no database) it talks to that
# server over TCP, as CI does with a postgres:16 service; otherwise it uses the
# local Debian cluster as the postgres user.
DB=grcost_test
psql_db() { if [ -n "${PGURL:-}" ]; then psql -X -q -v ON_ERROR_STOP=1 "$PGURL/$DB" "$@"; else su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB $*"; fi; }
run() { psql_db -f - < "$1"; }
if [ -n "${PGURL:-}" ]; then
  psql -X -q -v ON_ERROR_STOP=1 "$PGURL/postgres" -c "drop database if exists $DB" -c "create database $DB"
else
  pg_lsclusters | grep -Eq "16 +main +[0-9]+ +online" || pg_ctlcluster 16 main start
  su postgres -c "psql -X -q -c 'drop database if exists $DB' -c 'create database $DB'"
fi
run tests/db/stub_supabase.sql
for f in supabase/migrations/*.sql; do echo "applying $f"; run "$f"; done
echo "seeding"; run supabase/seed.sql
run tests/db/pgtap_shim.sql
node tests/db/make_db_tests.js
fail=0
for t in supabase/tests/*.sql; do
  echo "--- $t"
  if out=$(psql_db -At -f - < "$t" 2>&1); then
    echo "$out" | grep -E "^(not ok|#)" || true
    if echo "$out" | grep -Eq "^(not ok|# Looks like)"; then fail=1; else echo "$(echo "$out" | grep -c '^ok ') ok"; fi
  else
    echo "$out" | tail -20; fail=1
  fi
done
[ $fail -eq 0 ] && echo "db tests passed" || { echo "DB TESTS FAILED"; exit 1; }
