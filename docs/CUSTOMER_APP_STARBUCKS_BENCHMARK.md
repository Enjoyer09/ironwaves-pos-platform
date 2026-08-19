# Customer App — Starbucks Benchmark Qərarı

> **Dil seçimi:** [English version](CUSTOMER_APP_STARBUCKS_BENCHMARK_EN.md) · **Tarix:** 2026-08-17 · **Qərar:** Starbucks skelet + Apple/Linear glass dəri

---

## 1. Qərar

**Starbucks-un skeleti + Apple/Linear-in glass dərisi = beynəlxalq səviyyəli UI.**

Tim Hortons (RBI loyalty) app-i analiz edildi (Play 3.2★, 145k review) — uğursuz benchmark.
Starbucks eyni kateqoriyada (kofe + loyalty + order ahead) **qalibdir**: Play **4.8★** (1.5M+),
App Store **4.9★** (8.2M rating). Bizim IA artıq Starbucks-un güzgüsüdür (Home / Kart / Sifariş /
Rewards) — yenidən qurma yox, **cilalama** lazımdır.

| Qat | Mənbə | Nəyi kopyalayırıq |
|---|---|---|
| Struktur / UX | **Starbucks** | Bottom nav, ulduz progress, order-ahead axını, bir toxunuşla reorder |
| Görünüş (aesthetic) | **Apple macOS glass / Linear / Raycast** | Tünd glass, aurora, blur, 1px işıq kənarları |
| Sifariş izləmə | **Wolt** | Canlı status animasiyası, "hazırdır" ekranı |
| POS tərəfi | **Toast / Square** | Layout nizam-intizamı |

## 2. IA Müqayisə Cədvəli

| Qat | Starbucks | Bizim Customer App | Fərq |
|---|---|---|---|
| Bottom nav | Home / Order / Rewards / Profil (4-5 tab) | Home / Order / Offers / Barista / Falçı / Profile (6 tab) | ⚠️ 6 tab çoxdur — Barista/Falçı ikinci səviyyəyə |
| Home ekranı | Salam + kart (balans birinci) + reorder çipləri | Tier kartı + ulduzlar + "Sizin üçün" + Mükafatlarım | ✅ Uyğun + one-tap reorder əlavə olundu |
| Rewards | Ulduz progress + "aktivləşdirilmiş mükafatlar" | Ulduz progress + claim kodları + tier | ✅ Statuslu "Mükafatlarım" əlavə olundu |
| Order axını | Mağaza seçimi + pickup seçimi | Pre-order (mağaza seçimi yoxdur) | ⚠️ Mağaza/pickup çatışmır |
| Scan & Pay | Ödəniş + xal bir skanda | QR yalnız wallet pass açır | 🔴 Ən böyük boşluq |
| Favorites | Saxlanmış kustomizasiyalar | favoriteItems (tarixçədən) | ✅ One-tap reorder ilə bağlandı |

## 3. Prinsip: "Starbucks Skelet + Glass Dəri"

1. **IA Starbucks-dan** — istifadəçilər tanış axınları görəndə "tanış və rahat" hiss edir.
2. **Görünüş Apple/Linear glass-dan** — bizim `glass` sistemi (`.customer-app-wrapper`,
   `cust-glass` blur+saturate, hairline, yumşaq kölgə) artıq qurulub; eyni dəri customer
   app-ə də tətbiq olunur (U1 CSS keçidi bunun əsasıdır).
3. **Tim Hortons dərsi: uğursuzu yox, qalibi kopyala** — sürət, sinxronluq, sadəlik
   qazandırır (biz artıq tətbiq etdik: lazy chunk, payload fix, idempotency).
4. **Funksionallıq kopyalanmır, mənimsənilir** — hər xüsusiyyət bizim backend və
   qaydalarımıza uyğun adaptasiya olunur (məs. claim → server təsdiqi P1-4).

## 4. Kopyalanan Xüsusiyyətlərin Statusu

| # | Xüsusiyyət | Starbucks analoqu | Status |
|---|---|---|---|
| 1 | **One-tap reorder** | "Add favorites with one tap" | ✅ Hazır (2026-08-17) — tam tarixçə payloadu + cart merge + toast + Order tab keçidi |
| 2 | **Aktivləşdirilmiş mükafatlar** | "Activated rewards" bölməsi | ✅ Hazır (2026-08-17) — statuslu "Mükafatlarım" (PENDING/REDEEMED + tarix) |
| 3 | **Tier sistemi** | Green → Gold + eksklüzivlik | ✅ Hazır (P1-1) — Bronze/Silver/Gold + progress bar |
| 4 | **Birthday reward** | Pulsuz içki | ✅ Hazır (P1-2) — scheduler + push |
| 5 | **Canlı sifariş statusu** | Order tracking | ✅ Hazır (P0-2) — NEW→PREPARING→READY + push |
| 6 | **Server təsdiqli kampaniyalar** | Personalized offers | ✅ Hazır (P1-4/4b/4c) — tək istifadə + max endirim |
| 7 | **Ulduz progress bar** | "X ulduz → növbəti mükafat" | ✅ Hazır |
| 8 | **Scan & Pay** | Ödəniş + xal bir skanda | ⏳ Planlanıb (P0 — ən böyük boşluq) |
| 9 | **Mağaza seçimi + pickup UX** | Store selection + mobile pickup | ⏳ Planlanıb |
| 10 | **Bottom nav sadələşdirmə** | 4 tab IA | ⏳ Planlanıb (6 → 4-5 tab) |

## 5. Tim Hortons Dərsləri (qaçmalı)

| Problem (TH 3.2★ şikayətləri) | Bizim vəziyyət |
|---|---|
| Yavaş yüklənmə (ən çox şikayət) | ✅ Lazy chunks + virtualizasiya + memo |
| Sifariş sinxronizasiya bug-ları | ✅ payload=None fix + card_id migration + idempotency |
| Qarışıq naviqasiya (redundant girişlər) | ⚠️ 6 tab riski — sadələşdirmə planlanıb |
| Etibarsızlıq / ikiqat ödəniş | ✅ Server təsdiqi + tək istifadə garantiyası |

## 6. Əlaqəli Sənədlər

- [CUSTOMER_APP_AUDIT.md](CUSTOMER_APP_AUDIT.md) — customer app audit (AZ)
- [CUSTOMER_APP_UI_AUDIT.md](CUSTOMER_APP_UI_AUDIT.md) — UI/UX dərin audit (AZ)
- [UI_WORLDCLASS_ROADMAP.md](UI_WORLDCLASS_ROADMAP.md) — dünya-səviyyəsi yol xəritəsi (AZ)
- [CUSTOMER_APP_STARBUCKS_BENCHMARK_EN.md](CUSTOMER_APP_STARBUCKS_BENCHMARK_EN.md) — bu sənədin ingiliscəsi
