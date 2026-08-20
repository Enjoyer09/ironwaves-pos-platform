# Customer App — Funksionallıq və İstifadəçi Rahatlığı Auditi

**Tarix:** 2026-08-19
**Auditor:** Senior Product/UX Designer (WorkBuddy AI)
**Hədəf:** `src/components/CustomerApp.tsx` + `src/components/customer/*` (HomeTab, OrderTab, OffersTab, ProfileTab, BaristaTab, FalciTab)
**Metodologiya:** Kod-bazası oxunması + Starbucks mobil tətbiqi (4.9★) benchmark + Apple HIG + WCAG 2.1 AA
**Əlaqəli sənədlər:** `CUSTOMER_APP_UI_AUDIT.md`, `CUSTOMER_APP_STARBUCKS_BENCHMARK.md`, `CUSTOMER_APP_GLASS_AUDIT.md`

---

## 1. Ümumi Qiymətləndirmə (Xallar)

| Ölçü | Xal (10 üzərindən) | Qeyd |
|---|---|---|
| **Funksionallıq tamlığı** (Starbucks benchmark) | **7.5** | Pre-order, mükafatlar, QR, mağaza seçimi, AI xüsusiyyətlər güclü. Ödəniş, çatdırılma, skan-et-ödə axını çatışmır. |
| **İstifadəçi rahatlığı / interfeys** | **6.0** | Oxuma sahəsi kiçik, 6 tab sıx, səbət toxunma hədəfləri balacadır, modal fokus idarəetməsi yoxdur. |
| **Görünüş/Polished (əvvəlki audit)** | **6.0** | Aurora+noise arxa fon yoxdur; işıq fizikası zəif. |
| **ÜMUMİ** | **6.5** | Funksional olaraq yaxşı, amma "rahatlıq" və "son toxunuş"da dünya səviyyəsindən geridə. |

**Nəticə:** Tətbiq *işləyir* və əsas ssenariləri örtür, amma bir adi istifadəçi üçün "rahat" deyil — kiçik şriftlər, gizli/yalnış axtarış sahəsi, həddindən artıq sıx naviqasiya və zəif toxunma hədəfləri rahatlığı aşağı salır.

---

## 2. Funksionallıq Tamlığı Matrixi (Starbucks benchmark)

| Xüsusiyyət | Vəziyyət | Yer | Qeyd |
|---|---|---|---|
| Menuya axtarış | ✅ Var | OrderTab L733-751 | Canlı filtr, düzgün işləyir |
| Kateqoriya filtri ("Hamısı" chip) | ✅ Var | OrderTab L753-814 | F3 düzəldilib |
| Məhsul kartı + şəkil | ✅ Var | OrderTab L850-930 | Yaxşı |
| Modifier/Variant sheet | ✅ Var | OrderTab L37-216 | Portal, spring animasiya |
| Səbət + miqdar artır/azalt | ✅ Var | OrderTab L217-389 | Stepper var amma kiçik |
| Sifariş qeydi (notes) | ✅ Var | OrderTab L347-350 | Var |
| Sifarişi təsdiqlə (pre-order) | ✅ Var | OrderTab L362-381 | Haptic + success modal |
| **Canlı sifariş statusu (KDS sinxron)** | ✅ Var | OrderTab L442-539 | NEW→PREPARING→READY, əla |
| Məşquliyet/Üzvlük kartı (QR) | ✅ Var | HomeTab L611-628 | 3D flip, scan üçün QR |
| Wallet (AnimatedCounter) | ✅ Var | HomeTab | Kahve fincanı SVG animasiya |
| Mükafatlar (claim ticket UI) | ✅ Var | HomeTab L698-783 | Starbucks perforated ticket |
| "Sizin üçün" yenidən sifariş | ✅ Var | HomeTab L631-668 | Data-driven |
| Sevimlilər | ⚠️ Yarım | HomeTab/OrderTab | **Yalnız local state** — serverə sinxron deyil |
| Mağaza seçimi (pickup branch) | ✅ Var | OrderTab L673-731 | Starbucks-style |
| Təkliflər (countdown + claim) | ✅ Var | OffersTab | Yaxşı |
| Profil + alış qrafiki | ✅ Var | ProfileTab | SimpleAreaChart |
| AI Barista (səs) | ✅ Var | BaristaTab | Yaxşı |
| AI Falçı (kamera) | ✅ Var | FalciTab | Yaxşı |
| **Ödəniş üsulu seçimi (card/wallet)** | ❌ Yox | — | Checkout birbaşa preOrder; ödəniş inteqrasiyası görünmür |
| **Çatdırılma (delivery) ünvanı** | ❌ Yox | — | Yalnız götürmə (pickup) |
| **Skan-et-ödə (in-store scan)** | ⚠️ Yarım | HomeTab QR | QR göstərilir amma "kassada skan et" axını yoxdur |
| **Qlobal bildiriş ("sifarişiniz hazırdır")** | ❌ Yox | — | Status yalnız OrderTab-da; push/yüzen bildiriş yox |
| **Onboarding / ilk açılış təlimatı** | ❌ Yox | — | Yeni istifadəçi skan/reorder bilmir |
| Tema keçidi (dark/light) görünən düymə | ⚠️ Zəif | — | UI-də açıq toggle yoxdur |

