#!/usr/bin/env bash
# Aplica as migrações num PostgreSQL temporário e roda os testes de permissão
# e de regras financeiras. Uso: npm run test:db  (ou DATABASE_URL=... para usar um banco existente)
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$DIR/.."
cleanup() { :; }
if [ -z "${DATABASE_URL:-}" ]; then
  PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
  TMP="$(mktemp -d)"
  RUN=""
  if [ "$(id -u)" = "0" ]; then chown postgres "$TMP"; RUN="runuser -u postgres --"; fi
  $RUN "$PGBIN/initdb" -D "$TMP/data" -A trust -U postgres >/dev/null
  $RUN "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p 54329 -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
  cleanup() { $RUN "$PGBIN/pg_ctl" -D "$TMP/data" -m fast stop >/dev/null || true; rm -rf "$TMP"; }
  trap cleanup EXIT
  DATABASE_URL="postgresql://postgres@/postgres?host=$TMP&port=54329"
fi
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f "$DIR/00_stub_supabase.sql"
for f in "$ROOT"/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
for f in "$DIR"/[1-9]*.sql; do
  echo "== $(basename "$f")"
  "${PSQL[@]}" -o /dev/null -f "$f"
done
echo "Todos os testes do banco passaram."
