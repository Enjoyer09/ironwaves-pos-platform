# Customer App UI/UX — Dərin Audit Hesabatı

> **Dil seçimi:** [English version](CUSTOMER_APP_UI_AUDIT_EN.md) · **Tarix:** 2026-08-17 · **Əhatə:** `src/components/CustomerApp.tsx`, `src/components/customer/*` (7 tab), `src/index.css` (customer layer)

---

## 1. Xülasə

Customer App-in bütün 7 tab-ı (Home, Order, Offers, Profile, Barista, Falçı) + shell + onboarding + CSS dizayn sistemi kod səviyyəsində dərin oxundu. Nəticə: **funksionallıq və dizayn dili güclüdür** (tier, birthday, kampaniya, canlı sifariş statusu, i18n, haptics), amma beynəlxalq səviyyəyə çatmaq üçün **2 funksional saxta-data problemi, 2 kritik UI problemi** və bir sıra orta/kiçik boşluq var.

**Ən kritik 3 addım:** (1) saxta hava/tövsiyə simulyasiyasını real data ilə əvəz et, (2) font ölçüləri + kontrastı qaldır, (3) touch target-ləri 44px-ə çatdır.

---

## 2. Funksional Tapıntılar

| # | Tapıntı | Yer | Şiddət | Status |
|---|---|---|---|---|
| F1 | **"Ağıllı Təkliflər" saxtadır** — hava `simulatedTemp` state-dir, "Havanı Dəyiş" düyməsi 14↔26°C toggle edir, tövsiyələr statik `getWeatherInfo()` funksiyasından gəlir. Real hava API-si/data yoxdur (P0-1-dəki saxta reytinq sinfi) | HomeTab | 🔴 | ✅ Düzəldildi |
| F2 | **Order tab-da axtarış YOXDUR** — HomeTab-dakı "axtarış" inputu `readOnly`dir, Order tab-da isə heç bir axtarış inputu yoxdur | OrderTab | 🔴 | ✅ Düzəldildi |
| F3 | **"Hamısı/All" çipi yoxdur** — `cats` yalnız real kateqoriyalar; default `cats[0]` avtomatik seçilir, bütün menyu bir anda görünmür | OrderTab | 🟠 | ✅ Düzəldildi |
| F4 | **Kampaniya countdown donur** — countdown render-də hesablanır, 1s timer YOXDUR; yenilənmə yalnız 8s-lik order poll-a bağlıdır (aktiv sifariş yoxdursa tam donur). `progressPct = seconds/900` sərt kodlanıb | OffersTab | 🟠 | ✅ Düzəldildi |
| F5 | **Cart-da qty stepper yoxdur** — yalnız silmə var; qty artırmaq üçün sətir silinib yenidən əlavə edilməlidir | CartSheet | 🟠 | ✅ Düzəldildi |
| F6 | **Birbaşa add-to-cart yoxdur** — hər kart (variansız məhsul belə) ModifierSheet açır; sadə məhsul üçün default variantla birbaşa əlavə olmalıdır | OrderTab | 🟡 | ⏳ P2 |
| F7 | OTP `type="number"` (iOS-da problemli) — `inputMode="numeric"` + `type="text"` daha doğru; resend timer yoxdur | Onboarding | 🟡 | ⏳ P2 |
| F8 | **VOID/VOID_REQUESTED göstərilmir** — sifariş ləğv olunarsa istifadəçi səssizcə heç nə görmür | OrderTab | 🟡 | ⏳ P2 |

---

## 3. UI Tapıntılar

