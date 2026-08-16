# Customer App & Loyalty Mobil Tətbiq — Audit Hesabatı

> **Dil seçimi:** [English version](CUSTOMER_APP_AUDIT_EN.md) · **Tarix:** 2026-08-16 · **Əhatə:** `src/components/CustomerApp.tsx`, `src/components/customer/*`, `src/api/crm.ts`, `src/lib/customer_*`

---

## 1. Fəlsəfə və Metod

Bu audit desktop POS tərəfi üçün etdiyimiz dünya-standartı yanaşmasının (bax: [UI_COMPETITIVE_AUDIT.md](UI_COMPETITIVE_AUDIT.md)) eynisini customer app / loyalty mobil tətbiqinə tətbiq edir. Məqsəd — "nəyi inkişaf etdirməliyik" sualına **kod əsaslı, ölçülə bilən** cavab verməkdir.

**Benchmark mənbələri:**

| Mənbə | Əsas göstərici |
|---|---|
| Starbucks Rewards (dünya standartı) | 75M+ üzv, ABŞ gəlirinin **57%-i** loyalty üzvlərindən; üzvlər ziyarət başına **3×** çox xərcləyir |
| Markswebb UX tədqiqatı | Qeydiyyatdan **dərhal sonra** loyalty-a onboarding istifadəni artırır; qısa onboarding flow şərtdir |
| Costa / yerli loyalty app-lər | Mobil-first, personalizasiya, gamification, eksklüzivlik |

**Starbucks-un uğur prinsipləri (transfer edilə bilən):** asan qoşulma, hər alışda qazanma, sürətli ilk mükafat, progress barları, tier sistemi, doğum günü reward-ı, challenge-lar (Double Star Days), push ilə top-of-mind qalmaq.

**Audit sahələri:** ① Onboarding ② Kart UX ③ Sifariş axını ④ Loyalty proqramı ⑤ Performans.

---

## 2. Cari Vəziyyət Xülasəsi

| Qat | Vəziyyət |
|---|---|
| **Mobil shell** | ✅ Capacitor (Android + iOS qovluqları var), push-notifications, haptics, camera, background fetch, Live Activity |
| **Üzvlük kartı** | ✅ 3D-flip, QR, EMV chip, shimmer, Apple/Google Wallet pass, klassik + retro dizayn |
| **Loyalty** | ✅ Möhür kartı (10=1 pulsuz), points/cashback rejimi, `loyalty_ledger`, claim kodları + bilet vizualı, konfetti |
| **Sifariş** | ⚠️ Pre-order (menyu, modifier sheet, cart, OTP), amma **status izləmə və ödəniş yoxdur** |
| **AI** | ✅ AI Barista (chat + səs), AI Falçı (şəkil analizi), hava-əsaslı təkliflər (simulyasiya) |
| **Kampaniyalar** | ⚠️ Happy hour → QR aktivləşdirmə (client-side 15 dəq timer) |
| **İdarəetmə** | ✅ Admin `CustomerAppPanel` — 30+ parametr (rəng, mətn, rejim, toggle-lar) |
| **Dillər** | ✅ AZ / RU / EN |

**Texniki:** `customer.html` → `src/customer-main.tsx` → `CustomerApp` (lazy). Sessiya: native `CustomerSession` plugin / localStorage. Bundle: CustomerApp chunk **139KB** (lazy yüklənir ✓).

---

## 3. Onboarding

### Cari axın

1. Giriş: URL `?id=&t=` / `?join=1` / native sessiya → join rejimi açılır
2. Bootstrap (marka məlumatı) yüklənir → hero + dil seçici
3. Telefon nömrəsi → OTP göndər → 4 rəqəmli kod → yoxlanır
4. Kart yaradılır (`enroll`/`verify` — join tipi + endirim URL-dən gəlir), sessiya saxlanılır

### Tapıntılar

