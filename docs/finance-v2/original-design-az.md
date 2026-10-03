> **HISTORICAL (written 2026-09-29, before implementation).** This was the first design proposal. The implementation deviates in places:
> table names (`gl_fiscal_periods`, no `gl_fiscal_years`; `gl_documents` + `gl_document_allocations` instead of `ap_bills/ap_payments/ap_allocations`),
> phase numbering (real phases: P0, P1, P1b, P2a-P2d, P3a, WP3; see `docs/FINANCE_V2_START_HERE.md` section 4), and `partners`, `tax_codes`, bank reconciliation, budgets were not built.
> For what exists now read `docs/FINANCE_V2_HANDOFF.md`. Keep this file only for the reasoning behind the architecture.

# Maliyyə Modulu v2 — Enterprise GL Arxitekturası

## 1. Mövcud vəziyyət (qısa diaqnoz)

Hazırkı ledger "yarım double-entry"dir: hər əməliyyat 1 debit + 1 kredit sətri yazır, amma arxitektura enterprise səviyyəsinə çıxmağa imkan vermir.

| Problem | Nəticə |
|---|---|
| Əməliyyat başlığında yalnız `source → destination` cütü var | Mürəkkəb jurnal mümkün deyil (satış + ƏDV + komissiya + COGS = 4 ayrı əməliyyat) |
| Debit = Kredit DB səviyyəsində yoxlanmır | Balans yalnız kodun "düz yazmasına" güvənir |
| 12 hesab hardcode, `payable` səhvən `investor_liability` tipindədir | Hesablar planı yoxdur, kapital hesabı yoxdur, balans hesabatı balanslaşmır |
| Dövr (period) və `posting_date` yoxdur | Ay bağlanışı, geriyə tarixli yazı qadağası, audit mümkün deyil |
| 3 həqiqət mənbəyi: ledger, legacy `finance_entries`, `Sale` cədvəli | P&L satışdan, balans ledger-dən, void-lar legacy-dən — rəqəmlər bir-birini tutmur |
| ~71 dağınıq posting nöqtəsi, idempotency yoxdur | Təkrar yazı, unudulmuş yazı riski |
| Balans hər oxunuşda bütün sətirlərdən yenidən hesablanır, `FOR UPDATE` bütün sətirləri kilidləyir | Data böyüdükcə yavaşlayacaq |
| Filial, valyuta, vergi, AP/AR subledger, bank reconciliation yoxdur | |
| Core cədvəllər Alembic-lə deyil, `create_all` ilə yaranır | Sxem dəyişiklikləri idarəolunmazdır |

**Qərar tövsiyəsi:** mövcudu yamamaq yox, yeni GL nüvəsini ayrıca qurub köhnə datanı ona köçürmək (strangler pattern). Data atılmır — mövcud ledger artıq balanslı olduğu üçün jurnallara 1:1 çevrilə bilir.

---

## 2. Hədəf arxitektura

```
 POS / Restoran / Anbar / Təchizatçı / Növbə (domain modullar)
            │  domain hadisələri: SaleCompleted, SaleVoided, ShiftClosed,
            │  StockReceived, SupplierBillPosted, DepositHeld ...
            ▼
 ┌──────────────────────────────────────────────┐
 │  Accounting Events + Posting Rules            │  hadisə → hesab xəritəsi (tenant üzrə konfiqurasiya)
 └──────────────────────────────────────────────┘
            ▼
 ┌──────────────────────────────────────────────┐
 │  GL Posting Engine  (yeganə yazma nöqtəsi)     │  idempotency, balans, dövr, kilid, audit
 └──────────────────────────────────────────────┘
            ▼
  gl_journals / gl_journal_lines / gl_balances   (dəyişməz, append-only)
            ▼
  Subledgers: AP · AR · Bank · Kassa/Növbə · Depozit · İnvestor · ƏDV
            ▼
  Hesabatlar: Trial Balance · Balans · P&L · Pul axını · GL detal · Aging · ƏDV · Z
```

**Əsas prinsiplər**
1. **Tək yazma yolu.** Heç bir router birbaşa ledger-ə yazmır; yalnız `post_journal()` və ya hadisə → qayda.
2. **Dəyişməzlik.** Post olunmuş sətir heç vaxt UPDATE/DELETE olunmur; düzəliş yalnız storno (reversal) jurnalı ilə.
3. **Invariantlar DB-də.** Postgres trigger-ləri: jurnal balansı (deferred), bağlı dövrə yazı qadağası, post olunmuş sətrin dəyişməzliyi.
4. **Hesabatlar yalnız GL-dən.** `Sale` cədvəli operativ məlumatdır, maliyyə həqiqəti deyil.