---

## 3. İstifadəçi Rahatlığı və İnterfeys Problemləri (Əsas Hissə)

### C1 — Home Axtarış sahəsi "yalnış affordance" (ƏN VACİB)
**Yer:** `HomeTab.tsx` L259 — `readOnly input`, onClick → Order tab-a keçir.
**Problem:** İstifadəçi Home ekranında axtarış qutusu görür, klikləyir, amma heç nə yazmaq olmur — birbaşa Order tab-a atılır. Bu, istifadəçini çaşdırır: "Axtarış etdim, nəticə hardadır?" hissi yaranır.
**Rahatlıq təsiri:** Yüksək. İstifadəçi nəzarəti itirir.
**Təklif:**
- Variant A: Home axtarışını real edin — nəticələri aşağıda göstərin və ya Order tab-a **kliklənmiş axtarış sorğusu ilə** keçin (query-ni ötürün).
- Variant B: Axtarış qutusu əvəzinə açıq "Menyuya bax" düyməsi edin ki, yalançı axtarış görünməsin.

### C2 — 6 Tab-bottom nav sıxlığı (Apple HIG pozuntusu)
**Yer:** `CustomerApp.tsx` L1465 `bottomTabs` (home, order, offers, barista, falci, profile).
**Problem:** Apple HIG ≤5 tab tövsiyə edir. 6 tab telefon ekranında (xüsusilə 375px en) etiketləri sıxır, baş barmaq çatması çətinləşir.
**Təklif:** Barista + Falci-ni tək "AI" və ya "More" altına toplayın → 4-5 tab. və ya Barista/Falci-ni Profil/Home alt-menyuya köçürün.

### C3 — Səbət toxunma hədəfləri çox kiçik (WCAG 2.5.5)
**Yer:** `OrderTab.tsx` L321-332 (qty stepper 28×28px, font 10px), L316-319 (sil X 28×28px).
**Problem:** − / + düymələri 28px, WCAG tövsiyəsi 44×44px. Böyük barmaqlı və ya sürətli istifadədə səhv toxunma ehtimalı yüksək.
**Təklif:** Stepper düymələrini minimum 40-44px edin, aralığı artırın. Sil (X) düyməsini də 36px+ edin.

### C4 — Hər məhsul klikində tam ModifierSheet açılır
**Yer:** `OrderTab.tsx` L852 `onClick={() => handleOpenModifiers(item)}`.
**Problem:** Variantı və ya modifieri olmayan sadə məhsulda belə tam sheet açılır → əlavə addım, "tap yorğunluğu".
**Təklif:** Əgər məhsulun 1 variantı + 0 modifieri varsa, birbaşa səbətə əlavə et (quick-add), sheet-i yalnız ehtiyac olduqda aç.

### C5 — Modal fokus idarəetməsi və Escape yoxdur
**Yer:** `OrderTab.tsx` ModifierSheet (L37) və CartSheet (L217) — `ReactDOM.createPortal`.
**Problem:** Modal açılanda fokus "tutulmur" (focus trap yoxdur), klaviatura istifadəçiləri arxa fonla işləyə bilir, Escape ilə bağlanma yoxdur (yoxlamada görünmür).
**Rahatlıq/Əlçatanlıq təsiri:** Orta-Yüksək.
**Təklif:** `aria-modal="true"`, fokusu modal içinə kilidləyin, Escape və overlay-klik ilə bağlama əlavə edin, body scroll kilidləyin.