| # | Tapıntı | Şiddət | Dünya standartı |
|---|---|---|---|
| 1 | **Ad/soyad sorğusu yoxdur** — yeni kartda `customer.name` boşdur; profil "Müştəri" placeholder göstərir | 🔴 Yüksək | Starbucks ad soruşur → personalizasiya (salamlaşma, tövsiyələr) |
| 2 | **Açıq consent checkbox yoxdur** — mətn bloku + "Razıyam" düyməsi | 🟠 Orta | GDPR üçün açıq opt-in checkbox |
| 3 | **Doğum tarixi sorğusu yoxdur** — birthday reward üçün əsas məlumat | 🟠 Orta | Starbucks-un №1 perk-i |
| 4 | **Qoşulma bonusu yoxdur** — ilk alışda sürətli qazanma hissi yoxdur | 🟠 Orta | Starbucks ilk ziyarətlərdə hook |
| 5 | **Qonaq rejimi yoxdur** — menyuya baxmaq üçün belə qeydiyyat məcburidir | 🟠 Orta | Starbucks menyunu hesabsız göstərir |
| 6 | **Onboarding turu yoxdur** — "necə işləyir" izahı yoxdur | 🟡 Aşağı | Markswebb: qısa tur istifadəni artırır |
| 7 | **Referral / dəvət axını yoxdur** | 🟡 Aşağı | Viral böyümə mexanizmi |

---

## 4. Kart UX

### Güclü tərəflər (toxunulmayıb)

- 3D flip kart + EMV chip + glossy highlight + shimmer sweep — **premium hiss** ✅
- Möhür kartı (retro) və points rejimində **finjan dolu qrafiki** (progress animasiyası) — delight ✅
- Apple/Google Wallet pass linkləri ✅
- Konfetti + haptics ilə reward claim ✅

### Boşluqlar

| # | Tapıntı | Şiddət |
|---|---|---|
| 1 | **NFC yoxdur** — yalnız QR; NFC tag / Apple Pay kartı yoxdur | 🟡 Aşağı |
| 2 | **Offline kart yoxdur** — şəbəkə yoxdursa QR də göstərilmir; kassada "ölü telefon" pisi | 🟠 Orta |
| 3 | **Tier fərqliliyi kartda yoxdur** — bütün kartlar vizual eynidir (hamısı "Golden") | 🟠 Orta |
| 4 | Kartda **son əməliyyat** göstərilmir (yalnız balans) | 🟡 Aşağı |
| 5 | QR üçün **2 tap** lazımdır (flip) — "Scan & Earn" əlavə addımdır | 🟡 Aşağı |
| 6 | **1D barcode yoxdur** — köhnə skanerlər üçün | 🟡 Aşağı |

---

## 5. Sifariş Axını (Pre-Order)

### Cari axın

Menyu fetch → kateqoriya çipləri → məhsul gridi (şəkil, badge, reytinq, sevimli) → modifier sheet (variant/əlavə) → cart sheet (qeyd, cəm) → təsdiq → uğur dialoqu (order ID).

### Tapıntılar

| # | Tapıntı | Şiddət | Qeyd |
|---|---|---|---|
| 1 | **Order status izləmə YOXDUR** — "Sifariş Qəbul Olundu!"-dan sonra müştəri heç nə görmür (PREPARING/READY yoxdur, push yoxdur) | 🔴 **Kritik** | KDS-də status var, müştəri tərəfə gəlmir |
| 2 | **Saxta reytinqlər** — `ratingValue = 4.5 + (məhsul_adının_uzunluğu % 5) * 0.1` — reytinq ad uzunluğundan hesablanır! | 🔴 **Kritik** | ✅ Düzəldildi (2026-08-16) — badge və hesablama silindi |
| 3 | **Ödəniş yoxdur** — prepay yox, pickup ETA yox; "Confirm Order" kassada ödəniş deməkdir | 🟠 Orta | Starbucks mobil ödənişlə tamamlanır |
| 4 | **Cart sessiyada saxlanılmır** — app bağlananda itir | 🟠 Orta | |
| 5 | **Menyu hər tab açılışında yenidən fetch** — cache yoxdur | 🟡 Aşağı | |
| 6 | **Reorder yoxdur** — tarixçə var, amma "bir daha sifariş et" yoxdur | 🟡 Aşağı | |
| 7 | **Sevimlilər sifarişə qoşulmur** — çip-ə klik sadəcə order tab açar | 🟡 Aşağı | |
| 8 | CartSheet-də məhsul **şəkli yoxdur** (hardcoded ☕) | 🟡 Aşağı | |
| 9 | Allergen / nutrition məlumatı yoxdur | 🟡 Aşağı | |

