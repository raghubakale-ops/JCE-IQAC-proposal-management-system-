#!/usr/bin/env bash
# Service-layer integration test: real migrations + PostgREST + the app's own service modules.
# Needs: PostgreSQL, a PostgREST binary at $POSTGREST (default ./postgrest), node.
set -euo pipefail
cd "$(dirname "$0")"; ROOT=$(cd ../..; pwd)
export PGHOST=127.0.0.1 PGUSER=postgres
POSTGREST=${POSTGREST:-/tmp/postgrest}; SECRET="integration-test-secret-integration-test-secret"
psql -qc "drop database if exists jce_int" -d postgres; psql -qc "create database jce_int" -d postgres
psql -q -v ON_ERROR_STOP=1 -d jce_int -f 00_supabase_stub.sql
for f in ../migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d jce_int -f "$f"; done
psql -q -v ON_ERROR_STOP=1 -d jce_int -f fixtures.sql
psql -q -d jce_int -c "do \$\$ begin create role authenticator login noinherit; exception when duplicate_object then null; end \$\$; grant anon, authenticated to authenticator;"
cat > /tmp/pgrst.conf <<CONF
db-uri = "postgres://authenticator@127.0.0.1:5432/jce_int"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-host = "127.0.0.1"
server-port = 3001
CONF
"$POSTGREST" /tmp/pgrst.conf >/tmp/pgrst.log 2>&1 & P1=$!
node proxy.mjs & P2=$!
trap 'kill $P1 $P2 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:3001/ && break; sleep 0.5; done
cd "$ROOT"
INTEGRATION_API_URL=http://127.0.0.1:3002 INTEGRATION_JWT_SECRET="$SECRET" npx vitest run src/services/integration.test.ts
