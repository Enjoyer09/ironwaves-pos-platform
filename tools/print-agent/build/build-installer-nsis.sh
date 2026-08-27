#!/usr/bin/env bash
# Build the Windows NSIS installer (cross-compiles on macOS/Linux via makensis).
set -euo pipefail

cd "$(dirname "$0")/.."

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp dist/ironwaves-print-agent.exe "$STAGE/"
cp launch-silent.vbs "$STAGE/"
cp setup-windows.ps1 "$STAGE/"
cp setup.bat "$STAGE/"
cp clear-queue.bat "$STAGE/"
cat > "$STAGE/README.txt" <<'EOF'
iRonWaves Print Agent - Windows (portable, Self-installing)

Quraşdirma:
  1) Bu setup faylini ishe salin (adi istifadeci, admin deyil).
  2) Qovlugu secin, "Install" edin.
  3) Sonra avtomatik setup.bat ishe duser; agenti Windows acilishinda
     avtomatik basladan shortcut yaradir ve agenti arxa planda ishe salir.

Teleb olunanlar:
  - Windows 10/11 (x64)
  - Google Chrome (cap ucun HTML-i render edir).

Cap novbesi ilişib qalsa: clear-queue.bat-i "Administrator" olaraq ishe salin.
Agent 127.0.0.1:17777 ünvanında dinleyir.
EOF

mkdir -p build
makensis -DSETUP_STAGE="$STAGE" build/installer.nsi

echo "Built: build/ironwaves-print-agent-setup.exe"
