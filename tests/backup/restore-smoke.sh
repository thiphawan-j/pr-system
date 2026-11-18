#!/usr/bin/env bash
# Synthetic data only. No production credentials, networks or backups are used.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
SOURCE=""
cleanup() {
  [ -z "$SOURCE" ] || docker rm -f "$SOURCE" >/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT
SOURCE="$(docker run -d --network none --read-only \
  --tmpfs /var/lib/postgresql/data:rw --tmpfs /var/run/postgresql:rw --tmpfs /tmp:rw \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=backup_fixture postgres:16-alpine)"
for attempt in $(seq 1 60); do
  [ "$(docker exec "$SOURCE" psql -X -At -U postgres -d backup_fixture -c "SELECT current_setting('listen_addresses')" 2>/dev/null || true)" = '*' ] && break
  sleep 1
done
docker exec -i "$SOURCE" psql -X -v ON_ERROR_STOP=1 -U postgres -d backup_fixture <<'SQL'
CREATE TABLE items (id serial PRIMARY KEY, name text NOT NULL);
CREATE TABLE lines (id serial PRIMARY KEY, item_id integer REFERENCES items(id), qty numeric NOT NULL);
INSERT INTO items(name) VALUES ('วัตถุดิบทดสอบ ถังทอง');
INSERT INTO lines(item_id, qty) VALUES (1, 12.5);
-- Materialized view ensures restoration includes actual row data, not only schema.
CREATE MATERIALIZED VIEW fixture_check AS SELECT i.name, l.qty FROM items i JOIN lines l ON l.item_id=i.id;
SQL
docker exec "$SOURCE" pg_dump -U postgres -d backup_fixture -Fc > "$TMP/synthetic.dump"
bash "$ROOT/scripts/backup/verify-restore.sh" "$TMP/synthetic.dump"
printf 'invalid archive' > "$TMP/invalid.dump"
if bash "$ROOT/scripts/backup/verify-restore.sh" "$TMP/invalid.dump"; then
  echo 'ERROR: Invalid archive was accepted.' >&2
  exit 1
fi
# A valid but truncated archive must not pass the full restore.
head -c 100 "$TMP/synthetic.dump" > "$TMP/truncated.dump"
if bash "$ROOT/scripts/backup/verify-restore.sh" "$TMP/truncated.dump"; then
  echo 'ERROR: Truncated archive was accepted.' >&2
  exit 1
fi
echo 'Synthetic valid, invalid and truncated restore tests passed.'
