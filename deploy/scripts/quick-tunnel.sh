#!/usr/bin/env bash
# Free public link for Qadiyati, with no domain and no Cloudflare account: a Cloudflare "quick
# tunnel" (https://<random-words>.trycloudflare.com) to nginx on this machine.
#
# The link changes every time the tunnel starts, so this script waits for it, writes it into
# backend/.env (FRONTEND_URL, BETTER_AUTH_URL, TRUSTED_FRONTEND_ORIGINS) and restarts the API,
# which accepts requests only from its own address. The current link is kept in
# /opt/qadiyati/PUBLIC_URL; read it with:  cat /opt/qadiyati/PUBLIC_URL
#
# Run by the qadiyati-tunnel systemd service. For a permanent address, use a named tunnel on your
# own domain instead (deploy/README.md, step 6).
set -euo pipefail

ENV_FILE=/opt/qadiyati/backend/.env
URL_FILE=/opt/qadiyati/PUBLIC_URL
LOG=/run/qadiyati-tunnel.log

: > "$LOG"
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8080 >>"$LOG" 2>&1 &
TUNNEL_PID=$!
trap 'kill "$TUNNEL_PID" 2>/dev/null || true' TERM INT EXIT

URL=""
for _ in $(seq 1 90); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -n 1 || true)"
  [ -n "$URL" ] && break
  kill -0 "$TUNNEL_PID" 2>/dev/null || break
  sleep 1
done

if [ -z "$URL" ]; then
  echo "The tunnel did not report a link. Last lines:"
  tail -n 20 "$LOG"
  exit 1
fi

# Rewrite the three settings in place (same file, so its owner and mode stay as they are).
TMP="$(mktemp)"
awk -v url="$URL" '
  /^FRONTEND_URL=/ { print "FRONTEND_URL=" url; next }
  /^BETTER_AUTH_URL=/ { print "BETTER_AUTH_URL=" url; next }
  /^TRUSTED_FRONTEND_ORIGINS=/ { print "TRUSTED_FRONTEND_ORIGINS=" url; next }
  { print }
' "$ENV_FILE" > "$TMP"
cat "$TMP" > "$ENV_FILE"
rm -f "$TMP"
echo "$URL" > "$URL_FILE"
chmod 644 "$URL_FILE"

systemctl restart qadiyati-api
echo "Qadiyati is public at: $URL"

wait "$TUNNEL_PID"
