#!/usr/bin/env bash
set -euo pipefail

version="${1:-pnpm@11.13.1}"

for attempt in 1 2 3; do
  if corepack prepare "$version" --activate; then
    exit 0
  fi
  echo "corepack prepare failed (attempt ${attempt}/3), retrying in 15s..."
  sleep 15
done

echo "corepack prepare failed after 3 attempts"
exit 1
