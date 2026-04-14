# Maliyyə Production Hardening Runbook

Bu sənəd iRonWaves POS maliyyə modulunun production səviyyəsində idarəsi üçündür. Məqsəd schema dəyişikliklərini, migration-ları, backup/restore yoxlamasını və rollback qərarlarını nəzarətli aparmaqdır.

## 1. Deploy-dan əvvəl yoxlama

1. Production database üçün Neon snapshot/PITR aktiv olmalıdır.
2. Railway backend env-lərində bu dəyərlər yoxlanmalıdır:
   - `DATABASE_URL`
   - `APP_ENV=production`
   - `STARTUP_SCHEMA_GUARD_ENABLED=true`
   - `ALLOW_LEGACY_TENANT_HEADER_FALLBACK=false`
   - `SENTRY_DSN` varsa aktiv, yoxdursa boş qala bilər
   - `REDIS_URL` varsa rate-limit multi-replica rejimində aktiv olur
3. Local və ya staging-də build keçməlidir:

```bash
python3 -m py_compile backend/app/main.py backend/app/models.py backend/app/routers/finance.py
npm run build
```

## 2. Alembic migration qaydası

Migration-lar backend qovluğundan işlədilir:

```bash
cd backend
alembic -c alembic.ini upgrade head
```

Production-da migration deploy-dan əvvəl ayrıca addım kimi işlədilməlidir. Əgər Railway deploy zamanı app startup migration-ları hələ də aktivdirsə, Alembic migration-lar idempotent saxlanmalıdır.

## 3. Rollback qaydası

Kod rollback:

```bash
git checkout <previous_release_tag>
```

DB rollback yalnız təsdiqlənmiş halda:

```bash
cd backend
alembic -c alembic.ini downgrade -1
```

Maliyyə transaction-ları production-da artıq yazılıbsa, DB downgrade-dan əvvəl mütləq Neon snapshot götürülməlidir.

## 4. Maliyyə data sanity check

Deploy-dan sonra bu yoxlamalar edilməlidir:

1. `GET /health` 200 qaytarır.
2. `GET /api/v1/finance/balances` işləyir.
3. `GET /api/v1/finance/reports/overview` işləyir.
4. Maliyyədə investor borcu ledger ilə görünür.
5. Pending approval yarat, eyni user ilə approve etməyə çalış və bloklandığını yoxla.
6. Başqa manager/admin ilə approve et və ledger entry-lərin iki sətr yaratdığını yoxla.
7. `audit_logs` içində aşağıdakı action-lar görünməlidir:
   - `FINANCE_TRANSACTION_POSTED`
   - `FINANCE_TRANSACTION_APPROVED`
   - `FINANCE_TRANSACTION_SELF_APPROVAL_BLOCKED` yalnız test zamanı

## 5. Backup / restore proseduru

Restore test yalnız staging tenant və ya staging DB-də edilməlidir.

1. Restore öncəsi snapshot götür.
2. Restore faylını validate et.
3. Restore-dan sonra bu modullar yoxlanmalıdır:
   - menu items
   - customers / CRM
   - finance transactions
   - finance ledger entries
   - investor liability
   - tables
   - reservations
4. Restore production DB-də uğursuz olarsa, browser local cache ilə yox, server log və DB snapshot ilə qərar ver.

## 6. Monitorinq

Sentry aktivdirsə izlənməli tag-lər:

1. `tenant_id`
2. `user`
3. `transaction_id`
4. finance endpoint path

Əsas alarm-lar:

1. `500` finance endpoint-lərində artırsa
2. `FINANCE_TRANSACTION_DUPLICATE_POST_BLOCKED` görünürsə
3. investor ledger mismatch davamlı çıxırsa
4. cash reconciliation gap böyüyürsə
5. restore endpoint timeout/500 verirsə

## 7. Legacy-dən ledger-first keçid qaydası

Hazırda legacy wallet sync compatibility layer kimi qalır. Tam söndürmə üçün ardıcıllıq:

1. Staging-də `finance_policy.legacy_wallet_sync_enabled=false` test et.
2. Ledger balansları ilə UI summary uyğun gəlməlidir.
3. Z/X report və investor borcu ledger-dən düzgün görünməlidir.
4. Production-da əvvəl 1 tenant üçün söndür.
5. 48 saat audit et.
6. Problem yoxdursa bütün tenant-lara mərhələli tətbiq et.

## 8. Release checklist

1. Migration tətbiq edildi.
2. Backend health check keçdi.
3. Finance reports endpoint keçdi.
4. UI build keçdi.
5. Sentry/monitoring yoxlandı.
6. Rollback tag hazırdır.
7. Neon snapshot vaxtı qeyd edildi.