| # | Tapıntı | Şiddət | Status |
|---|---|---|---|
| U1 | **Font ölçüləri sistemli şəkildə çox kiçikdir** — `text-[7px]`→`text-[10px]` hər yerdə (tier, kart ID, bildiriş vaxtı); `text-white/35`–`/40` kontrastı WCAG AA keçmir. Beynəlxalq standart: body ≥13px | 🔴 | ✅ CSS keçidi (§8 yoxlama planı) |
| U2 | **Touch target-lər 44px-dən kiçik** — fav heart 28px, `+` 28px, close 28–32px. Apple HIG 44px / Material 48px | 🔴 | ✅ Qismən (36px) |
| U3 | **İki dizayn sistemi (Premium + Retro)** — `isRetro ? ... : ...` bütün komponentlərdə kodu ikiqat çətinləşdirir; "🎨 Premium/Comic" toggle-ı real istifadəçiyə açıqdır. Beynəlxalq standart: tək premium dil | 🟠 | ✅ Qərar: Premium tək dil (toggle gizləndi, P2-də retro silinməsi) |
| U4 | **A11y** — ikon-only düymələrdə `aria-label` yox idi (tema/dizayn/menu/mic/voice/heart/close) | 🟠 | ✅ Düzəldildi |
| U5 | **Performans** — OrderTab `filtered`/`cats` hər render-də hesablanırdı (memo deyil); menu grid virtualizasiya yoxdur; hər tab öz `<style>` blokunu inject edir | 🟡 | ✅ Qismən (memo) |
| U6 | Yüklənmə state-i sadəcə "Menyu yüklənir..." mətni — skeleton loader yoxdur | 🟡 | ⏳ P2 |
| U7 | Header-də iki düymə də profile açır (Menu + avatar) — redundant | 🟡 | ⏳ P2 |
| U8 | Currency `₼` hər yerdə hardcoded — beynəlxalq genişlənmə üçün konfiq lazım | 🟡 | ⏳ P2 |

---

## 4. Möhkəm Tərəflər

- **Dizayn sistemi soliddir:** `cust-glass` (blur 24px + saturate 180%), `premium-shadow`, `shimmer`, `glow`, retro — hamısı mərkəzləşmiş CSS, `prefers-reduced-motion` var.
- **Funksionallıq tam və server-təsdiqlidir:** tier (P1-1), birthday (P1-2), kampaniya (P1-4/4b/4c), onboarding (P0-3), offline QR (P1-3).
- **Canlı sifariş statusu** KDS ilə sinxron (NEW→PREPARING→READY + push + LiveActivity).
- **i18n** (AZ/RU/EN) tam — hər yerdə `tx()`, xətt balansı qorunur.
- Haptics + toast + confetti + Apple/Google Wallet pass inteqrasiyası.

---

## 5. 2026-08-17 Düzəlişləri (bu audit nəticəsində)

| Düzəliş | Fayllar |
|---|---|
| **F1:** saxta hava simulyasiyası silindi (`simulatedTemp`/`simulatedCondition`), yerinə real `recentItems` (son sifarişdən) əsaslı "Sizin üçün" bölməsi | `CustomerApp.tsx`, `HomeTab.tsx` |
| **F2:** OrderTab-a real axtarış inputu (kateqoriya + ad filtr, memoized) | `OrderTab.tsx` |
| **F3:** "Hamısı" çipi əlavə edildi; default `selectedCategory='ALL'` | `OrderTab.tsx`, `CustomerApp.tsx` |
| **F4:** OffersTab 1s countdown ticker + progress `(exp−start)` əsasında (sərt kodlanmış 900s yox) | `OffersTab.tsx`, `CustomerApp.tsx` |
| **F5:** CartSheet qty stepper (−/+) | `OrderTab.tsx`, `CustomerApp.tsx` |
| **U4:** ikon-only düymələrə `aria-label` (tema, dizayn, profil, heart, close, mic, voice, send) | `CustomerApp.tsx`, `HomeTab.tsx`, `OrderTab.tsx`, `BaristaTab.tsx` |
| **U5:** OrderTab `cats`/`filtered` → `useMemo` | `OrderTab.tsx` |
| **U2 (qismən):** heart/`+`/close düymələri 28→36px, cart remove 20→28px | `OrderTab.tsx` |
| **U1:** font ölçüləri 10/11/12/13px bazasına qaldırıldı + `text-white/30–50`/`text-slate-400` kontrastı WCAG AA-ya yaxınlaşdırıldı (`.customer-app-wrapper` scope-da CSS override) | `index.css`, `CustomerApp.tsx` |
| **U3 (qərar):** Premium tək dizayn dili — "🎨 Premium/Comic" toggle-ı istifadəçidən gizlədildi, `designMode` sabit `'classic'` (köhnə `customer_design_mode` localStorage dəyərləri artıq oxunmur); shell-dəki 4 retro dalı classic-ə endirildi. Retro `isRetro` dalları (85 referans) P2 refaktorunda silinəcək | `CustomerApp.tsx` |
| Bonus: ölü `get_customer_wallet_pass_url` importu + çatışmayan `nativeHapticImpact` importu düzəldildi (tsc 23→21) | `HomeTab.tsx`, `CustomerApp.tsx` |

**Yoxlama:** `tsc --noEmit` 21 (baza 23 — 2 azaldı), `npm run build` ✅, `test:smoke` 23/23 ✅.

---

