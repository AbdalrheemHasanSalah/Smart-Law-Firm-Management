#!/usr/bin/env bash
# Restores a Qadiyati backup, with a way back.
#
#   sudo qadiyati-restore 2026-11-28_0300            database and documents of that night
#   sudo qadiyati-restore 2026-11-28_0300 --db-only  the database alone
#
# Steps, stopping at the first failure:
#   1. checks the backup's SHA-256 against /var/lib/qadiyati/backup-status.json and that it lists
#   2. takes a snapshot of the current state: pre-restore_<now>.dump and pre-restore_<now>.tar.gz
#   3. stops the API, restores the database in ONE transaction (a failure leaves it untouched),
#      then swaps in the documents (the current folders are kept until the end)
#   4. starts the API and checks /api/health; if it is not healthy, restores the snapshot
# The snapshot stays in /var/backups/qadiyati for 30 days, so a restore can be undone later with
#   sudo qadiyati-restore pre-restore_<now>
set -euo pipefail

DEST=/var/backups/qadiyati
STATUS=/var/lib/qadiyati/backup-status.json
APP=/opt/qadiyati/backend
STAMP="${1:?usage: qadiyati-restore <stamp> [--db-only]}"
DB_ONLY="${2:-}"
if [[ "$STAMP" == pre-restore_* ]]; then
  DB_FILE="$DEST/$STAMP.dump"; DOCS_FILE="$DEST/$STAMP.tar.gz"
else
  DB_FILE="$DEST/db_$STAMP.dump"; DOCS_FILE="$DEST/documents_$STAMP.tar.gz"
fi
NOW="$(date +%Y-%m-%d_%H%M%S)"
SNAP_DB="$DEST/pre-restore_$NOW.dump"
SNAP_DOCS="$DEST/pre-restore_$NOW.tar.gz"

say() { echo "$(date -Is) $*"; }
health() { for _ in $(seq 1 20); do curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1 && return 0; sleep 2; done; return 1; }

# 1. Check the files.
[ -f "$DB_FILE" ] || { echo "No database backup $DB_FILE" >&2; exit 1; }
[ -n "$DB_ONLY" ] || [ -f "$DOCS_FILE" ] || { echo "No documents backup $DOCS_FILE (use --db-only to skip them)" >&2; exit 1; }
if [ -f "$STATUS" ] && [[ "$STAMP" != pre-restore_* ]]; then
  EXPECTED="$(python3 -c "import json,sys; r=[x for x in json.load(open('$STATUS')) if x.get('stamp')=='$STAMP']; print(r[-1]['database']['sha256'] if r else '')")"
  if [ -n "$EXPECTED" ] && [ "$EXPECTED" != "$(sha256sum "$DB_FILE" | cut -d' ' -f1)" ]; then
    echo "The database backup does not match the SHA-256 recorded when it was made. Stopping." >&2; exit 1
  fi
fi
pg_restore --list "$DB_FILE" >/dev/null || { echo "The database backup does not list; it is damaged." >&2; exit 1; }
[ -n "$DB_ONLY" ] || tar -tzf "$DOCS_FILE" >/dev/null || { echo "The documents archive does not open." >&2; exit 1; }

# 2. Snapshot the current state.
say "snapshot: $SNAP_DB"
sudo -u postgres pg_dump -Fc qadiyati > "$SNAP_DB"
[ -n "$DB_ONLY" ] || tar -czf "$SNAP_DOCS" -C "$APP" private-documents uploads

rollback() {
  say "restore failed — putting back the snapshot $SNAP_DB"
  sudo -u postgres pg_restore --clean --if-exists --no-owner --role=qadiyati --single-transaction -d qadiyati "$SNAP_DB" || true
  if [ -z "$DB_ONLY" ] && [ -d "$APP/.restore-old" ]; then
    rm -rf "$APP/private-documents" "$APP/uploads"
    mv "$APP/.restore-old/private-documents" "$APP/.restore-old/uploads" "$APP/"
    rmdir "$APP/.restore-old"
  fi
  systemctl start qadiyati-api || true
  echo "Rolled back. The system is as it was before the restore." >&2
  exit 1
}

# 3. Restore.
systemctl stop qadiyati-api
say "restoring the database from $DB_FILE"
sudo -u postgres pg_restore --clean --if-exists --no-owner --role=qadiyati --single-transaction -d qadiyati "$DB_FILE" || rollback
if [ -z "$DB_ONLY" ]; then
  say "restoring the documents from $DOCS_FILE"
  mkdir -p "$APP/.restore-old"
  mv "$APP/private-documents" "$APP/uploads" "$APP/.restore-old/" 2>/dev/null || true
  tar -xzf "$DOCS_FILE" -C "$APP" || rollback
  chown -R qadiyati:qadiyati "$APP/private-documents" "$APP/uploads" 2>/dev/null || true
fi

# 4. Start and check.
systemctl start qadiyati-api
health || rollback
[ -n "$DB_ONLY" ] || rm -rf "$APP/.restore-old"
say "restore done. To undo it: sudo qadiyati-restore pre-restore_$NOW"
