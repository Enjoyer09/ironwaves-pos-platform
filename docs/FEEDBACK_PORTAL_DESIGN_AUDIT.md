# Müştəri Feedback Portalı — Dizayn Auditı

**Tarix:** 2026-08-31
**Müəllif:** WorkBuddy AI (UI/UX dizayn auditı)
**Əhatə:** `src/components/FeedbackPortal.tsx` (public QR portal, `/feedback` səhifəsi) + `src/components/customer/FeedbackTab.tsx` (app-daxili feedback)
**Status:** Audit tamamlandı, düzəliş planı təqdim olunur (kod hələ yazılmayıb)

---

## 1. Kontekst — iki fərqli feedback UI-si var

| Yer | Fayl | Kim istifadə edir | Dizayn dili |
|---|---|---|---|
| Çekdəki QR → `/feedback` | `FeedbackPortal.tsx` | Qonaq müştəri (auth yox) | Ağır **glass-morphism** + çoxrəngli animasiyalı fon |
| Müştəri app → Feedback tab | `FeedbackTab.tsx` | Qeydiyyatdan keçmiş müştəri | **Energetic brand** (orange primary/accent), sakit |

**Problem:** Eyni brendin iki fərqli üzü var və onlar vizual cəhətdən ziddiyyətlidir. Portal köhnə "aurora + noise + şüşə" estetikasındadır; app-dəki tab isə layihənin son enerji/brand istiqamətinə (orange `#FF8B26` / `#F48C24`) uyğundur. Dashboard audit-də (2026-08-24) təmizlənən "aurora + noise + ağır kölgə" problemi feedback portalında hələ də qalır.

---

## 2. Güclü tərəflər (qorunmalı)

- **Public, auth-suz QR axını** (`App.tsx:1677` `/feedback` route) — müştəri üçün sürtünmə yoxdur, bir toxunuşla açılır.
- **İdempotent kupon** — çek başına (`receipt_id`+`receipt_token`) yalnız bir kupon (`feedback.ts:111-118, 347-359`). Təkrar kupon yoxdur.
- **Google rəy gating-i** — yalnız `score >= minStarsForGoogleReview` (default 4) olduqda Google linki görünür (`FeedbackPortal.tsx:445`). Reputasiya idarəetməsi ağıllıdır.
- **3 dilli + özəlləşdirilə bilən başlıqlar** (`custom_heading_*`, `custom_subheading_*`, `thank_you_text_*`).
- **Kupon + QR + "Save to Photos"** — təşviq və geri-qaytarma yaxşıdır.
- **"Artıq rəy bildirilib"** vəziyyəti və REDEEMED vəziyyəti düzgün göstərilir.

---

## 3. Problemlər

### P0 — Kritik (etibarlılıq / brend / çaşqınlıq)

#### P0-1. Ölü, funksiyasız düymələr (glass-dock)
`FeedbackPortal.tsx:583-588` aşağıda 4 düymə var: `ChevronLeft`, `ChevronRight`, `Share2`, `Bookmark`. **Heç bir `onClick` yoxdur, heç bir funksiyası yoxdur.** İstifadəçi basır → heç nə olmur.
- `ChevronLeft/Right` naviqasiyaya işarə edir amma keçid yoxdur.
- `Bookmark`/"Save" və `Share2`/"Paylaş" gözlənilən davranışı vermir.
Bu "saxta UI"-dir — etibarı azaldır, çaşdırır. **Həll:** düymələri sil VƏYA real funksiya ver (Bookmark → "kuponu yadda saxla", Share2 → `navigator.share`).

#### P0-2. Ziddiyyətli iki UI + brend uyğunsuzluğu
- Portal default olaraq **sarı/cyan** (`primaryColor` `#facc15`, `accentColor` `#22d3ee`, `FeedbackPortal.tsx:111-112`) istifadə edir; energetik brend isə **orange**. Tənzimlənməsə portal brendi tanınmır.
- `.cta-button` CSS class-ı **hardcoded** pink/purple gradient + glow istifadə edir (`FeedbackPortal.tsx:660-665`), inline `primary→accent` rəngi ilə ziddiyyət edir.
- App-dəki `FeedbackTab.tsx` isə düzgün `primaryColor`/`accentColor` istifadə edir. İki səhifə eyni brendi fərqli göstərir.
**Həll:** Portalı `FeedbackTab` ilə eyni dizayn sisteminə (və ya ortaq bir `FeedbackShell` komponentinə) köçür; default rəngi orange et.

### P1 — Vacib (vizual yorğunluq / əlçatanlıq / oxunaqlılıq)

#### P1-1. Həddindən artıq animasiya + aurora/noise
`FeedbackPortal.tsx`:
- Çoxrəngli gradient fon (`#8ec5ff→#a48bff→#ef8cf9→#ffb58f`, :344)
- 3 `blob-wave` sonsuz animasiyası (8s/10s/12s, :701-724)
- `star-shimmer` (3s, :643-650), `ctaGlow` (2.4s sonsuz, :738-741)
- `web-noise-overlay` (:354)