### C6 — Şriftlər hələ kiçik (oxunaqlılıq)
**Yer:** `OrderTab.tsx` L298-310 (`text-[8px]`, `text-[10px]`), L344 (`text-[9px]`), badge L871 (`text-[8px]`). HomeTab də `text-[8px]`, `text-[9px]`.
**Problem:** U1 readability keçidi bəzi yerləri düzəldib (7px→10px), amma səbət/qty/badge hələ 8-10px. Yaşlı istifadəçilər və parlaq günəşdə oxuya bilmir.
**Təklif:** Kritik mətnləri (qiymət, miqdar, status) minimum 12px edin; ikinci dərəcəli etiketlər 10px-dən aşağı olmasın.

### C7 — Canlı sifariş statusu yalnız OrderTab-da
**Yer:** `CustomerApp.tsx` (LiveOrderStatus yalnız OrderTab-a mount olunur).
**Problem:** İstifadəçi "Home" və ya "Profile" ekranında ikən sifarişinin hazır olduğunu bilmir. Push və ya yüzen bildiriş yoxdur.
**Təklif:** Hazır olanda qlobal yüzen "Sifarişiniz hazırdır 🎉" bildirişi (hər tab-da görünən) və ya statusu Home-a kiçik chip kimi çıxarın.

### C8 — Sevimlilər yalnız local (məlumat itkisi riski)
**Yer:** `OrderTab.tsx` `localFavorites` state.
**Problem:** İstifadəçi cihaz dəyişəndə sevimlilər itir. "Rahatlıq" baxımından etibarsızlıq yaradır.
**Təklif:** Sevimliləri profil/backend ilə sinxron edin (və ya ən azı localStorage-a yazın).

### C9 — Ödəniş addımı yoxdur
**Yer:** `OrderTab.tsx` L362-381 — "Sifarişi Təsdiqlə" birbaşa preOrder.
**Problem:** Real müştəri tətbiqində kart/wallet ilə ödəmə gözlənilir. Burada ödəniş inteqrasiyası görünmür → "pul haradan çıxır?" sualı.
**Təklif:** Checkout-dan əvvəl ödəniş üsulu ekranı (Apple/Google Pay, kart) əlavə edin və ya ən azı "kassada ödə" seçimini açıq göstərin.

### C10 — Skan-et-ödə axını müəmmalı
**Yer:** `HomeTab.tsx` L611-628 (QR kart flip).
**Problem:** QR var amma "kassada skan et" üçün addım-addım yönləndirmə yoxdur. İstifadəçi QR-ı açıb nə etməli olduğunu bilmir.
**Təklif:** QR kartı açanda aşağıda "Kassada skan etdirin" təlimatı + bələdçi animasiya.

### C11 — Onboarding yoxdur
**Yer:** — (heç bir yerdə).
**Problem:** Yeni istifadəçi scan, reorder, mükafat claim necə edildiyini bilmir.
**Təklif:** İlk açılışda 3 şəkilli onboarding (scan → order → rewards).

### C12 — Arxa fon aurora+noise deyil (əvvəlki auditə istinad)
**Yer:** `CustomerApp.tsx` L1518-1530 — statik `blur-[130px]` bloblar; `html[data-ui-mode='new']` aurora Customer App-ə tətbiq olunmur.
**Problem:** POS veb versiyası animated aurora istifadə edir, Customer App etmir → marka vahidliyi və "premium" hiss pozulur.
**Təklif:** `CUSTOMER_APP_GLASS_AUDIT.md` Bölmə 8-dəki `.customer-app-aurora` + `.customer-app-noise` spec-ni tətbiq edin.

---

## 4. Mövcud Güclü Tərəflər (Strengths — qorunmalıdır)

1. **Canlı sifariş statusu (KDS sinxron)** — NEW→PREPARING→READY irəliləməsi düzgün, rəng kodlu, real vaxt. Bu dünya səviyyəsində xüsusiyyətdir.
2. **Mükafatlar ticket UI** — Starbucks perforated ticket vizualı və status chip-ləri peşəkar.
3. **"Sizin üçün" yenidən sifariş** — data-driven, bir toxunuşla səbətə. Rahat.
4. **Mağaza seçimi** — Starbucks-style pickup branch, düzgün işləyir.
5. **Haptics + spring animasiya** — ModifierSheet `cubic-bezier(0.34,1.56,0.64,1)` irəli qayıtma hissi yaxşı.
6. **Trilingual i18n** — AZ/RU/EN `tx()` ilə bütün UI-da.
7. **aria-label-lər** — əksər düymələrdə mövcud (C5-dəki fokus çatışmazlığı istisna).
8. **AI Barista + Falci** — fərqləndirici xüsusiyyət, rəqabətdə üstünlük.

