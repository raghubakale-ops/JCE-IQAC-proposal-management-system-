#!/usr/bin/env bash
# Rebuild a scratch DB from migrations and run the test suite. Usage: ./run_db.sh
set -euo pipefail
cd "$(dirname "$0")"
export PGHOST=127.0.0.1 PGUSER=postgres
psql -qc "drop database if exists jce_test" -d postgres
psql -qc "create database jce_test" -d postgres
psql -q -v ON_ERROR_STOP=1 -d jce_test -f 00_supabase_stub.sql
for f in ../migrations/*.sql; do echo "applying $f"; psql -q -v ON_ERROR_STOP=1 -d jce_test -f "$f"; done
python3 test_db.py