Göz yorucu, yavaş telefonlarda (QR skan edən müştəri) jank yaradır və brend istiqaməti ilə ziddiyyətlidir. **Həll:** sakit və tək rəngli fon, yalnız giriş animasiyası, parlaq effektləri çıxar (dashboard audit P0-48 ilə eyni prinsip).

#### P1-2. `prefers-reduced-motion` yoxdur
Bütün sonsuz animasiyalar hərəkət həssaslığı olan istifadəçilər (migren/vestibulyar) üçün problemdir. **Həll:** `@media (prefers-reduced-motion: reduce)` ilə animasiyaları söndür.

#### P1-3. Oxunaqlılıq / kontrast
- `subHeading` mətni `slate-700` (#334155) üzərində şüşə-pill daxilində — aşağı kontrast (`FeedbackPortal.tsx:387`).
- Uzun rus/az cümlələr 430px kartda kəsilə bilər (subHeading-də `line-clamp` yoxdur).
- `text-[12px]` etiketlər kiçikdir; dashboard audit P1-B-də 12px+ tövsiyə olunmuşdu.
**Həll:** mətn rəngini `#0F172A` (artıq `textColor` var, :114) istifadə et, ölçünü 13px-ə qaldır.

#### P1-4. Aşağı balda "service recovery" axını yoxdur
Kupon **bütün ballar üçün** (1–5) verilir (`feedback.ts:361-402`, `promo_enabled` default true). 1 ulduzlu qəzəbli müştəri də eyni "Təşəkkür edirik" mesajını alır, amma heç bir **"üzr istəyirik / menecerlə əlaqə"** yolu yoxdur.
**Həll:** `score <= 2` olduqda fərqləşdirilmiş recovery ekranı (üzr + birbaşa əlaqə/email) göstər; aşağı balda kuponu şərtli et və ya "menecer sizinlə əlaqə saxlayacaq" vəd et.

### P2 — İstəyə bağlı (təfərruat)

- **P2-1.** Star `aria-label` zəif: `rate-1`..`rate-5` (`FeedbackPortal.tsx:476`). Ekran oxuyucu üçün "1 ulduz" deyil. Düzəlt.
- **P2-2.** Göndərmədən sonra "Yeni rəy" yoxdur (portalda `FeedbackTab.tsx:120` var, portalda yox). Portalda bir dəfə göndər → bitdi.
- **P2-3.** `lang` yalnız URL param (`?lang=`); brauzer dili avtomatik seçilmir.
- **P2-4.** "Save to Photos" PNG-i hardcoded tünd fon (`#0b1220`/`#111827`, `FeedbackPortal.tsx:228-231`) — brend rəngindən asılı deyil.
- **P2-5.** Coupon "status" yalnız PENDING/REDEEMED; vaxtı keçmə (expiry) yoxdur.
- **P2-6.** Mobil birinci ekran ağır: `backdrop-blur` + 3 blurred blob + noise + şəffaf şüşə kartlar eyni vaxtda.

---

## 4. Təklif olunan istiqamət (calm + brand-aligned)

```
İNDİ:                                  TƏKLİF:
çoxrəngli aurora fon + noise          → tək brand fon (orange gradient və ya açıq neytral)
3 blob + shimmer + glow (sonsuz)      → yalnız giriş fade-in; reduced-motion dəstəyi
glass-dock (4 ölü düymə)              → silin VƏYA real Bookmark/Share funksiyası
sarı/cyan default                     → orange #FF8B26 primary, #F48C24 accent
iki fərqli UI                         → ortaq FeedbackShell (portal + app eyni görünüş)
1-5 kupon eyni                        → aşağı balda recovery axını
```

**Prinsip:** Dashboard (P0-48) və Kitchen (P1-4) audit-lərində tətbiq edilən eyni yanaşma — sakit vizual, məhdud palitra, tək kölgə/tək rəng, əlçatanlıq. Feedback portalı da bu xəttə gətirilməlidir.

---

## 5. Prioritet

| # | Problem | Təsir | Çətinlik |
|---|---|---|---|
| P0-1 | Ölü düymələr | Etibar/çaşqınlıq | Aşağı (sil və ya onClick) |
| P0-2 | Ziddiyyətli UI + brend | Brend tanınmazlığı | Orta (ortaq komponent) |
| P1-1 | Həddindən artıq animasiya | Göz yorğunluğu/yavaşlıq | Aşağı |
| P1-2 | reduced-motion yox | Əlçatanlıq | Aşağı |
| P1-3 | Kontrast/oxunaqlılıq | OXUNAQLILIQ | Aşağı |
| P1-4 | Service-recovery yox | Qəzəbli müştəri itkisi | Orta |

---

## 6. Nəticə

Feedback portalı funksional olaraq güclüdür (public QR, idempotent kupon, ağıllı Google gating), amma **dizaynı köhnəlib**: app-dəki feedback ilə ziddiyyət edir, brendi əks etdirmir, həddindən artıq animasiyalı və əlçatan deyil. Ən sürətli qazanc: ölü düymələri silmək + sakit fon + orange brend + reduced-motion. **P0-lar kiçik dəyişikliklərlə həll olunur.**