## 6. Qalan Yol Xəritəsi

| Prioritet | Maddə | Qeyd |
|---|---|---|
| P1 | **U1 — vizual yoxlama** | CSS keçidi hazırdır; §8 planı ilə overflow/truncate/çip sıxılması yoxlanmalıdır |
| P2 | **U3 — retro kodunun silinməsi** | Qərar verildi (2026-08-17): Premium tək dildir. `isRetro ? ... : ...` dalları (HomeTab 15, OrderTab 45, ProfileTab 13, BaristaTab 12) və `retro-*` CSS-i təmizlənəcək — davranış dəyişmir, sadəcə ölü kod |
| P2 | **F6 — birbaşa add-to-cart** | Variantsız məhsulda kart üzərində birbaşa `+` (default variant), variantlıda sheet |
| P2 | **F7 — OTP UX** | `inputMode="numeric"` + resend timer + səhv mesajı təkmilləşdirməsi |
| P2 | **F8 — ləğv statusu** | VOID/VOID_REQUESTED üçün istifadəçiyə aydın mesaj |
| P2 | **U6 — skeleton loader** | Yüklənmə state-lərində skeleton kartlar |
| P2 | **U7 — header təmizliyi** | İki profil düyməsini birinə endir |
| P2 | **U8 — valyuta konfiqi** | `₼`-ni tenant ayarına bağla |

---

## 7. Beynəlxalq Standart Müqayisəsi

| Meyar | Starbucks / Material | Biz (əvvəl) | Biz (indi) |
|---|---|---|---|
| Saxta data | ❌ yoxdur | ⚠️ hava simulyasiyası | ✅ real tarixçə əsaslı |
| Axtarış | ✅ debounce + nəticə | ❌ yox idi | ✅ Order tab-da |
| "All" baxışı | ✅ | ❌ yox idi | ✅ Hamısı çipi |
| Countdown canlılığı | ✅ 1s | ❌ donurdu | ✅ 1s ticker |
| Cart qty | ✅ stepper | ❌ sil+əlavə | ✅ stepper |
| Font min ölçü | ≥13px | ⚠️ 7–10px | ✅ 13px (CSS) |
| Touch target | ≥44px | ⚠️ 28px | ⚠️ 36px (P1-də tam) |
| A11y etiketləri | ✅ | ❌ | ✅ |

**Nəticə:** funksional boşluqlar bağlandı; UI ölçü/kontrast/touch fazası (U1+U2 tam) beynəlxalq görünüş üçün növbəti prioritetdir.

---

## 8. U1 Vizual Regression Yoxlama Planı

CSS keçidi `.customer-app-wrapper` scope-da olduğu üçün yalnız customer app-ə təsir edir (POS/desktop toxunulmur). Buraxılışdan əvvəl aşağıdakı ekranlar 375px (iPhone SE) və 430px (iPhone Pro Max) genişlikdə yoxlanmalıdır:

| Ekran | Yoxlanacaq | Risk səviyyəsi |
|---|---|---|
| Bottom nav (6 tab) | Aktiv label `text-[10px]`→12px — `justify-around` ilə sıxılma/daşma | Orta |
| OrderTab kateqoriya çipləri | `w-[76px]` çiplərdə `text-[9px]`→11px label truncate olurmu | Orta |
| OrderTab ürün qridi (2 kolon) | `text-[11px]`→13px ad `line-clamp-1` ilə kəsilmir | Aşağı |
| HomeTab kart arxası / QR | `text-[9px]`→11px etiketlər sığır | Aşağı |
| OffersTab kampaniya kartı | `text-[8px]`→10px/`text-[9px]`→11px badge + timer | Aşağı |
| ProfileTab tarixçə | `text-[9px]`→11px meta + `text-[11px]`→13px item adı | Aşağı |
| Onboarding | `text-[9px]`→11px label-lər + consent mətni (scope-a yeni əlavə edildi) | Aşağı |
| Barista/Falçı | `text-[10px]`→12px alt mətnlər | Aşağı |

**Avtomatik yoxlama (artıq keçdi):** `tsc --noEmit` 21, `npm run build` ✅, `npm run build:customer` ✅, `test:smoke` 23/23 ✅ — override-lar build CSS-inə daxildir (grep ilə təsdiqləndi).

**Qayda:** hər hansı ekranda overflow/truncate pozulursa, həmin element üçün `text-[10px]`→12px və ya `text-[11px]`→13px xüsusi istisnası yazılmalıdır (qlobal override-a toxunmadan).