---

## 6. Loyalty Proqramı

### Cari

İki rejim: **points** (ulduz → claim) və **cashback** (%-lə yığım). Möhür kartı, `loyalty_ledger`, happy hour kampaniyaları, claim kodları, push bildirişlər, Wallet pass, Live Activity (iOS lock screen).

### Tapıntılar

| # | Tapıntı | Şiddət | Qeyd |
|---|---|---|---|
| 1 | **Tier sistemi yoxdur** — `customer.type` var (golden/platinum/elite...), amma irəliləmə məntiqi yoxdur; hamı "Golden Member" görür | 🟠 Orta | Starbucks Green→Gold; status + eksklüzivlik psixologiyası |
| 2 | **Birthday reward yoxdur** | 🟠 Orta | Ən effektiv trigger |
| 3 | **Tək reward** — `wallet.rewards` yalnız `default-reward`; seçim kataloqu yoxdur | 🟠 Orta | Starbucks çoxsəviyyəli redemption |
| 4 | **Kampaniya aktivləşdirmə server-də təsdiqlənmir** — 15 dəq timer + QR tam client-side; server "activated" vəziyyəti saxlamır | 🟠 Orta | İstismar riski (eyni QR təkrar) |
| 5 | **Challenge / gamification yoxdur** — "Double Star Day", "həftədə 3 dəfə gəl" yoxdur | 🟡 Aşağı | Progress barları var, amma məqsədlər yoxdur |
| 6 | **Xal bitmə (expiry) siyasəti göstərilmir** | 🟡 Aşağı | |
| 7 | **Referral yoxdur** | 🟡 Aşağı | |
| 8 | Bəzi bildiriş mesajları **hardcoded AZ**-dədir (enroll, pre-order) | 🟡 Aşağı | `tx()` istifadə olunmayıb |

---

## 7. Performans

| # | Tapıntı | Şiddət | Qeyd |
|---|---|---|---|
| 1 | CustomerApp chunk **139KB** — lazy ✓, amma **6 tab tək chunk-da** (Falçı kamera + Barista səs ayrıla bilər) | 🟡 Aşağı | `CustomerApp-*.js` 139KB |
| 2 | **Geolocation `watchPosition` daimi işləyir** (high accuracy, maximumAge 0) — native-də batareya israfı | 🟠 Orta | One-shot + geofence plugin |
| 3 | **Offline cache yoxdur** — session, menyu, QR üçün SW yoxdur | 🟠 Orta | "Dead phone at counter" |
| 4 | **Hava simulyasiyadır** — temp saat əsasında fake; "Toggle Weather" düyməsi bunu açıqlayır | 🟡 Aşağı | Real API + həqiqi yer |
| 5 | **Geofence koordinatları hardcoded** (Bakı: 40.37767, 49.84583) — multi-tenant üçün səhv; settings-dən gəlməlidir | 🟠 Orta | Yalnız 1 kafeyə yaxınlaşanda işləyir |
| 6 | ✅ QR client-side, OneSignal `requestIdleCallback` ilə lazy, Live Activity, background sync — **güclü tərəflər** | — | |

---

## 8. Benchmark Cədvəli — Dünya Standartı vs Cari

| Xüsusiyyət | Starbucks / dünya standartı | Cari vəziyyət | Fərq |
|---|---|---|---|
| Qoşulma sürəti | 1 dəqiqə, ad + email | Telefon + OTP (ad yoxdur) | 🟠 |
| Qoşulma bonusu | İlk ziyarətlərdə sürətli qazanma | Yoxdur | 🔴 |
| Kart | NFC + QR + offline pass | QR (onlayn) | 🟠 |
| Tier sistemi | Green → Gold (vizual fərq) | Hamı "Golden" | 🔴 |
| Birthday perk | Pulsuz içki | Yoxdur | 🔴 |
| Sifariş | Mobil ödəniş + status + ETA | Pre-order, status/ödəniş yoxdur | 🔴 |
| Gamification | Double Star Days, challenge-lar | Progress barlar (məqsədsiz) | 🟠 |
| Personalizasiya | Ad, seçimlər, təkliflər | Ad yoxdur; sevimlilər lokal | 🟠 |
| Məlumat dürüstlüyü | Real reytinqlər | Saxta reytinq silindi | ✅ |
| Offline | Pass-lar offline | Tam onlayn | 🟠 |

