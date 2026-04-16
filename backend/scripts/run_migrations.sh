#!/usr/bin/env sh
set -eu

echo "[migrations] Running alembic upgrade head..."
alembic upgrade head
echo "[migrations] Done."
