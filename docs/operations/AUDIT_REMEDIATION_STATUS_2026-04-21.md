# Audit Remediation Status (2026-04-21)

Bu sənəd audit fix/patch mərhələsinin cari bağlanma statusunu göstərir.

## 1) Approval və Access

- [x] `investor_repayment` approval qaydası qorunur, bypass edilmir.  
  Evidence: `backend/app/routers/finance.py`, `backend/app/services/finance_service.py`
- [x] `cash_adjustment` threshold/policy eyni qayda ilə `X-report`, `Z-report`, `handover accept` axınlarında işləyir.  
  Evidence: `backend/app/routers/reports.py`
- [x] self-approval block aktivdir.  
  Evidence: `backend/app/routers/finance.py`
- [x] finance write endpoint-ları rol yoxlaması ilə qorunur.  
  Evidence: `backend/app/routers/finance.py`

## 2) Double-entry və Posting Safety

- [x] duplicate ledger post `409` ilə bloklanır.  
  Evidence: `backend/app/services/finance_service.py`
- [x] aktiv reversal olduqda ikinci reversal bloklanır.  
  Evidence: `backend/app/routers/finance.py`
- [x] reversal post ediləndə original transaction `reversed` olur.  
  Evidence: `backend/app/services/finance_service.py`
- [x] `amount > 0` həm kodda, həm DB constraint-də məcburidir.  
  Evidence: `backend/app/models.py`, `backend/app/routers/finance.py`

## 3) Shift / Cash Control

- [x] `expected_cash` vahid helper-dən gəlir.  
  Evidence: `backend/app/services/finance_service.py`, `backend/app/routers/reports.py`
- [x] `handover` və `report close` axınlarında `FOR UPDATE` tətbiq edilib.  
  Evidence: `backend/app/routers/reports.py`
- [x] `Z-report` bağlanış sahələri (`actual_cash`, `declared_cash`, `cash_variance`, `closing_cash`) yazılır.  
  Evidence: `backend/app/routers/reports.py`
- [x] `open_shift` zamanı `funding_source=cash` + `topup_amount>0` bloklanır.  
  Evidence: `backend/app/routers/reports.py`, test: `backend/tests/test_open_shift_cash_source.py`

## 4) Deposit Liability

- [x] open deposit ilə Z close yalnız explicit override ilə mümkündür.  
  Evidence: `backend/app/routers/reports.py`
- [x] override sonrası depozit yenidən yoxlanır, qalıq qalarsa close bloklanır.  
  Evidence: `backend/app/routers/reports.py`, test: `backend/tests/test_z_report_deposit_close.py`
- [x] `deposit_refund` source qaydası məhduddur (`cash/card/safe`).  
  Evidence: `backend/app/routers/finance.py`, test: `backend/tests/test_deposit_refund_semantics.py`

## 5) Reports və Data Integrity

- [x] P&L COGS coverage göstəricisi var.  
  Evidence: test `backend/tests/test_profit_loss_cogs_estimation.py`
- [x] cash flow adjustment direction-aware hesablanır.  
  Evidence: test `backend/tests/test_cash_flow_adjustment_direction.py`
- [x] balance sheet `balanced` flag ledger logic ilə yoxlanır.  
  Evidence: test `backend/tests/test_balance_sheet_balanced_flag.py`
- [x] reconciliation response account join `account_id` üzərindən gəlir.  
  Evidence: `backend/app/routers/finance.py`

## 6) Performance və Stability

- [x] `_finance_alerts()` snapshot-ları bir dəfə alır, hesablamanı təkrarlamır.  
  Evidence: `backend/app/routers/finance.py`
- [x] anomaly snapshot TTL guard aktivdir.  
  Evidence: `backend/app/routers/finance.py`
- [x] read-only `GET /finance/anomalies` artıq write etmir.  
  Evidence: `backend/app/routers/finance.py`
- [x] anomaly snapshot yazılışı ayrıca endpoint-ə ayrılıb (`POST /finance/anomalies/snapshot`).  
  Evidence: `backend/app/routers/finance.py`

## 7) Feedback Security (Audit Critical)

- [x] feedback coupon abuse guard: canonical `sale.id` ilə dedupe.  
  Evidence: `backend/app/routers/customer_feedback_ops.py`
- [x] receipt token doğrulaması sərtləşdirilib (`by-receipt` daxil).  
  Evidence: `backend/app/routers/customer_feedback_ops.py`
- [x] coupon original sale üzərində redeem bloklanır.  
  Evidence: `backend/app/routers/customer_feedback_ops.py`
- [x] regressiya testləri əlavə edilib.  
  Evidence: `backend/tests/test_feedback_coupon_guards.py`

## 8) CI/Test Status

- [x] Backend test suite yaşıl.
  - Command: `cd backend && DATABASE_URL=sqlite:///./ci_test.db JWT_SECRET=test-secret SUPERADMIN_PASSWORD=test-pass .venv/bin/python -m pytest -q`
  - Result: `ss...................................` (pass)

## 9) Release Gate Qalan Manual Addımlar

- [x] release gate helper script əlavə olundu: `backend/scripts/release_gate_check.py`
  - local check (stamp edilmiş test DB ilə) uğurlu: `alembic current == heads`
  - smoke testi eyni skriptdən `RUN_SMOKE_TEST=1` ilə çağırmaq mümkündür.
- [x] `alembic current == heads` production/staging DB üzərində run edilib.
- [x] smoke ssenariləri canlı mühitdə manual təsdiqlənib (`investor repayment`, `x/z report`, `handover accept`, `deposit close/refund`, `reversal`).

## 10) Audit Closure

- Status: **CLOSED**
- Closure date: **2026-04-21**
- Closure basis:
  - Kod və test remediation maddələri tamamlanıb.
  - Startup crash kök səbəbi (demo env guard) aradan qaldırılıb və deploy stabil işləyir.
  - Tenant/login domen axını üçün diaqnostika və request-id izlənməsi əlavə edilib.
  - Son release gate və canlı yoxlama addımları operator tərəfindən tamamlandığı təsdiqlənib.
