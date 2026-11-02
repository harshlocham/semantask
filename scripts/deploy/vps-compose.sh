#!/usr/bin/env bash
# Deploy or update the full Docker Compose stack on a VPS.
# Run ON the VPS from the repo root (e.g. /opt/semantask).
#
# Prerequisites:
#   - .env with MONGODB_URI, auth secrets, ORIGIN=https://semantask.com, etc.
#   - Docker + Docker Compose 2.24 or later
#   - Cloudflare origin certificate at nginx/certs/origin.pem and origin.key
#
# Usage:
#   bash scripts/deploy/vps-compose.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "Missing .env in $ROOT_DIR — copy .env.sample and configure for production."
  exit 1
fi

if [[ ! -f nginx/certs/origin.pem || ! -f nginx/certs/origin.key ]]; then
  echo "Missing nginx/certs/origin.pem or origin.key — see docs/operations/PRODUCTION_REQUIREMENTS.md."
  exit 1
fi

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)

echo "Building and starting Semantask stack..."
"${COMPOSE[@]}" build --no-cache nextapp
"${COMPOSE[@]}" up -d --build

echo "Reloading nginx (picks up config + fresh upstream DNS)..."
"${COMPOSE[@]}" restart nginx

echo ""
"${COMPOSE[@]}" ps

echo ""
echo "Done. Test: curl -I https://semantask.com/"
