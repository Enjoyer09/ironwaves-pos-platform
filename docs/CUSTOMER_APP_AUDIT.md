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
| P0-3 | 🔴 Yüksək | **Onboarding: ad sorğusu + açıq consent checkbox** | ⏳ |
| P1-1 | 🟠 Orta | **Tier sistemi** (Bronze/Silver/Gold) — kart vizualında fərqlilik + keçid hədləri | ⏳ |
| P1-2 | 🟠 Orta | **Birthday reward** (+ doğum tarixi sorğusu) | ⏳ |
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