---

## 9. Prioritetləşdirilmiş Yol Xəritəsi

| # | Prioritet | İş | Status |
|---|---|---|---|
| P0-1 | 🔴 Kritik | **Saxta reytinqləri sil** (OrderTab) — real data yoxdursa göstərmə | ✅ Hazır (2026-08-16) |
| P0-2 | 🔴 Kritik | **Order status izləmə** — KDS inteqrasiyası (NEW→PREPARING→READY) + push + canlı status ekranı | ✅ Hazır (2026-08-16) |
> **P0-2 test:** `backend/tests/test_customer_order_status_flow.py` — real SQLite ilə 5 E2E test (pre-order → accept → complete → push + legacy card_id yoxlaması); test `complete_kitchen_order` payload=None crash bug-ını da üzə çıxardı və düzəldildi.
> **Frontend smoke:** `npm run test:smoke` → `tests/crm_local_smoke.test.mjs` (get_customer_orders_live lokal fallback: tenant/card filtr, sort, 10-limit, roundtrip)
> **Reward claim test:** `backend/tests/test_customer_reward_claim_flow.py` — real SQLite ilə 6 test (RW kod formatı, in-app bildiriş, FCM push, pending limiti, custom threshold, sessiya mühafizəsi); claim endpoint-ə FCM push əlavə edildi (əvvəl yalnız in-app bildiriş idi).
> **KDS complete yoxlaması:** KDS.tsx canlı path-i body göndərir (`{ready_items}` → `/kitchen-feed/{round}/complete`); boş-body regression testi `test_customer_order_status_flow.py`-də (restaurant.py boş `{}` ilə crash etmir); legacy `/ops/kitchen-orders/{id}/complete` payload=None guard-ı artıq qorunur.
| P0-3 | 🔴 Yüksək | **Onboarding: ad sorğusu + açıq consent checkbox** | ✅ Hazır (2026-08-16) |
> **P0-3a:** `Customer.name` migration + OTP verify-də consent sətri (compliance boşluğu bağlandı) + ad/doğum tarixi input-ları + məcburi consent checkbox (düymə disabled) + `POST /customer-app/profile/name` — `backend/tests/test_customer_onboarding_flow.py` (5 test) + smoke.
| P1-1 | 🟠 Orta | **Tier sistemi** (Bronze/Silver/Gold) — kart vizualında fərqlilik + keçid hədləri | ✅ Hazır (2026-08-16) |
> **P1-1a (core):** `lifetime_stars` migration (backfill) + pos.py points-earn + `_compute_tier` + session `tier` sahəsi + kart/badge/progress UI — `backend/tests/test_customer_tier_system.py` (7 test) + smoke. Multiplier (P1-1b) ayrı fazadır.
| P1-2 | 🟠 Orta | **Birthday reward** (+ doğum tarixi sorğusu) | ✅ Hazır (2026-08-16) |
> **P1-2a (core):** `birth_date` migration + `birthday_scheduler` (Baku tz, gündəlik guard marker, il-əsaslı ledger idempotency) + grant (stars+lifetime+ledger+notification+push, default qapalı) + `POST /customer-app/profile/birthday` (format/keçmiş/yaş validasiyası) — `backend/tests/test_customer_birthday_reward.py` (12 test). Multi-worker advisory lock əlavə edildi (ümumi 20 test).
> **P1-2b:** ProfileTab ad/doğum tarixi redaktə UI — `update_customer_name_live`/`update_customer_birthday_live`; boş birth_date silmə (None). Admin konfiq UI (P1-2c) ayrı fazadır.
| P1-3 | 🟠 Orta | **Offline QR cache** — şəbəkə yoxdursa kart açılsın | ⏳ |
| P1-4 | 🟠 Orta | **Kampaniya server təsdiqi** — activated vəziyyəti backend-də | ⏳ |
| P2-1 | 🟡 Aşağı | **Qonaq rejimi** — hesabsız menyu baxışı | ⏳ |
| P2-2 | 🟡 Aşağı | **Reorder + sevimlilər → sifariş** | ⏳ |
| P2-3 | 🟡 Aşağı | **Ödəniş inteqrasiyası** (prepay + pickup ETA) | ⏳ |
| P2-4 | 🟡 Aşağı | **Referral** (dəvət et, ulduz qazan) | ⏳ |
| P2-5 | 🟡 Aşağı | **Geofence settings-dən** + log-out düyməsi (profil) | ⏳ |
| P2-6 | 🟡 Aşağı | **Tab-ları lazy split** (Falçı/Barista ayrı chunk) | ⏳ |

