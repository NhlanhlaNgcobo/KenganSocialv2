#!/usr/bin/env bash
# One-time setup of a fresh Debian 12 VM for the KenganSocial API stack (docs/DEPLOY.md, step 3).
# Installs Docker, clones the repository and creates the .env files from the examples.
#
#   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/<branch>/scripts/vm-setup.sh -o vm-setup.sh
#   bash vm-setup.sh <git-clone-url> [branch]
set -euo pipefail

REPO_URL="${1:?Usage: bash vm-setup.sh <git-clone-url> [branch]}"
BRANCH="${2:-main}"
APP_DIR="${APP_DIR:-$HOME/kengansocial}"

echo "==> Installing Docker"
if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl git
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER"
fi

echo "==> Getting the code ($BRANCH)"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" fetch origin && git -C "$APP_DIR" checkout "$BRANCH" && git -C "$APP_DIR" pull --ff-only
fi

echo "==> Environment files"
[ -f "$APP_DIR/server/.env" ] || cp "$APP_DIR/.env.example" "$APP_DIR/server/.env"
[ -f "$APP_DIR/python-service/.env" ] || cp "$APP_DIR/python-service/.env.example" "$APP_DIR/python-service/.env"
chmod 600 "$APP_DIR/server/.env" "$APP_DIR/python-service/.env"

cat <<EOF

Done. Next (docs/DEPLOY.md, step 4):
  1. Log out and back in once, so your user can run docker without sudo.
  2. Fill in $APP_DIR/server/.env and $APP_DIR/python-service/.env with the production values.
  3. cd $APP_DIR && echo "API_DOMAIN=api.example.com" > .env && docker compose up -d --build
EOF
