# iRonWaves Finance Security Checklist

Bu checklist release öncəsi maliyyə axınlarının təhlükəsizlik və audit baxımından yoxlanması üçündür.

## 1) Approval və Access

- `investor_repayment` approval tələb edirsə birbaşa `posted` getməməlidir.
- `cash_adjustment` üçün policy + threshold qaydası `X-report`, `Z-report`, `handover accept` axınlarında eyni işləməlidir.
- Transaction yaradan user öz transaction-ını approve edə bilməməlidir (`self-approval block`).
- `finance write` endpoint-ları yalnız icazəli rollar üçün açıq olmalıdır.

## 2) Double-entry və Posting Safety

- `post_existing_transaction()` duplicate ledger entry olduqda `409` qaytarmalıdır.
- Reversal request-də aktiv reversal varsa ikinci reversal bloklanmalıdır.
- Reversal post ediləndə orijinal transaction `reversed` statusuna keçməlidir.
- `amount <= 0` həm kodda, həm DB constraint səviyyəsində bloklanmalıdır.

## 3) Shift / Cash Control

- `expected_cash` hesabı bütün modullarda eyni helper-dən gəlməlidir.
- `handover` və `report close` axınlarında lock (`FOR UPDATE`) istifadə olunmalıdır.
- `Z-report` bağlanışında `actual_cash`, `declared_cash`, `cash_variance`, `closing_cash` DB-yə yazılmalıdır.
- `open_shift` zamanı `funding_source=cash` + `topup_amount>0` bloklanmalıdır (approval bypass olmamalıdır).

## 4) Deposit Liability

- Açıq depozit öhdəliyi ilə Z-report bağlama yalnız explicit override (`allow_open_deposit_close=true`) ilə olmalıdır.
- Override olduqda settle-dən sonra depozit qalığı yenidən yoxlanmalı, qalıq varsa bağlanış bloklanmalıdır.
- `deposit_refund` yalnız `cash/card/safe` source ilə işləməlidir.

## 5) Reports və Data Integrity

- P&L-də `COGS` coverage göstəricisi görünməlidir (`has_uncomputed_cogs`, `coverage_percent`).
- Cash flow adjustment hesabı direction-aware olmalıdır (`cash` source/destination üzrə).
- Balance sheet `balanced` flag-i müstəqil ledger equity əsasında hesablanmalıdır.
- Reconciliation response-də account adı/kodu `account_id` üzərindən join ilə qaytarılmalıdır.

## 6) Performance və Stability

- `_finance_alerts()` N+1 sorğulardan qaçmalıdır (snapshot bir dəfə alınmalıdır).
- anomaly snapshot yazılışında qısa TTL guard olmalıdır (tez-tez eyni sorğuda DB yükü azaltmaq üçün).
- Read-only endpoint-lar (`GET`) `commit` etməməlidir.

## 7) Release Gate (Qısa)

- Migrations `head` ilə tətbiq olunub (`alembic current == heads`).
- `py_compile` və test suite keçib.
- Finance smoke ssenariləri manual yoxlanıb:
  - investor repayment
  - x/z report adjustment
  - handover accept
  - deposit close/refund
  - reversal

