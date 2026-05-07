#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
PKGROOT="$DIST_DIR/pkgroot"
SCRIPTS_DIR="$ROOT_DIR/build/macos"
OUTPUT_PKG="$DIST_DIR/ironwaves-print-agent-macos-installer.pkg"

ARM_BIN="$DIST_DIR/ironwaves-print-agent-macos-arm64"
X64_BIN="$DIST_DIR/ironwaves-print-agent-macos-x64"

if [[ -f "$ARM_BIN" ]]; then
  SOURCE_BIN="$ARM_BIN"
elif [[ -f "$X64_BIN" ]]; then
  SOURCE_BIN="$X64_BIN"
else
  echo "No macOS agent binary found in dist/."
  echo "Run one of:"
  echo "  npm run build:mac:exe:arm64"
  echo "  npm run build:mac:exe:x64"
  exit 1
fi

rm -rf "$PKGROOT"
mkdir -p "$PKGROOT/usr/local/ironwaves-print-agent"
mkdir -p "$PKGROOT/Library/LaunchAgents"

cp "$SOURCE_BIN" "$PKGROOT/usr/local/ironwaves-print-agent/ironwaves-print-agent"
cp "$SCRIPTS_DIR/com.ironwaves.print-agent.plist" "$PKGROOT/Library/LaunchAgents/com.ironwaves.print-agent.plist"

chmod 755 "$PKGROOT/usr/local/ironwaves-print-agent/ironwaves-print-agent"
chmod 644 "$PKGROOT/Library/LaunchAgents/com.ironwaves.print-agent.plist"

pkgbuild \
  --root "$PKGROOT" \
  --scripts "$SCRIPTS_DIR" \
  --identifier "com.ironwaves.print-agent" \
  --version "0.1.0" \
  --install-location "/" \
  "$OUTPUT_PKG"

echo "Built: $OUTPUT_PKG"
