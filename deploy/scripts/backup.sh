#!/usr/bin/env bash
# Nightly backup of Qadiyati: the database and the uploaded documents. Keeps the last 14 days.
# Installed by setup-server.sh as /usr/local/bin/qadiyati-backup (runs daily at 03:00).
#
# Each run is verified before it counts: the dump must list its contents with pg_restore and the
# archive must open with tar. The result (sizes, SHA-256 and checks) is appended to
# /var/lib/qadiyati/backup-status.json, which the platform admin's "Backups" page reads.
#
# A backup on the same laptop does not survive a broken disk: copy /var/backups/qadiyati to
# another machine or a USB disk regularly (deploy/README.md, "Backups").
set -uo pipefail

DEST=/var/backups/qadiyati
STATUS_DIR=/var/lib/qadiyati
STATUS="$STATUS_DIR/backup-status.json"
STAMP="$(date +%Y-%m-%d_%H%M)"
STARTED="$(date -Is)"
DB_FILE="$DEST/db_$STAMP.dump"
DOCS_FILE="$DEST/documents_$STAMP.tar.gz"
mkdir -p "$DEST" "$STATUS_DIR"
chmod 700 "$DEST"
chmod 755 "$STATUS_DIR"

ERRORS=()
sudo -u postgres pg_dump -Fc qadiyati > "$DB_FILE" || ERRORS+=("pg_dump failed")
tar -czf "$DOCS_FILE" -C /opt/qadiyati/backend private-documents uploads || ERRORS+=("tar failed")

# Verification: the dump must list (and contain the core tables), the archive must open.
DB_OK=false
if TOC="$(pg_restore --list "$DB_FILE" 2>/dev/null)"; then
  if grep -q "TABLE DATA public legal_cases" <<<"$TOC" && grep -q "TABLE DATA public audit_logs" <<<"$TOC"; then
    DB_OK=true
  else
    ERRORS+=("dump is missing core tables")
  fi
else
  ERRORS+=("pg_restore --list failed")
fi
DB_TABLES="$(grep -c "TABLE DATA public" <<<"${TOC:-}" || true)"
DOCS_OK=false
if DOCS_ENTRIES="$(tar -tzf "$DOCS_FILE" 2>/dev/null | wc -l)"; then DOCS_OK=true; else ERRORS+=("archive does not open"); fi

size() { stat -c %s "$1" 2>/dev/null || echo 0; }
hash() { sha256sum "$1" 2>/dev/null | cut -d' ' -f1; }
OK=false
if [ "$DB_OK" = true ] && [ "$DOCS_OK" = true ] && [ ${#ERRORS[@]} -eq 0 ]; then OK=true; fi

ENTRY="$(python3 - "$STAMP" "$STARTED" "$(date -Is)" "$DB_FILE" "$(size "$DB_FILE")" "$(hash "$DB_FILE")" "$DB_OK" "$DB_TABLES" \
  "$DOCS_FILE" "$(size "$DOCS_FILE")" "$(hash "$DOCS_FILE")" "$DOCS_OK" "${DOCS_ENTRIES:-0}" "$OK" "$(IFS='; '; echo "${ERRORS[*]:-}")" <<'PY'
import json, sys
a = sys.argv[1:]
print(json.dumps({
  "stamp": a[0], "started_at": a[1], "finished_at": a[2],
  "database": {"file": a[3].rsplit('/', 1)[-1], "bytes": int(a[4]), "sha256": a[5], "verified": a[6] == "true", "tables": int(a[7] or 0)},
  "documents": {"file": a[8].rsplit('/', 1)[-1], "bytes": int(a[9]), "sha256": a[10], "verified": a[11] == "true", "entries": int(a[12] or 0)},
  "ok": a[13] == "true", "error": a[14] or None,
}))
PY
)"

# Keep the last 60 runs in the status file, written atomically.
python3 - "$STATUS" "$ENTRY" <<'PY'
import json, os, sys, tempfile
path, entry = sys.argv[1], json.loads(sys.argv[2])
try:
    runs = json.load(open(path))
    if not isinstance(runs, list): runs = []
except Exception:
    runs = []
runs = (runs + [entry])[-60:]
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))
with os.fdopen(fd, 'w') as out: json.dump(runs, out, ensure_ascii=False, indent=1)
os.chmod(tmp, 0o644)
os.replace(tmp, path)
PY

find "$DEST" -type f -name 'db_*' -mtime +14 -delete
find "$DEST" -type f -name 'documents_*' -mtime +14 -delete
find "$DEST" -type f -name 'pre-restore_*' -mtime +30 -delete
if [ "$OK" = true ]; then
  echo "$(date -Is) backup verified: $DB_FILE, $DOCS_FILE"
else
  echo "$(date -Is) backup FAILED verification: ${ERRORS[*]}" >&2
  exit 1
fi
