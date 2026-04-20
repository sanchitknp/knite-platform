#!/bin/bash
# Runs once at first boot on Amazon Linux 2023.
# Installs Docker + Compose v2 + Caddy + git/rsync.
# Does NOT clone repo or start containers — that's handled by deploy.sh from the
# operator's laptop so the local .env (with secrets) can be scp'd up.

set -uxo pipefail  # NOTE: no -e — we tolerate individual dnf failures
exec > /var/log/knite-user-data.log 2>&1

echo "[1/5] dnf update"
dnf update -y || true

echo "[2/5] install docker + git + rsync + tar (NOT curl — AL2023 ships curl-minimal and they conflict)"
dnf install -y docker git rsync tar

systemctl enable --now docker
usermod -aG docker ec2-user

echo "[3/5] install docker compose v2 plugin"
COMPOSE_VERSION=v2.29.7
mkdir -p /usr/libexec/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
  -o /usr/libexec/docker/cli-plugins/docker-compose
chmod +x /usr/libexec/docker/cli-plugins/docker-compose

echo "[4/5] install caddy (direct binary — COPR is flaky on AL2023)"
CADDY_VERSION=2.8.4
cd /tmp
curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_amd64.tar.gz" \
  -o caddy.tgz
tar xzf caddy.tgz caddy
install -m 755 caddy /usr/bin/caddy
useradd --system --home /var/lib/caddy --shell /sbin/nologin caddy 2>/dev/null || true
mkdir -p /etc/caddy /var/lib/caddy /var/log/caddy
chown caddy:caddy /var/lib/caddy /var/log/caddy
cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy
After=network.target
[Service]
User=caddy
Group=caddy
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
Restart=on-abnormal
AmbientCapabilities=CAP_NET_BIND_SERVICE
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
# Do NOT start caddy yet — deploy.sh installs the Caddyfile first.

echo "[5/5] prep app dir"
install -d -o ec2-user -g ec2-user -m 0755 /home/ec2-user/knite-platform

echo OK > /tmp/knite-user-data-done
echo "user-data complete at $(date -u)" >> /var/log/knite-user-data.log
