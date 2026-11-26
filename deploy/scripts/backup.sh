#!/usr/bin/env bash
# Nightly backup of Qadiyati: the database and the uploaded documents. Keeps the last 14 days.
# Installed by setup-server.sh as /usr/local/bin/qadiyati-backup (runs daily at 03:00).
#
# A backup on the same laptop does not survive a broken disk: copy /var/backups/qadiyati to
# another machine or a USB disk regularly (deploy/README.md, "Backups").
set -euo pipefail

DEST=/var/backups/qadiyati
STAMP="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$DEST"
chmod 700 "$DEST"

sudo -u postgres pg_dump -Fc qadiyati > "$DEST/db_$STAMP.dump"
tar -czf "$DEST/documents_$STAMP.tar.gz" -C /opt/qadiyati/backend private-documents uploads

find "$DEST" -type f -mtime +14 -delete
echo "$(date -Is) backup done: $DEST/*_$STAMP.*"
