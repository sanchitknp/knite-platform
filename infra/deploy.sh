#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# deploy.sh — run from infra/ AFTER `terraform apply` in infra/terraform/.
#
# Does the app-level deploy the Terraform stack deliberately doesn't do:
#   1. Wait for cloud-init (user_data.sh) to finish.
#   2. rsync the repo (minus node_modules / .git / uploads) to the EC2 box.
#   3. Upload backend/.env with PUBLIC_URL + DATABASE_URL rewritten to the
#      RDS endpoint from Terraform output.
#   4. Write /etc/caddy/Caddyfile (HTTP on :80 + HTTPS via nip.io + Let's Encrypt).
#   5. Bootstrap RDS schema + seed on first deploy (idempotent — checks
#      for the 'customers' table and skips if already created).
#   6. docker compose up -d (postgres container NOT started — profile-gated).
#   7. Smoke test /api/health over HTTP.
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
DATABASE_URL=$(terraform -chdir="$TF_DIR" output -raw database_url)
RDS_HOST=$(terraform -chdir="$TF_DIR" output -raw rds_endpoint)

SSH_OPTS=(-i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR)
SSH="ssh ${SSH_OPTS[*]} ec2-user@$IP"

echo "[deploy] IP=$IP"
echo "[deploy] nip.io host=$NIP_HOST"
echo "[deploy] RDS host=$RDS_HOST"

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
# 3. Upload .env with PUBLIC_URL and DATABASE_URL rewritten
# ---------------------------------------------------------------------------
echo "[deploy] uploading backend/.env with PUBLIC_URL=https://$NIP_HOST and RDS DATABASE_URL"
# Rewrite both PUBLIC_URL and DATABASE_URL in one sed pass.
# Use a non-`/` delimiter (|) because DATABASE_URL contains slashes.
sed \
  -e "s|^PUBLIC_URL=.*|PUBLIC_URL=https://$NIP_HOST|" \
  -e "s|^DATABASE_URL=.*|DATABASE_URL=$DATABASE_URL|" \
  "$REPO_ROOT/backend/.env" \
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
# 5. Bootstrap RDS schema + seed (first deploy only)
# ---------------------------------------------------------------------------
echo "[deploy] checking if RDS is bootstrapped..."
# Run a one-shot psql via a transient postgres container on the EC2 box.
# Using --network host so it can reach the RDS endpoint through the EC2 SG.
HAS_TABLE=$($SSH "sudo docker run --rm --network host \
  -e PGPASSWORD='$(terraform -chdir=$TF_DIR output -raw rds_password)' \
  postgres:15-alpine psql \
    -h '$RDS_HOST' -U knite -d knite -tAc \
    \"SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='customers' LIMIT 1;\"" 2>/dev/null || echo "")

if [[ "$HAS_TABLE" == "1" ]]; then
  echo "[deploy] RDS already has schema — skipping bootstrap"
else
  echo "[deploy] RDS is empty — loading schema + seed"
  $SSH "sudo docker run --rm --network host \
    -e PGPASSWORD='$(terraform -chdir=$TF_DIR output -raw rds_password)' \
    -v $REMOTE_DIR/backend/src/db:/sql \
    postgres:15-alpine psql \
      -h '$RDS_HOST' -U knite -d knite \
      -v ON_ERROR_STOP=1 \
      -f /sql/schema.sql"
  $SSH "sudo docker run --rm --network host \
    -e PGPASSWORD='$(terraform -chdir=$TF_DIR output -raw rds_password)' \
    -v $REMOTE_DIR/backend/src/db:/sql \
    postgres:15-alpine psql \
      -h '$RDS_HOST' -U knite -d knite \
      -v ON_ERROR_STOP=1 \
      -f /sql/seed.sql"
  echo "[deploy] schema + seed loaded"
fi

# Load India Post pincode directory (~165k rows) if table is empty.
# Public mirror of the India Post CSV — used by tech onboarding
# (state/area list) and installationFlow (pincode lookup).
echo "[deploy] checking india_pincodes row count..."
PINCODE_COUNT=$($SSH "sudo docker run --rm --network host \
  -e PGPASSWORD='$(terraform -chdir=$TF_DIR output -raw rds_password)' \
  postgres:15-alpine psql \
    -h '$RDS_HOST' -U knite -d knite -tAc \
    \"SELECT COUNT(*) FROM india_pincodes;\"" 2>/dev/null || echo "0")

if [[ "${PINCODE_COUNT:-0}" -gt 10000 ]]; then
  echo "[deploy] india_pincodes already populated (${PINCODE_COUNT} rows) — skipping"
else
  echo "[deploy] india_pincodes is empty — downloading + loading CSV (~23 MB)"
  $SSH "curl -sSL -o /tmp/all-india-pincodes.csv \
    https://raw.githubusercontent.com/arobindo/pincode-india-csv/main/all-india-pincodes.csv"
  $SSH "sudo docker run --rm --network host \
    -e PGPASSWORD='$(terraform -chdir=$TF_DIR output -raw rds_password)' \
    -v /tmp/all-india-pincodes.csv:/tmp/p.csv \
    postgres:15-alpine psql \
      -h '$RDS_HOST' -U knite -d knite \
      -v ON_ERROR_STOP=1 \
      -c \"\\copy india_pincodes (circle_name, region_name, division_name, area_name, pincode, office_type, delivery, district, state, latitude, longitude) FROM '/tmp/p.csv' WITH (FORMAT csv, HEADER true, NULL 'NA')\""
  $SSH "sudo docker run --rm --network host \
    -e PGPASSWORD='$(terraform -chdir=$TF_DIR output -raw rds_password)' \
    postgres:15-alpine psql \
      -h '$RDS_HOST' -U knite -d knite \
      -v ON_ERROR_STOP=1 \
      -c \"UPDATE india_pincodes SET state = initcap(state) WHERE state = upper(state); UPDATE india_pincodes SET district = initcap(district) WHERE district = upper(district);\""
  echo "[deploy] india_pincodes loaded"
fi

# ---------------------------------------------------------------------------
# 6. docker compose up (no local postgres — profile-gated)
# ---------------------------------------------------------------------------
echo "[deploy] stopping any leftover knite-postgres container (now managed by RDS)"
$SSH "sudo docker rm -f knite-postgres 2>/dev/null || true"

echo "[deploy] docker compose up -d"
# ec2-user was added to docker group in user_data, but that membership only
# takes effect on new logins. Use sudo for this invocation.
$SSH "cd $REMOTE_DIR && sudo docker compose up -d --build"

# ---------------------------------------------------------------------------
# 7. Smoke test
# ---------------------------------------------------------------------------
echo "[deploy] smoke test (give backend 20s to boot)"
sleep 20
set +e
echo "-- HTTP (port 80, via Caddy) --"
curl -sS --max-time 10 "http://$IP/api/health" || echo "(health not yet ready on HTTP)"
echo
echo "-- HTTP (port 3000, direct) --"
curl -sS --max-time 10 "http://$IP:3000/api/health" || echo "(health not yet ready on :3000)"
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
