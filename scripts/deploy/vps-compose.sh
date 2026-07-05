#!/usr/bin/env bash
# Deploy or update the full Docker Compose stack on a VPS.
# Run ON the VPS from the repo root (e.g. /opt/semantask).
#
# Prerequisites:
#   - .env with MONGODB_URI, auth secrets, ORIGIN=https://semantask.com, etc.
#   - Docker + Docker Compose v2
#
# Usage:
#   bash scripts/deploy/vps-compose.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "Missing .env in $ROOT_DIR — copy env.sample and configure for production."
  exit 1
fi

echo "Building and starting Semantask stack..."
docker compose up -d --build

echo "Reloading nginx (picks up config + fresh upstream DNS)..."
docker compose restart nginx

echo ""
docker compose ps

echo ""
echo "Done. Test: curl -I http://semantask.com/"
