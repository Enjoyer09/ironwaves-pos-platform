#!/usr/bin/env bash
# Build the portable Windows ZIP (agent exe + silent-install scripts).
set -euo pipefail

cd "$(dirname "$0")/.."
AGENT_DIR="$(pwd)"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp dist/ironwaves-print-agent.exe "$STAGE/"
cp setup-windows.ps1 "$STAGE/"
cp setup.bat "$STAGE/"
cp clear-queue.bat "$STAGE/"
cat > "$STAGE/README.txt" <<'EOF'
iRonWaves Print Agent - Windows (portable, Self-installing)

Bu arxivi bir qovluga cixarin (meselen: C:\iRonWavesAgent).
Sadece bir defa quraşdirmaq ucun:
  1) setup.bat-e iki defe klik edin (ve ya setup-windows.ps1-i PowerShell ile ishe salin).
     - Agenti Windows acilishinda avtomatik ishe salan shortcut yaradir.
     - Agenti arxa planda (penceresiz) basladir.
  2) Hazirdir. POS-dan cap veziyyetini Ayarlar -> Cap -> "Print Agent" bo'lmindan izleye bilersiniz.

Teleb olunanlar:
  - Windows 10/11 (x64)
  - Google Chrome (cap ucun HTML-i render edir). Quraşdirilmamisa agent xeta verir;
    Chrome https://www.google.com/chrome/ -dan yukleyin.

Cap novbesi ilişib qalsa: clear-queue.bat-i "Administrator" olaraq ishe salin.
Agent 127.0.0.1:17777 ünvanında dinleyir. POS bu ünvana gönderir.
EOF

rm -f "$AGENT_DIR/ironwaves-print-agent-windows.zip"
cd "$STAGE"
zip -r -X "$AGENT_DIR/ironwaves-print-agent-windows.zip" . >/dev/null

echo "Built: $AGENT_DIR/ironwaves-print-agent-windows.zip"
