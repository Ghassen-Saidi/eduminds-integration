#!/usr/bin/env bash
# Self-signed certificate for the demo page on a phone (camera needs HTTPS).
#   bash tools/make-cert.sh && python3 services/sim/api.py --port 8443 --demo --tls
set -euo pipefail
mkdir -p certs
if ! command -v openssl >/dev/null; then
  echo "openssl is not installed; install it, or run the demo behind a tunnel instead" >&2
  exit 1
fi
IP=""
if command -v ip >/dev/null; then
  IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}')
elif command -v ipconfig >/dev/null; then
  IP=$(ipconfig getifaddr en0 2>/dev/null || true)
fi
SAN="subjectAltName=DNS:localhost,IP:127.0.0.1"
if [ -n "$IP" ]; then SAN="$SAN,IP:$IP"; fi
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout certs/dev-key.pem -out certs/dev-cert.pem \
  -subj "/CN=eduminds-demo" -addext "$SAN" >/dev/null 2>&1
echo "wrote certs/dev-cert.pem and certs/dev-key.pem for ${IP:-localhost}"
echo "start: python3 services/sim/api.py --port 8443 --demo --tls"
echo "open on the phone: https://${IP:-<LAN-IP>}:8443  (accept the warning once)"