---

## 3. Data modeli (yeni cədvəllər)

| Cədvəl | Məqsəd | Əsas sahələr |
|---|---|---|
| `gl_accounts` | Hesablar planı (ağac) | `code`, `name`, `parent_id`, `type` (asset/liability/equity/revenue/expense), `normal_side`, `is_postable`, `system_role` (cash_drawer, ar, ap, vat_output…), `currency`, `requires_partner`, `is_active` |
| `gl_fiscal_years`, `gl_periods` | Maliyyə ili və aylar | `status`: open / soft_closed / closed; `closed_by/at` |
| `gl_journals` | Jurnal başlığı | `journal_no` (ardıcıl, boşluqsuz), `journal_type` (sales, purchase, cash, bank, general, adjustment, closing), `posting_date`, `period_id`, `branch_id`, `source_module`, `source_doc_type/id`, **`idempotency_key` UNIQUE**, `status` (draft/pending/posted/reversed), `reversal_of_id`, maker/checker sahələri |
| `gl_journal_lines` | Sətirlər (N ədəd) | `account_id`, `debit`, `credit` (biri 0), `currency`, `fx_rate`, `amount_base`, `branch_id`, `cost_center_id`, `partner_id`, `tax_code_id`, `memo` |
| `gl_balances` | Materiallaşdırılmış qalıqlar | `account × period × branch` üzrə debit/kredit cəmi, eyni tranzaksiyada yenilənir → balans sorğusu O(1) |
| `partners` | Kontragentlər | təchizatçı / müştəri / investor / işçi (vahid) |
| `ap_bills`, `ap_payments`, `ap_allocations` | Kreditor borcları | faktura, ödəniş, uyğunlaşdırma, aging |
| `ar_invoices`, `ar_receipts` | Debitor borcları (nisyə) | |
| `tax_codes`, `tax_lines` | ƏDV / sadələşdirilmiş vergi | 18% ƏDV, 0%, azad; ƏDV bəyannaməsi üçün |
| `bank_statements`, `bank_statement_lines`, `bank_matches` | Bank reconciliation | CSV/Excel import, avtomatik uyğunlaşdırma |
| `posting_rules` | Hadisə → hesab xəritəsi | tenant hesab planını dəyişə bilsin, kod dəyişmədən |
| `doc_sequences` | Nömrələmə | `JV-2026-000123` |
| `fin_audit_log` | Hash-zəncirli audit | hər qeyd əvvəlkinin hash-ini saxlayır → dəyişdirmə aşkarlanır |
| `attachments` | Qəbz/faktura şəkilləri | |

Bütün cədvəllərdə `tenant_id` + tenant-daxili composite FK (başqa tenantın hesabına istinad fiziki olaraq mümkünsüz).

**Hesablar planı:** Azərbaycan Milli Hesablar Planı əsasında seed (məs. 221 Kassa, 223 Bank, 205 Mallar, 531 Təchizatçılara borc, 601 Satış, 701 Satışın maya dəyəri, 721 İnzibati xərclər, 301 Nizamnamə kapitalı, 343 Bölüşdürülməmiş mənfəət). Dəqiq xəritə mühasib tərəfindən təsdiqlənməlidir.

---

## 4. Posting engine

```python
post_journal(
    tenant_id, journal_type, posting_date, lines=[...],
    source=("sale", sale_id), idempotency_key="sale:{id}:v1",
    branch_id=..., created_by=..., require_approval=None,
) -> Journal
```

Yoxlamalar (hamısı bir DB tranzaksiyasında):
1. `idempotency_key` artıq varsa → mövcud jurnalı qaytar (təkrar yazı yoxdur).
2. Σdebit = Σkredit (base valyutada), ≥ 2 sətir, məbləğlər > 0.
3. Hesablar aktiv, postable, eyni tenant; `requires_partner` olan hesabda partner var.
4. Dövr `open`-dur (soft_closed → yalnız controller rolu).
5. Təsdiq qaydası (rules engine: tip, məbləğ, hesab, rol) → `pending` və ya `posted`.
6. Mənfi qalıq qadağası olan hesablarda (kassa, seyf) `gl_balances` sətri kilidlənir və yoxlanır.
7. `gl_balances` yenilənir, audit hash yazılır, `journal_no` ayrılır.

