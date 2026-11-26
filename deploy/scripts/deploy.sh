#!/usr/bin/env bash
# Installs (or updates) Qadiyati from an uploaded archive, then restarts it.
# Run as root:   sudo bash deploy.sh /tmp/qadiyati.tar.gz
#
# Keeps on the server: backend/.env, the uploaded documents (private-documents, uploads) and the
# database. A fresh database gets its tables on the first run; later database changes
# (backend/database/migrations/*.sql) are applied by hand, see deploy/README.md.
set -euo pipefail

ARCHIVE="${1:-/tmp/qadiyati.tar.gz}"
APP_DIR=/opt/qadiyati
APP_USER=qadiyati

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo bash $0 $ARCHIVE"; exit 1; }
[ -f "$ARCHIVE" ] || { echo "Archive not found: $ARCHIVE"; exit 1; }
[ -f "$APP_DIR/backend/.env" ] || { echo "Run setup-server.sh first ($APP_DIR/backend/.env is missing)."; exit 1; }

echo "==> Unpacking the release"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
tar -xzf "$ARCHIVE" -C "$STAGE"
# Never take secrets or documents from the archive, even if they slipped in.
rm -rf "$STAGE/backend/.env" "$STAGE/frontend/.env" "$STAGE/backend/private-documents" "$STAGE/backend/uploads" \
       "$STAGE/backend/node_modules" "$STAGE/frontend/node_modules"
# upload.ps1 builds the frontend on the PC (a small server lacks the memory); build here only if not.
PREBUILT=false
[ -f "$STAGE/frontend/dist/index.html" ] && PREBUILT=true

# Replace the code, keeping .env, documents and installed packages until reinstalled below.
for part in backend frontend deploy; do
  [ -d "$STAGE/$part" ] || continue
  mkdir -p "$APP_DIR/$part"
  find "$APP_DIR/$part" -mindepth 1 -maxdepth 1 \
    ! -name .env ! -name private-documents ! -name uploads ! -name node_modules -exec rm -rf {} +
  cp -a "$STAGE/$part/." "$APP_DIR/$part/"
done
cp "$APP_DIR/deploy/env/frontend.env.production" "$APP_DIR/frontend/.env.production"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> Backend packages"
sudo -u "$APP_USER" -H bash -c "cd $APP_DIR/backend && npm ci --omit=dev --no-audit --no-fund"

if [ "$PREBUILT" = true ]; then
  echo "==> Frontend: using the build made on the PC"
  rm -rf "$APP_DIR/frontend/node_modules"
else
  echo "==> Building the frontend"
  sudo -u "$APP_USER" -H bash -c "cd $APP_DIR/frontend && npm ci --no-audit --no-fund && npm run build"
fi

echo "==> Database"
TABLES="$(sudo -u postgres psql -d qadiyati -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
if [ "$TABLES" -eq 0 ]; then
  echo "Empty database: creating the tables."
  sudo -u "$APP_USER" -H bash -c "cd $APP_DIR/backend && npm run db:init"
else
  echo "Database already has $TABLES tables; left as is."
fi

echo "==> Restarting"
systemctl restart qadiyati-api
systemctl reload nginx
# A small server can take several seconds to start Node.
UP=false
for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then UP=true; break; fi
  sleep 1
done
if [ "$UP" = true ]; then
  echo "API is up."
else
  echo "API did not answer within 20 seconds. Check: sudo journalctl -u qadiyati-api -n 50"
fi
echo "Done."
