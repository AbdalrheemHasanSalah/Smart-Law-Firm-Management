#!/usr/bin/env bash
# First-time setup of a fresh Ubuntu Server 24.04 (Proxmox VM or LXC container) for Qadiyati.
# Run once, as root:   sudo bash setup-server.sh
#
# Installs nginx, PostgreSQL, Node.js 24 LTS and cloudflared; creates the `qadiyati` system user,
# the database and its own (non-superuser) role; and writes /opt/qadiyati/backend/.env with a
# random database password and auth secret. Safe to run again: existing pieces are kept.
set -euo pipefail

APP_DIR=/opt/qadiyati
APP_USER=qadiyati
DB_NAME=qadiyati
DB_ROLE=qadiyati
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo bash $0"; exit 1; }

echo "==> System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl ca-certificates gnupg nginx ufw openssl tar postgresql-common locales

# A UTF-8 locale (minimal images and containers often have none, which upsets PostgreSQL and apt).
if ! locale -a 2>/dev/null | grep -qi '^en_US\.utf8$'; then
  sed -i 's/^# *en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen
  locale-gen
fi
update-locale LANG=en_US.UTF-8
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

# Inside a Proxmox (LXC) container: the host's own firewall applies, and there is no lid.
IN_CONTAINER=false
if [ "$(systemd-detect-virt --container 2>/dev/null || true)" != "none" ] && [ -n "$(systemd-detect-virt --container 2>/dev/null || true)" ]; then
  IN_CONTAINER=true
fi

echo "==> PostgreSQL 17 (same major version as development, so dumps move both ways)"
if ! command -v psql >/dev/null || ! psql --version | grep -q ' 17\.'; then
  /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
  apt-get install -y postgresql-17
fi
systemctl enable --now postgresql

echo "==> Node.js 24 LTS"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node --version

echo "==> cloudflared"
if ! command -v cloudflared >/dev/null; then
  mkdir -p --mode=0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get update && apt-get install -y cloudflared
fi

echo "==> App user and folders"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR/backend/private-documents" "$APP_DIR/backend/uploads" "$APP_DIR/frontend"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 750 "$APP_DIR/backend/private-documents"

echo "==> Database"
DB_PASSWORD=""
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_ROLE'" | grep -q 1; then
  DB_PASSWORD="$(openssl rand -hex 24)"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE $DB_ROLE LOGIN PASSWORD '$DB_PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE;"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB_NAME OWNER $DB_ROLE ENCODING 'UTF8' TEMPLATE template0;"
fi

echo "==> backend/.env"
ENV_FILE="$APP_DIR/backend/.env"
if [ ! -f "$ENV_FILE" ]; then
  if [ -z "$DB_PASSWORD" ]; then
    echo "The database role already existed, so its password is unknown here."
    echo "Reset it with:  sudo -u postgres psql -c \"ALTER ROLE $DB_ROLE PASSWORD 'new-password';\""
    echo "and put it in $ENV_FILE as DB_PASSWORD."
    DB_PASSWORD="SET-ME"
  fi
  sed -e "s/^BETTER_AUTH_SECRET=GENERATED/BETTER_AUTH_SECRET=$(openssl rand -hex 32)/" \
      -e "s/^DB_PASSWORD=GENERATED/DB_PASSWORD=$DB_PASSWORD/" \
      "$SCRIPT_DIR/../env/backend.env.production.example" > "$ENV_FILE"
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Wrote $ENV_FILE (secrets generated). Add RESEND_API_KEY and your payment details to it."
else
  echo "$ENV_FILE already exists; left unchanged."
fi

echo "==> nginx and the API service"
cp "$SCRIPT_DIR/../nginx/qadiyati.conf" /etc/nginx/sites-available/qadiyati
ln -sf /etc/nginx/sites-available/qadiyati /etc/nginx/sites-enabled/qadiyati
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
cp "$SCRIPT_DIR/../systemd/qadiyati-api.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable qadiyati-api >/dev/null

echo "==> Firewall: only SSH is open (the site goes out through the Cloudflare Tunnel)"
# nginx and the API listen on 127.0.0.1 only, so they are not reachable from outside either way.
if ufw allow OpenSSH >/dev/null 2>&1 && ufw --force enable >/dev/null 2>&1; then
  echo "ufw enabled."
else
  echo "ufw is not available here (normal inside a container); nginx and the API listen on 127.0.0.1 only."
fi

echo "==> Nightly backups at 03:00"
install -m 755 "$SCRIPT_DIR/backup.sh" /usr/local/bin/qadiyati-backup
install -m 755 "$SCRIPT_DIR/restore.sh" /usr/local/bin/qadiyati-restore
mkdir -p /var/lib/qadiyati && chmod 755 /var/lib/qadiyati
echo "0 3 * * * root /usr/local/bin/qadiyati-backup >> /var/log/qadiyati-backup.log 2>&1" > /etc/cron.d/qadiyati-backup

echo "==> Keep running with the lid closed (a laptop used as a server)"
if [ "$IN_CONTAINER" = false ] && [ -f /etc/systemd/logind.conf ]; then
  sed -i -E 's/^#?HandleLidSwitch=.*/HandleLidSwitch=ignore/; s/^#?HandleLidSwitchExternalPower=.*/HandleLidSwitchExternalPower=ignore/' /etc/systemd/logind.conf
fi

echo
echo "Done. Next: upload the project and run deploy.sh (deploy/README.md, steps 4 and 5)."
