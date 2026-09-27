#!/usr/bin/env bash
set -euo pipefail

for attempt in 1 2 3; do
  if pnpm install --frozen-lockfile; then
    exit 0
  fi
  echo "pnpm install failed (attempt ${attempt}/3), retrying in 15s..."
  sleep 15
done

echo "pnpm install failed after 3 attempts"
exit 1
