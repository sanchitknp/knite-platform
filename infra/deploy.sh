#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# deploy.sh — run from infra/ AFTER `terraform apply` in infra/terraform/.
#
# Does the app-level deploy the Terraform stack deliberately doesn't do:
#   1. Wait for cloud-init (user_data.sh) to finish.
#   2. rsync the repo (minus node_modules / .git / uploads) to the EC2 box.
#   3. Upload backend/.env with PUBLIC_URL rewritten to the nip.io HTTPS URL.
#   4. Write /etc/caddy/Caddyfile (HTTP on :80 + HTTPS via nip.io + Let's Encrypt).
#   5. docker compose up -d.
#   6. Smoke test /health over HTTP and HTTPS.
# -----------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")"
REPO_ROOT="$(cd .. && pwd)"
TF_DIR="$(pwd)/terraform"
REMOTE_DIR="/home/ec2-user/knite-platform"

echo "[deploy] reading terraform outputs..."
IP=$(terraform -chdir="$TF_DIR" output -raw public_ip)
KEY=$(terraform -chdir="$TF_DIR" output -raw key_path)
NIP_HOST=$(terraform -chdir="$TF_DIR" output -raw nip_io_host)

SSH_OPTS=(-i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR)
SSH="ssh ${SSH_OPTS[*]} ec2-user@$IP"

echo "[deploy] IP=$IP"
echo "[deploy] nip.io host=$NIP_HOST"

# ---------------------------------------------------------------------------
# 1. Wait for cloud-init to finish
# ---------------------------------------------------------------------------
echo "[deploy] waiting for user_data to finish..."
for i in $(seq 1 60); do
  if $SSH 'test -f /tmp/knite-user-data-done' 2>/dev/null; then
    echo "[deploy] user_data done (after ${i}×5s)"
    break
  fi
  sleep 5
  [[ $i -eq 60 ]] && { echo "[deploy] TIMEOUT waiting for user_data"; exit 1; }
done

# ---------------------------------------------------------------------------
# 2. rsync code
# ---------------------------------------------------------------------------
echo "[deploy] rsync code → $IP:$REMOTE_DIR"
rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude uploads \
  --exclude 'infra/terraform/.terraform' \
  --exclude 'infra/terraform/*.tfstate*' \
  -e "ssh ${SSH_OPTS[*]}" \
  "$REPO_ROOT/" "ec2-user@$IP:$REMOTE_DIR/"

# ---------------------------------------------------------------------------
# 3. Upload .env with PUBLIC_URL rewritten
# ---------------------------------------------------------------------------
echo "[deploy] uploading backend/.env with PUBLIC_URL=https://$NIP_HOST"
sed "s|^PUBLIC_URL=.*|PUBLIC_URL=https://$NIP_HOST|" "$REPO_ROOT/backend/.env" \
  | $SSH "cat > $REMOTE_DIR/backend/.env && chmod 600 $REMOTE_DIR/backend/.env"

# ---------------------------------------------------------------------------
# 4. Install Caddyfile
# ---------------------------------------------------------------------------
echo "[deploy] installing /etc/caddy/Caddyfile"
$SSH "sudo tee /etc/caddy/Caddyfile >/dev/null" <<EOF
# Knite pilot — Caddy reverse proxy
# - HTTPS for $NIP_HOST (Let's Encrypt via HTTP-01; WhatsApp-compatible)
# - Plain HTTP on :80 for easy curl/browser smoke tests

$NIP_HOST {
  reverse_proxy localhost:3000
  encode zstd gzip
}

:80 {
  reverse_proxy localhost:3000
  encode zstd gzip
}
EOF
$SSH "sudo systemctl enable --now caddy && sudo systemctl restart caddy"

# ---------------------------------------------------------------------------
# 5. docker compose up
# ---------------------------------------------------------------------------
echo "[deploy] docker compose up -d"
# ec2-user was added to docker group in user_data, but that membership only
# takes effect on new logins. Use sudo for this invocation.
$SSH "cd $REMOTE_DIR && sudo docker compose up -d --build"

# ---------------------------------------------------------------------------
# 6. Smoke test
# ---------------------------------------------------------------------------
echo "[deploy] smoke test (give backend 20s to boot)"
sleep 20
set +e
echo "-- HTTP (port 80, via Caddy) --"
curl -sS --max-time 10 "http://$IP/health" || echo "(health not yet ready on HTTP)"
echo
echo "-- HTTP (port 3000, direct) --"
curl -sS --max-time 10 "http://$IP:3000/health" || echo "(health not yet ready on :3000)"
echo
echo "-- HTTPS (nip.io) --"
curl -sS --max-time 30 "https://$NIP_HOST/health" || echo "(HTTPS cert may still be issuing — retry in ~30s)"
echo
set -e

echo
echo "================================================================"
echo " DEPLOY COMPLETE"
echo "================================================================"
terraform -chdir="$TF_DIR" output
echo
echo "Tail backend logs:"
echo "  ssh -i $KEY ec2-user@$IP 'sudo docker logs -f knite-backend'"
echo