---

## 5. Prioritetli Düzəlişlər

### P0 (Rahatlıq üçün kritik — dərhal) ✅ TAMAMI HƏLL OLUNDU
- **C1** Home axtarışını real edin və ya yalançı affordance-ni çıxarın. → ✅ `HomeTab.tsx` real controlled input + Enter ilə OrderTab-a keçid.
- **C3** Səbət stepper/sil toxunma hədəflərini 44px-ə böyüt. → ✅ `OrderTab.tsx` CartSheet-də 44px toxunma hədəfləri.
- **C5** Modal fokus trap + Escape bağlama + body scroll kilidi. → ✅ `useModalA11y` hook (Escape + Tab trap + scroll lock).
- **C6** Kritik şriftləri 12px-ə çatdır (qiymət/miqdar/status). → ✅ Kritik ölçülər 10–13px-ə qaldırıldı.

### P1 (Vacib — növbəti sprint) ✅ TAMAMI HƏLL OLUNDU
- **C2** 6 tab-i 4-5-ə endir (Barista+Falci birləşdir). → ✅ `CustomerApp.tsx` tək "AI" hub tab + daxili Barista/Falçı keçid.
- **C4** Modifier-siz məhsullarda quick-add. → ✅ `handleOpenModifiers` bir toxunuşla səbətə əlavə edir.
- **C7** Qlobal "sifariş hazırdır" bildirişi. → ✅ `refreshOrders` içində global toast (hər tabda görünür, 8s poll).
- **C8** Sevimliləri localStorage/backend sinxron et. → ✅ `localFavorites` artıq localStorage-da qalıcı (C8 ilkin olaraq həll olunub).
- **C9** Ödəniş üsulu ekranı (və ya "kassada ödə" açıqlığı). → ✅ `CartSheet` ödəniş seçimi (Kasada/Kart/Apple-Google) + API-yə `payment_method` ötürülür.

### P2 (Polish — sonrakı) ✅ TAMAMI HƏLL OLUNDU
- **C10** Skan-et-ödə yönləndirməsi. → ✅ `HomeTab.tsx` QR kartında "Kasada ödəmək üçün QR-kodu skan edin" ipucu xətti + onboarding slide 3.
- **C11** Onboarding 3-shəkil. → ✅ `CustomerApp.tsx` ilk açılışda 3-slide onboarding (`ironwaves_customer_onboarded` localStorage flag), trilingual, Skip/Next/Get Started.
- **C12** Aurora+noise arxa fon (Glass audit spec). → ✅ Artıq mövcuddur: `customer-app-aurora` + `customer-app-noise` (index.css) dark modda animasiyalı, `prefers-reduced-motion` hörmət edilir.
- Tema keçid düyməsi UI-də görünən et. (əlavə polish — hələ edilməyib)

---

## 6. Sürətli Qələbələr (Low-effort, High-impact)

1. Home axtarış `readOnly` üzərində "Menyuya keç" ikonu/etikəti əlavə et (C1, Variant B) — 10 dəqiqə.
2. Səbət stepper düymələri `h-7 w-7` → `h-11 w-11` (C3) — 1 sətr.
3. Badge şrifti `text-[8px]` → `text-[10px]` (C6) — 1 sətr.
4. Modal overlay onClick + `onKeyDown Escape` əlavə et (C5) — ~15 sətr.
5. ModifierSheet-də `if (variants.length===1 && modifiers.length===0) handleAddToCart()` (C4) — ~5 sətr.

---

## 7. Nəticə

Customer App **funksional cəhətdən yetkin** (pre-order → KDS → ready axını tam işləyir, mükafatlar/AI fərqləndirici), amma **istifadəçi rahatlığı orta səviyyədədir**. Ən böyük rahatlıq qüsurları: yalançı Home axtarışı (C1), kiçik toxunma hədəfləri (C3), modal fokus çatışmazlığı (C5) və 6-tab sıxlığıdır (C2). Bu 4 P0/P1 düzəlişi tətbiq edəndə rahatlıq xalı 6.0-dan 8.0+ -a qalxar. Glassmorphism/aurora (C12) isə vizual "premium" hissi tamamlayacaq.

**Tövsiyə edilən növbə:** P0 (C1, C3, C5, C6) → P1 (C2, C4, C7, C8, C9) → P2 (C10, C11, C12 + Glass audit phases).