---

## 10. Double-Check Siyahısı (hər addımdan sonra)

1. `npx tsc --noEmit` — baza ilə eyni xəta sayı (yeni yox)
2. `npm run build` + müvafiq chunk ölçüsü yoxlaması
3. Dəyişən ekranın computed-style / vizual yoxlaması (web + native)
4. KDS / POS ilə inteqrasiya nöqtələri (status axını) uyğunluğu
5. Dillər (AZ/RU/EN) + klassik/retro dizayn rejimlərində yoxlama
6. Code review + sənəd statusunun yenilənməsi

---

## 11. Əlaqəli Sənədlər

- [UI_COMPETITIVE_AUDIT.md](UI_COMPETITIVE_AUDIT.md) — desktop POS rəqib auditı (AZ)
- [UI_WORLDCLASS_ROADMAP.md](UI_WORLDCLASS_ROADMAP.md) — dünya-səviyyəsi yol xəritəsi (AZ)
- [UI_AUDIT_GLASS.md](UI_AUDIT_GLASS.md) — glass UI texniki spec (AZ)
- [CUSTOMER_APP_AUDIT_EN.md](CUSTOMER_APP_AUDIT_EN.md) — bu sənədin ingiliscəsi

---

## 12. Texniki Spec: P1-1 Tier Sistemi

### Məqsəd
Müştərinin ömürlük qazandığı ulduzlara (`lifetime_stars`) görə Bronze/Silver/Gold
səviyyəsi təyin etmək və bunu kart vizualında + irəliləyiş barında göstərmək.

### Dizayn qərarları
- Tier mənbəyi: `lifetime_stars` (cari `stars` DEYİL) — redemption stars-ı azaldır,
  amma səviyyə geri düşmür (prestij qorunur).
- Backfill: mövcud müştərilər üçün `lifetime_stars = stars` — heç kim sıfırdan başlamır.
- Konfiq tenant-bazlıdır: `customer_app_settings.tiers` (default: Bronze 0 / Silver 100 / Gold 300).
- `Customer.type` (cashier tərəfindən təyin olunur) toxunulmur — tier tamamilə törəmə dəyərdir.
- Multiplier (Gold 1.5×) P1-1b fazasındadır — earn məntiqinə ayrıca toxunur.

### Data model (migration 20260816_0002)
`customers.lifetime_stars INTEGER NOT NULL DEFAULT 0` + backfill UPDATE.
`down`: sütun silinir (törəmə hesablama — data itkisi yoxdur).

### Backend davranışı
- `pos.py` points-rejimi satışında: `lifetime_stars += coffee_qty` (cashback toxunulmur).
- `_compute_tier(lifetime_stars, tiers)` → `{key, label{az,ru,en}, color, multiplier,
  current_threshold, next_threshold, progress_pct}` — floor progress (100 yalnız həddə çatanda).
- Session `customer` obyektinə `lifetime_stars` + `tier` əlavə olunur (additive — köhnə tətbiqlər pozulmur).

### API kontraktı (session)
`customer.tier = { key, label, color, multiplier, current_threshold, next_threshold|null, progress_pct }`

### Frontend
- HomeTab: kart qradienti tier rənginə tint (`${color}2E`), kart üzündə tier chip,
  wallet badge, növbəti səviyyə progress barı.
