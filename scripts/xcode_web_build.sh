#!/bin/bash
# Xcode "Web Build" mərhələsi — Cmd+R hər dəfə son web kodunu iPhone-a aparır.
#
# İş prinsipi:
#   1. dist/ mənbə fayllarından köhnədirsə -> npm run sync:ios:customer
#      (vite build + cap sync ios => ios/App/App/public yenilənir)
#   2. dist/ yenidirsə -> heç nə etmir (sürətli təkrar build)
#
# Əl ilə sıfırlamaq üçün: SKIP_WEB_SYNC=1 ilə build et və ya dist/ sil.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "${SKIP_WEB_SYNC:-0}" = "1" ]; then
  echo "note: SKIP_WEB_SYNC=1 — web assets yenilənmədi"
  exit 0
fi

# dist yoxdursa hər halda build et.
if [ ! -f dist/index.html ]; then
  echo "note: dist/ yoxdur — build:customer işə salınır"
  npm run sync:ios:customer
  exit 0
fi

# Mənbələrdən hər hansı biri stamptan yenidirsə rebuild et.
STAMP="dist/.xcode_web_build.stamp"
NEWEST=""
if [ -f "$STAMP" ]; then
  NEWEST="$(find src public index.html vite.config.ts capacitor.config.ts package.json \
    -type f -newer "$STAMP" -print -quit 2>/dev/null || true)"
fi

if [ ! -f "$STAMP" ] || [ -n "$NEWEST" ]; then
  echo "note: ${NEWEST:-dist stamp yoxdur} — web build işə salınır"
  npm run sync:ios:customer
else
  echo "note: web assets yenidir ($STAMP) — build atlandı"
fi

mkdir -p dist
touch "$STAMP"
