#!/bin/bash
# ============================================================
# iRonWaves POS — Neon Database Backup Skripti
# ============================================================
# İstifadə:
#   ./scripts/backup_db.sh "postgresql://user:pass@host/dbname?sslmode=require"
#
# Neon connection string-i hardan tapmaq:
#   1. https://console.neon.tech açın
#   2. Layihənizi seçin
#   3. Sol menüdən "Settings" → "Connection Details"
#   4. Connection string-i kopyalayın
# ============================================================

set -euo pipefail

PG_DUMP="/usr/local/Cellar/libpq/18.3/bin/pg_dump"

# ── Parametr yoxlaması ──
if [ -z "${1:-}" ]; then
  echo ""
  echo "❌ DATABASE_URL parametri verilməyib!"
  echo ""
  echo "İstifadə:"
  echo "  ./scripts/backup_db.sh \"postgresql://user:pass@host/dbname?sslmode=require\""
  echo ""
  echo "Neon Connection String-i hardan tapmaq:"
  echo "  1. https://console.neon.tech açın"
  echo "  2. Layihənizi seçin → Settings → Connection Details"
  echo "  3. Connection string-i kopyalayın"
  echo ""
  exit 1
fi

DATABASE_URL="$1"

# ── pg_dump yoxlaması ──
if [ ! -f "$PG_DUMP" ]; then
  # PATH-dakı pg_dump-ı yoxla
  PG_DUMP="$(which pg_dump 2>/dev/null || true)"
  if [ -z "$PG_DUMP" ]; then
    echo "❌ pg_dump tapılmadı! Quraşdırmaq üçün:"
    echo "   brew install libpq && brew link --force libpq"
    exit 1
  fi
fi

# ── Backup faylının adı ──
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="$(cd "$(dirname "$0")/.." && pwd)/backups"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="${BACKUP_DIR}/ironwaves_backup_${TIMESTAMP}.dump"
SQL_FILE="${BACKUP_DIR}/ironwaves_backup_${TIMESTAMP}.sql"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║    iRonWaves POS — Database Backup           ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "📅 Tarix:     $(date '+%Y-%m-%d %H:%M:%S')"
echo "📂 Qovluq:    $BACKUP_DIR"
echo "🔧 pg_dump:   $PG_DUMP"
echo ""

# ── Custom format backup (restore üçün ideal) ──
echo "⏳ Custom format backup alınır..."
"$PG_DUMP" --no-owner --no-acl -Fc "$DATABASE_URL" > "$BACKUP_FILE" 2>&1
DUMP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "✅ Custom backup hazırdır: $BACKUP_FILE ($DUMP_SIZE)"

# ── Plain SQL backup (oxunaqlı) ──
echo "⏳ SQL format backup alınır..."
"$PG_DUMP" --no-owner --no-acl "$DATABASE_URL" > "$SQL_FILE" 2>&1
SQL_SIZE=$(du -sh "$SQL_FILE" | cut -f1)
echo "✅ SQL backup hazırdır:    $SQL_FILE ($SQL_SIZE)"

echo ""
echo "══════════════════════════════════════════════"
echo "✅ Backup uğurla tamamlandı!"
echo ""
echo "📦 Fayllar:"
echo "   .dump  → $BACKUP_FILE"
echo "   .sql   → $SQL_FILE"
echo ""
echo "🔄 Restore etmək üçün:"
echo "   pg_restore --no-owner --no-acl -d \"\$YENI_DB_URL\" $BACKUP_FILE"
echo ""
echo "📖 SQL faylı oxumaq üçün:"
echo "   less $SQL_FILE"
echo "══════════════════════════════════════════════"
