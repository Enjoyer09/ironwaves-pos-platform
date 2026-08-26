#!/bin/bash
# Build macOS .pkg installer(s) for the iRonWaves Print Agent.
# Builds one .pkg per present binary (arm64 / x64).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
SCRIPTS_DIR="$ROOT_DIR/build/macos"
VERSION="0.2.0"

BUILT=()
for arch in arm64 x64; do
  SRC="$DIST_DIR/ironwaves-print-agent-macos-$arch"
  if [[ ! -f "$SRC" ]]; then
    echo "Skipping mac $arch: binary not found at $SRC (run npm run build:mac:exe:$arch)."
    continue
  fi

  PKGROOT="$(mktemp -d)"
  trap 'rm -rf "$PKGROOT"' RETURN

  mkdir -p "$PKGROOT/usr/local/ironwaves-print-agent"
  mkdir -p "$PKGROOT/Library/LaunchAgents"

  cp "$SRC" "$PKGROOT/usr/local/ironwaves-print-agent/ironwaves-print-agent"
  cp "$SCRIPTS_DIR/com.ironwaves.print-agent.plist" "$PKGROOT/Library/LaunchAgents/com.ironwaves.print-agent.plist"

  chmod 755 "$PKGROOT/usr/local/ironwaves-print-agent/ironwaves-print-agent"
  chmod 644 "$PKGROOT/Library/LaunchAgents/com.ironwaves.print-agent.plist"

  OUTPUT_PKG="$DIST_DIR/ironwaves-print-agent-macos-$arch.pkg"
  pkgbuild \
    --root "$PKGROOT" \
    --scripts "$SCRIPTS_DIR" \
    --identifier "com.ironwaves.print-agent" \
    --version "$VERSION" \
    --install-location "/" \
    "$OUTPUT_PKG"

  echo "Built: $OUTPUT_PKG"
  BUILT+=("$OUTPUT_PKG")
  trap - RETURN
  rm -rf "$PKGROOT"
done

if [[ ${#BUILT[@]} -eq 0 ]]; then
  echo "No macOS agent binaries found in dist/."
  echo "Run one of:"
  echo "  npm run build:mac:exe:arm64"
  echo "  npm run build:mac:exe:x64"
  exit 1
fi
