#!/usr/bin/env bash
# Restore a trusted custom-format dump only into a new, isolated disposable container.
set -euo pipefail
if [ "$#" -ne 1 ] || [ ! -s "$1" ]; then
  echo 'Usage: bash scripts/backup/verify-restore.sh /path/to/trusted.dump' >&2
  exit 2
fi
DUMP="$1"
# No host ports, production networks, bind mounts, URLs or persistent volumes.
CONTAINER=""
cleanup() {
  if [ -n "$CONTAINER" ]; then docker rm -f "$CONTAINER" >/dev/null; fi
}
trap cleanup EXIT
CONTAINER="$(docker run -d --network none --read-only \
  --tmpfs /var/lib/postgresql/data:rw --tmpfs /var/run/postgresql:rw --tmpfs /tmp:rw \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=restore_verify \
  postgres:16-alpine)"
READY=0
for attempt in $(seq 1 60); do
  if [ "$(docker exec "$CONTAINER" psql -X -At -U postgres -d restore_verify -c "SELECT current_setting('listen_addresses')" 2>/dev/null || true)" = '*' ]; then
    READY=1
    break
  fi
  sleep 1
done
[ "$READY" -eq 1 ] || { echo 'Disposable PostgreSQL failed to start.' >&2; exit 1; }
# Fail on any restore error. Do not restore ownership/ACLs into this isolated DB.
docker exec -i "$CONTAINER" pg_restore --exit-on-error --no-owner --no-acl \
  -U postgres -d restore_verify < "$DUMP"
# Read all restored tables (checks data access without printing business data).
docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d restore_verify <<'SQL'
DO $$
DECLARE t record; n bigint; tables_checked integer := 0;
BEGIN
  FOR t IN SELECT schemaname, tablename FROM pg_tables
           WHERE schemaname NOT IN ('pg_catalog', 'information_schema') LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I', t.schemaname, t.tablename) INTO n;
    tables_checked := tables_checked + 1;
  END LOOP;
  IF tables_checked = 0 THEN RAISE EXCEPTION 'No application tables restored'; END IF;
END $$;
SQL
echo 'Restore verification passed in an isolated disposable PostgreSQL 16 container.'