- ProfileTab: tier badge (rəngli) + "Kart növü" dəyəri = tier adı.
- `crm.ts` lokal fallback: `computeTier` mirror — backend yoxkən də session tier işləyir.

### Konfiqurasiya formatı
`customer_app_settings.tiers = [{ "key", "label": {az,ru,en}, "threshold", "color", "multiplier" }]`

### Status
- ✅ P1-1a (core): migration + earn + `_compute_tier` + session + UI — hazır (2026-08-16)
- ⏳ P1-1b: Gold multiplier 1.5× tətbiqi + admin panel tier konfiq UI

### Testlər
- `backend/tests/test_customer_tier_system.py` (7 test) + `test:smoke` (lokal session tier)

### Double-check
tsc + build + tam pytest + vizual yoxlama (3 tier rəngi, new/retro/light rejimləri)

---

## 13. Texniki Spec: P1-2 Birthday Reward

### Məqsəd
Müştərinin doğum günündə avtomatik bonus ulduz + bildiriş + push vermək
(Starbucks birthday drink analoqu) — balans və tier irəliləyişinə təsir etsin.

### Dizayn qərarları
- Scheduler hər 30 dəqiqə oyanır, amma gündə yalnız 1 dəfə skan edir (guard marker).
- "Bugün" hər tenant üçün öz vaxt qurşağında hesablanır (`time_settings.timezone`,
  default Asia/Baku; ZoneInfo yoxdursa UTC+4 fallback).
- İdempotency iki qatlı: gündəlik marker (restart-a davamlı) + il-əsaslı ledger sətri
  (`Birthday bonus {year}`) — multi-worker-da ikiqat grant mümkün deyil.
- Default QAPALI: `customer_app_settings.birthday_enabled=false` — tenant açmadan
  heç nə verilmir.
- Grant həm `stars`, həm `lifetime_stars`-a yazılır — doğum günü hədiyyəsi tier
  irəliləyişinə də kömək edir.
- `birth_date` nullable — köhnə/naməlum müştərilər skanda atlanır, migration data
  itkisizdir.

### Data model (migration 20260816_0003)
`customers.birth_date DATE NULL` — opsional sahə, backfill tələb olunmur.
`down`: sütun silinir (məlumat itkisi: yalnız istifadəçinin daxil etdiyi tarix).

### Backend davranışı
- `app/services/birthday_scheduler.py` — `run_birthday_scan(db, today?)` əsas məntiq;
  `start_birthday_scheduler()` background thread-i `main.py` start-up-da işə düşür.
- Skan: aktiv tenant-lar → `birthday_enabled` → `birth_date` ay/gün == bugün → grant.
- Grant: `stars += bonus`, `lifetime_stars += bonus`, `LoyaltyLedgerEntry(unit='birthday',
  entry_type='earn', description='Birthday bonus {year}')`, in-app Notification, FCM push.
- Hər müştəri try/except-də — bir xəta bütün skanı dayandırmaz; commit tenant başına.

### API kontraktı (endpoint + session)
`POST /customer-app/profile/birthday { birth_date: "YYYY-MM-DD" }` (id+t auth) →
`{ success, birth_date }`. Validasiya: format, keçmiş tarix, yaş 6-120 → səhv 400.
Session `customer.birth_date` (nullable, additive).

### Konfiqurasiya formatı
`customer_app_settings.birthday_enabled: bool` (default false) +
`customer_app_settings.birthday_bonus_stars: int` (default 5, min 1).
PATCH `/settings/customer-app` hər iki açarı qəbul edir.

### Status
- ✅ P1-2a (core): migration + scheduler + grant + endpoint + testlər — hazır (2026-08-16)
- ✅ P1-2b: ProfileTab ad/doğum tarixi redaktə UI — hazır (2026-08-16)
- ⏳ P1-2c: admin konfiq UI (birthday_enabled / birthday_bonus_stars paneli)

### Testlər
- `backend/tests/test_customer_birthday_reward.py` (20 test): grant, idempotency,
  disabled tenant, NULL/yanlış ay, custom bonus, endpoint validasiya, guard marker,
  advisory lock race (PG skippable)

### Double-check
tsc + build + tam pytest + frontend smoke + sənəd balansı (AZ = EN)