Satış nümunəsi (bir jurnal, 5 sətir):

| Hesab | Debit | Kredit |
|---|---|---|
| 223 Bank (kart) | 98.00 | |
| 731 Bank komissiyası | 2.00 | |
| 601 Satış | | 84.75 |
| 521 ƏDV öhdəliyi | | 15.25 |
| 701 Maya dəyəri / 205 Mallar | 31.00 / | / 31.00 |

---

## 5. Nəzarət və rollar (SoD)

| Rol | Hüquq |
|---|---|
| Kassir | Yalnız POS hadisələri (dolayı posting), öz növbəsinin Z-hesabatı |
| Mühasib | Jurnal hazırlamaq, AP/AR, bank reconciliation |
| Controller / Maliyyə direktoru | Təsdiq, dövr bağlanışı, storno |
| Auditor | Yalnız oxu + audit log |
| Admin | Konfiqurasiya (hesab planı, qaydalar), amma öz jurnalını təsdiq edə bilməz |

Maker-checker: yaradan ≠ təsdiqləyən, istisnasız (admin daxil). Limitlər və qaydalar tenant konfiqurasiyasıdır.

---

## 6. Hesabatlar (hamısı GL-dən, `as_of` / dövr / filial filtri ilə)

Trial Balance · Balans hesabatı (həmişə balanslı — invariantdan gəlir) · Mənfəət və zərər · Pul vəsaitlərinin hərəkəti (birbaşa metod) · Hesab üzrə GL detal (drill-down → mənbə sənəd) · AP/AR aging · ƏDV hesabatı · Növbə/Z-hesabat (GL ilə avtomatik tutuşdurma) · Excel/PDF export.

---

## 7. Köçürmə planı (data itkisi olmadan)

1. Yeni cədvəllər Alembic ilə (mövcudlara toxunmadan).
2. 12 köhnə hesab → yeni hesab planına xəritə.
3. Hər `finance_transaction` + 2 ledger sətri → `gl_journal` + 2 sətir (orijinal id `legacy_ref`-də saxlanır).
4. **Yoxlama:** hər hesab üzrə köhnə və yeni qalıq eyni olmalıdır; fərq varsa köçürmə dayanır.
5. Açılış balansı / kapital düzəlişi jurnalı (indi kapital hesabı olmadığı üçün).
6. Dual-write mərhələsi → hesabatlar yeni GL-ə keçir → köhnə yazma yolları bağlanır → legacy cədvəllər read-only arxivə.

Production-dan əvvəl: tam DB backup + staging-də prod datasının surəti üzərində sınaq.

---

## 8. Mərhələlər

| # | Mərhələ | Nəticə | Təxmini həcm |
|---|---|---|---|
| P0 | GL nüvəsi | Modellər, migration, posting engine, DB invariantları, hesablar planı, dövrlər, 100+ test | böyük |
| P1 | Köçürmə + posting qaydaları | Köhnə data köçürülür, 71 posting nöqtəsi hadisə/qayda üzərinə keçir | ən riskli |
| P2 | Hesabatlar + dövr bağlanışı | TB, balans, P&L, pul axını, Z-hesabat GL-dən; ay bağlanışı checklist | orta |
| P3 | AP / AR | Təchizatçı fakturaları, ödənişlər, nisyə, aging | orta |
| P4 | ƏDV + bank reconciliation | Vergi kodları, bəyannamə hesabatı, bank çıxarışı importu | orta |
| P5 | Frontend yenidən qurulması | Modullara bölünmüş Maliyyə iş sahəsi (2487 sətirlik `FinancePanel` əvəzinə) | böyük |
| P6 | Büdcə, çoxvalyuta, filial konsolidasiyası | | orta |

Hər mərhələ ayrıca işlək, test olunmuş və deploy oluna bilən vəziyyətdə bitir.

---

## 9. Dürüst qeyd

Oracle Fusion/EBS səviyyəsi onilliklərin və minlərlə mühəndisin işidir (konsolidasiya, intercompany, XBRL, dəqiq lokalizasiyalar). Burada hədəf **o sistemlərin nüvə prinsiplərini** — dəyişməz double-entry GL, dövr nəzarəti, SoD, subledger-lər, audit izi, GL-dən hesabatlar — restoran/POS biznesi üçün düzgün qurmaqdır. Bu, real audit və vergi yoxlamasından keçə biləcək səviyyədir.
