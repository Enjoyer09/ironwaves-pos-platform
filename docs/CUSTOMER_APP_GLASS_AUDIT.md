# Senior Designer Audit: Customer App — World-Class Glassmorphism & macOS Aesthetic

> **Auditor:** Senior Product Designer (Mobile UI/Visual Design Specialist)  
> **Tarix:** 19 Avqust 2026  
> **Əvvəlki audit:** CUSTOMER_APP_UI_AUDIT.md (2026-08-17), CUSTOMER_APP_STARBUCKS_BENCHMARK.md  
> **Fokus:** Vizual dizayn, glassmorphism, macOS/Apple estetikası, dünya səviyyəsinə çatmaq

---

## Executive Summary

| Kategoriya | Xal (10 üzrə) | Status |
|-----------|--------------|--------|
| **Glassmorphism Foundation** | 7.5/10 | ✅ Yaxşı baza |
| **macOS/Apple Estetik Uyğunluq** | 5.5/10 | ⚠️ Glass var, amma "Apple hiss" çatışmır |
| **Typography & Hierarchy** | 6.0/10 | ⚠️ Ölçülər düzəldildi, hierarchy zəif |
| **Animation & Micro-interactions** | 6.5/10 | ✅ Əsas var, refinement lazım |
| **Color & Light Physics** | 5.0/10 | ⚠️ Rənglər düzgün, işıq fizikası yoxdur |
| **Density & Spacing** | 5.5/10 | ⚠️ Çox sıx, "nəfəs almaq" yoxdur |
| **Overall Visual Maturity** | **6.0/10** | **⚠️ Potensial var, refinement lazımdır** |

> **1 cümlə xülasə:** Customer App-in glassmorphism altyapısı (blur, saturate, border, shadow) güclüdür, amma dünya səviyyəli (Starbucks, Apple Wallet, Linear, Raycast) olmaq üçün **işıq fizikası, tipoqrafik hierarchy, spacing nəfəsliliyi, və mikro-animasiya refinement** tələb olunur.

---

## 1. Glassmorphism Analizi — Nə Var, Nə Çatışmır

### 1.1. Mövcud Glassmorphism Sistemi (Güclü Tərəflər)

```css
/* Mövcud — yaxşı baza */
.cust-glass {
  backdrop-filter: blur(24px) saturate(180%);
  background: rgba(255, 255, 255, 0.055);
  border: 1px solid rgba(255, 255, 255, 0.10);
}

.cust-glass-light {
  backdrop-filter: blur(24px) saturate(160%);
  background: rgba(255, 255, 255, 0.75);
  border: 1px solid rgba(0, 0, 0, 0.06);
}
```

| Xüsusiyyət | Status | Dəyərləndirmə |
|-----------|--------|--------------|
| **blur(24px)** | ✅ | Yaxşı — macOS menyu bar blur-u ~20-30px |
| **saturate(180%)** | ✅ | Yaxşı — arxa fon rəngini saxlayır |
| **border 1px white/10** | ✅ | Yaxşı — hairline border macOS-vari |
| **premium-shadow (4-layer)** | ✅ | Əla — real-world depth yaradır |
| **Aurora arxa fon** | ✅ | Əla — animasiyalı blob-lar |
| **shimmer-card** | ✅ | Yaxşı — işıq sweep efekti |
| **glow utilities** | ✅ | Var — amma çox istifadə olunur |

### 1.2. Çatışmazlıqlar — Dünya Səviyyəsi üçün Nə Lazımdır

#### A. **İşıq Fizikası (Light Physics) — Çatışmır 🚨**

macOS/Apple glassmorphism-in sirri **işığın içərdən vurması**dır (subsurface scattering). Bizdə glass panellər "boş" görünür.

| Müqayisə | Apple/macOS | Bizim Customer App | Fərq |
|---------|-------------|-------------------|------|
| **İçəri işıq** | `inset 0 1px 0 rgba(255,255,255,0.25)` | `inset 0 1px 0 rgba(255,255,255,0.08)` | 3× zəif |
| **Xarici kölgə** | Multi-layer, soft | `0 12px 32px rgba(0,0,0,0.12)` | 1-layer, sərt |
| **Border glow** | `box-shadow: 0 0 0 1px rgba(255,255,255,0.15)` | `border: 1px solid rgba(255,255,255,0.10)` | Border əvəzinə glow yoxdur |
| **Gradient edge** | `linear-gradient(180deg, rgba(255,255,255,0.15), transparent 15%)` | Yoxdur | Çatışmır |

**Təklif:**
```css
/* Yeni: Apple-vari glass panel */
.glass-apple {
  background: linear-gradient(
    170deg,
    rgba(255, 255, 255, 0.12) 0%,
    rgba(255, 255, 255, 0.05) 40%,
    rgba(255, 255, 255, 0.02) 100%
  );
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-top-color: rgba(255, 255, 255, 0.25); /* Üst kənar daha parlaq */
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.15),  /* İçəri işıq */
    0 8px 32px rgba(0, 0, 0, 0.12),              /* Yumuşak depth */
    0 2px 8px rgba(0, 0, 0, 0.08);               /* Yaxın kölgə */
  backdrop-filter: blur(28px) saturate(160%);
}
```

#### B. **Aurora/Arxa Fon — Potensial Var, İstifadə Çatışmır ⚠️**

Mövcud Aurora blob-lar (`html[data-ui-mode='new'] .metal-app::before/::after`) yalnız POS UI-da aktivdir. Customer App-da arxa fon **statik gradient**dir (`linear-gradient(180deg, #181412, #0D0B0A)`).

**Dünya standartı (Linear, Raycast, Apple):**
- **Canlı aurora** — 2-3 rəng blobu yavaş drift edir
- **Noise texture** — arxa fonda 2-3% opacity grain (glass real-world texture)
- **Depth layers** — glass panelin arxasında 2-3 layer (blur gradient + aurora + noise)

**Təklif:**
```css
/* Customer App Aurora Layer */
.customer-app-aurora {
  position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background:
    radial-gradient(circle at 20% 30%, rgba(244, 140, 36, 0.08) 0%, transparent 50%),
    radial-gradient(circle at 80% 70%, rgba(26, 67, 41, 0.06) 0%, transparent 50%),
    radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.04) 0%, transparent 60%);
  filter: blur(60px);
  animation: aurora-drift 20s ease-in-out infinite;
}
/* Noise overlay */
.customer-app-aurora::after {
  content: '';
  position: absolute; inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");
  opacity: 0.4;
  mix-blend-mode: overlay;
}
```

#### C. **Shimmer Efekti — Sürətli və Dövrəli 🚨**

Mövcud `shimmerSweep` 3.5s-də bir dövrə edir. Apple/Linear-da shimmer:
- **Daha yavaş** (5-8s) — daha premium hiss
- **Daha incə** — `rgba(255,255,255,0.08)` əvəzinə `0.04`
- **Event-driven** — hover/active zamanı triggered, daimi deyil

**Təklif:** Shimmer yalnız hover/active state-də, daha yavaş, daha incə.

#### D. **Glow Istifadəsi — Həddən Artıq Çox ⚠️**

| Element | Glow | Dünya Standartı | Status |
|---------|------|-----------------|--------|
| Aktiv nav tab | `shadow-[0_4px_12px_rgba(244,140,36,0.25)]` | `shadow-[0_2px_8px_rgba(244,140,36,0.15)]` | 2× güclü |
| Mükafat badge | `animate-pulse` + glow | Yalnız pulse, glow yox | Glow + pulse = qarışıq |
| Kateqoriya çipləri | `glow-orange` aktiv | `border-color` + `bg` kifayət | Glow lazımsız |
| Səbət düyməsi | `shadow-[0_6px_20px_rgba(244,140,36,0.45)]` | `shadow-[0_4px_16px_rgba(244,140,36,0.20)]` | 2× güclü |

**Təklif:** Glow 50% azaldılsın, yalnız primary CTA-larda qalsın.

---

## 2. macOS/Apple Estetik — Müqayisəli Analiz

### 2.1. Apple Wallet Card — Bizim Kart vs Dünya Standartı

**Bizim (HomeTab):**
```
- Border-radius: 28px ✅
- Gradient: linear-gradient(135deg, tierColor, #1C2029, #0C0F14) ✅
- EMV chip: SVG (yaxşı) ✅
- Glossy highlight: linear-gradient(180deg, rgba(255,255,255,0.04), transparent) ⚠️ Zəif
- Shimmer: card-sweep animation ✅
- Typography: 10px uppercase tracking — çox kiçik 🚨
```

**Apple Wallet (Dünya Standartı):**
```
- Border-radius: 20px (daha az — Apple daha conservative) 
- Gradient: multi-stop, subtle
- Material: glass + subtle noise
- Glossy highlight: strong top highlight + edge reflection
- Typography: 17px bold (SF Pro), minimum 13px
- Depth: card floats with 3-layer shadow
```

**Təkliflər:**
1. Kart radius 28px → 24px (Apple 20px, biz 24px — orta yol)
2. Kart border: `border: 1px solid rgba(255,255,255,0.12)` + `box-shadow: inset 0 1px 0 rgba(255,255,255,0.2)`
3. Kart typography: `10px` → `13px` minimum (U1 düzəlişindən sonra 12px, amma 13px daha yaxşı)
4. Kart üst edge: daha güclü highlight — `linear-gradient(180deg, rgba(255,255,255,0.18) 0%, transparent 20%)`

### 2.2. Bottom Navigation — Bizim vs iOS Tab Bar

**Bizim (CustomerApp.tsx:1803-1857):**
```
- Shape: rounded-[32px] capsule (yaxşı) ✅
- Blur: backdrop-blur-2xl ✅
- Border: 1px white/10 or slate-200 ⚠️
- Active state: bg-[#F48C24] + text-white + label appears ✅
- Inactive: text-white/40 or slate-400 ✅
- Spacing: justify-around ✅
- Label: text-[10px] font-black uppercase 🚨 Çox kiçik
```

**iOS Tab Bar (Apple HIG):**
```
- Shape: full-width, not capsule (iOS 18-də capsule trend var)
- Blur: ~20px with vibrancy
- Border: 0.5px hairline (yarım piksel)
- Active: tint color + icon scale 1.05
- Label: 10px (SF Pro) — Apple da 10px istifadə edir, amma SF Pro daha oxunaqlı
```

**Təkliflər:**
1. Capsule shape saxlanıla bilər (trend), amma border-radius 32px → 28px
2. Border: `1px` → `0.5px` (hairline) + `border-top: 0.5px solid rgba(255,255,255,0.15)`
3. Active label: `text-[10px]` → `text-[11px]` + `font-semibold` (black yox, semibold — Apple pattern)
4. Haptic: `ImpactStyle.Light` → `ImpactStyle.Medium` (daha aydın feedback)

### 2.3. Modal/Sheet Transitions — Bizim vs Apple Sheet

**Bizim (OrderTab ModifierSheet, CartSheet):**
```
- Entry: scaleIn 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) ✅
- Backdrop: blur(8px) + rgba(0,0,0,0.55) ✅
- Border-radius: 32px ✅
- Drag-to-dismiss: YOXDUR 🚨
- Spring physics: cubic-bezier — yaxşı, amma spring yoxdur
```

**Apple Sheet (iOS 15+):**
```
- Entry: spring physics (damped oscillation)
- Backdrop: blur(20px) + vibrancy + darkening
- Drag-to-dismiss: edge gesture
- Corner radius: dynamic (top 20px, bottom flat)
- Stacking: multiple sheets stack with corner radius progression
```

**Təkliflər:**
1. **Backdrop blur 8px → 20px** — daha immersive
2. **Drag-to-dismiss** — sheet-lərə `onPan` gesture əlavə edilməli
3. **Spring physics** — `cubic-bezier` → `spring(1, 100, 10, 0)` (Framer Motion pattern)
4. **Stacked sheets** — ModifierSheet açıq olanda CartSheet açılırsa, corner radius layering

---

## 3. Typography & Hierarchy — Refinement

### 3.1. Mövcud Vəziyyət (U1 Düzəlişindən Sonra)

| Element | Əvvəl | U1 Düzəlişi | Dünya Standartı | Təklif |
|---------|-------|------------|-----------------|--------|
| Tier label | 9px | 11px | 13px (Apple SF Pro) | 12px |
| Kart ID | 9px | 11px | 12px | 12px |
| Section header | 11px | 13px | 15-17px | 15px bold |
| Body/description | 10px | 12px | 14px | 14px |
| Button label | 12px | 13px | 15px | 14px |
| Price | 12px | 13px | 15px | 15px bold |
| Product name | 11px | 13px | 16px | 14px bold |

### 3.2. Hierarchy Problem — Bütün Mətnlər "Eyni Səsli"

Customer App-da demək olar ki, bütün mətnlər:
- `font-black` (900 weight) — hər yerdə
- `uppercase` — hər yerdə
- `tracking-wider` — hər yerdə
- Rəng: ağ/qızılı/slate — aralarında fərq az

**Apple HIG hierarchy:**
- **Title:** 34px, 700 weight, normal case
- **Headline:** 17px, 600 weight, normal case
- **Body:** 17px, 400 weight, normal case
- **Caption:** 12px, 400 weight, normal case
- **Yalnız 1-2 element:** uppercase + tracking (tab labels, badges)

**Təkliflər:**
1. `font-black` (900) → `font-bold` (700) — 90% yerdə
2. `uppercase` — yalnız tab labels, section badges, CTA buttons
3. `tracking-wider` — yalnız 9px-11px mətnlərdə (Apple pattern)
4. Title-lar: `text-xl` (20px) + `font-bold` + normal case — "Sizin üçün ən yaxşı qəhvə"

---

## 4. Animation & Micro-interactions — Refinement

### 4.1. Mövcud Animations

| Animation | Status | Qiymət |
|-----------|--------|--------|
| Tab transition | `tabEnter` 0.35s cubic-bezier | ✅ Yaxşı |
| Card flip | 700ms rotateY | ⚠️ Çox yavaş (500ms daha yaxşı) |
| Shimmer sweep | 3.5s infinite | ⚠️ Daimi, sürətli |
| Confetti | spawn 40 particle | ✅ Əyləncəli |
| Nav dot pulse | 2.5s infinite | ⚠️ Distraction |
| Button scale | active:scale-95 | ✅ Yaxşı |
| Card hover | group-hover:scale-106 | ✅ Yaxşı |
| Live order pulse | animate-pulse | ⚠️ Basic |

### 4.2. Dünya Standartı (Apple, Linear, Raycast)

| Pattern | Apple/Linear | Bizim | Təklif |
|---------|---------------|-------|--------|
| **Button press** | `scale(0.97)` + 10ms opacity dim | `scale-95` | `scale(0.96)` + `opacity: 0.9` 50ms |
| **Card tap** | `scale(0.98)` + subtle shadow reduce | `active:scale-[0.98]` | `scale(0.97)` + shadow reduce |
| **Nav switch** | `spring(0.4, 100, 10)` | `cubic-bezier` | `spring` physics |
| **Success** | `scale(0.9→1)` + `opacity(0→1)` + haptic | `scaleIn` + confetti | `spring` + confetti + stronger haptic |
| **Loading** | Skeleton shimmer (content-aware) | Spinner + shimmer text | Skeleton cards |
| **Pull-to-refresh** | Native elastic | Yoxdur | `react-pull-to-refresh` |
| **Scroll edge** | Elastic bounce | `overscroll-contain` | `overscroll-behavior-y: contain` + elastic |

### 4.3. Təkliflər

1. **Card flip:** 700ms → 500ms (daha responsive)
2. **Shimmer:** Yalnız hover/active, 5s, `rgba(255,255,255,0.05)`
3. **Nav dot pulse:** `animate-pulse` → `opacity` transition on state change (daimi pulse distraction-dır)
4. **Live order pulse:** `animate-pulse` → `transition: background-color 0.5s ease` (status change-də smooth transition)
5. **Button press:** `active:scale-95` → `active:scale-[0.96] active:opacity-90 transition-all duration-75`

---

## 5. Density & Spacing — Nəfəs Almaq Lazımdır

### 5.1. Mövcud Sıxlıq

Customer App hər ekranda çoxlu element var:
- HomeTab: 8+ sections stacked (salam, kart, cüzdan, promo, mükafatlar, QR, "sizin üçün", sevimlilər, tarixçə)
- OrderTab: header + mağaza + axtarış + kateqoriya + grid + sheets
- ProfileTab: header + grid + bildirişlər + qrafik + tarixçə

**Apple/Starbucks pattern:**
- **Home:** 3-4 major sections (Hero, Featured, Recent, Promotions)
- **Order:** Clean list/grid, minimal chrome
- **Profile:** 2-3 sections (Info, Activity, Settings)

### 5.2. Spacing Təklifləri

| Element | Əvvəl | Təklif | Nəticə |
|---------|-------|--------|--------|
| Section gap | `space-y-4` (16px) | `space-y-6` (24px) + `px-6` | Daha açıq |
| Card padding | `p-5` (20px) | `p-6` (24px) | Daha havadar |
| Card border-radius | `28px` | `24px` (daha mature) | Apple-vari |
| Header margin-bottom | `mb-4` | `mb-6` | Daha açıq |
| Bottom nav padding | `pb-3` + safe-area | `pb-4` + `mb-2` (capsule offset) | Daha floating |

### 5.3. "Nəfəs Almaq" Təklifləri

1. **HomeTab:** "Mükafatlarım" section-ı yalnız aktiv mükafat olduqda göstərilsin (indiki həmişə göstərilir)
2. **HomeTab:** "Sevimlilər" horizontal scroll → 1 sətir (indiki 1+ sətir ola bilər)
3. **ProfileTab:** Qrafik + tarixçə — ikisi ayrı tab-da ola bilər (indiki eyni ekran çox uzun)
4. **OrderTab:** Kateqoriya çipləri — 1 sətir, `gap-3` (indiki `gap-2.5`)

---

## 6. World-Class App-larla Müqayisə — Visual Maturity

### 6.1. Starbucks App (4.9★ App Store)

| Aspekt | Starbucks | Bizim | Fərq |
|--------|-----------|-------|------|
| **Glass depth** | 2-layer (blur + vibrancy) | 1-layer (blur) | Çatışmır |
| **Card float** | 3-layer shadow | 2-layer | 1 layer az |
| **Typography** | 17px body, 34px hero | 12-13px body, 24px hero | 2-3 ölçü kiçik |
| **Spacing** | 24px section gap | 16px | 8px az |
| **Color vibrancy** | Tünd + parlaq accent | Tünd + qızılı | Qızılı çox istifadə olunur |
| **Animation** | Native spring | CSS cubic-bezier | Spring əvəzinə |

### 6.2. Apple Wallet

| Aspekt | Apple Wallet | Bizim Kart | Fərq |
|--------|--------------|------------|------|
| **Card edge** | 0.5px hairline + edge glow | 1px border | 2× qalın |
| **Card highlight** | Strong top gradient | Zəif gradient | 4× zəif |
| **Card material** | Glass + subtle noise | Glass + shimmer | Noise çatışmır |
| **Typography** | 17px bold | 10px uppercase | 7px fərq |

### 6.3. Linear App (macOS)

| Aspekt | Linear | Bizim | Fərq |
|--------|--------|-------|------|
| **Glass blur** | 30px + noise | 24px | Blur + noise lazımdır |
| **Border** | 0.5px + glow | 1px | 2× qalın |
| **Aurora** | 3 blob + noise | 2 blob (POS-da) | Customer-da aurora yoxdur |
| **Button** | Glass chip + subtle glow | Solid gradient | Glass chip pattern çatışmır |
| **Darkness** | #0a0a0f (darker) | #0D0B0A | 0.02 daha açıq |

---

## 7. Prioritized Təkliflər — World-Class Glassmorphism

### Phase 1: Foundation (1-2 həftə) — Visual Impact Ən Böyük

| # | Təklif | Fayl | Dəyişiklik | Təsir |
|---|--------|------|-----------|-------|
| **G1** | **Apple-vari glass panel** — `inset` işıq + gradient + glow | `index.css` | `.glass-apple` yeni class | 🟢 Yüksək |
| **G2** | **Aurora arxa fon** — Customer App-a 3 blob + noise | `CustomerApp.tsx` | Fixed position layer | 🟢 Yüksək |
| **G3** | **Typography refinement** — `font-black` → `font-bold`, `uppercase` azalt | Bütün tab-lar | Class dəyişikliyi | 🟢 Yüksək |
| **G4** | **Spacing açmaq** — `space-y-4` → `space-y-6`, `p-5` → `p-6` | Bütün tab-lar | Margin/padding | 🟡 Orta |
| **G5** | **Card edge highlight** — kart üst kənarında güclü gradient | `HomeTab.tsx` | Style əlavə | 🟡 Orta |
| **G6** | **Shimmer yalnız hover** — daimi shimmer → hover triggered | `index.css` | Animation trigger | 🟡 Orta |
| **G7** | **Glow 50% azalt** — yalnız primary CTA | Bütün tab-lar | Shadow values | 🟡 Orta |

### Phase 2: Polish (2-3 həftə) — Apple Hiss

| # | Təklif | Fayl | Dəyişiklik | Təsir |
|---|--------|------|-----------|-------|
| **G8** | **Spring physics** — tab transitions, sheet entry | `CustomerApp.tsx` | Framer Motion / spring CSS | 🟡 Orta |
| **G9** | **Drag-to-dismiss sheets** — ModifierSheet, CartSheet | `OrderTab.tsx` | Pan gesture | 🟡 Orta |
| **G10** | **Backdrop blur 8px → 20px** | `OrderTab.tsx` | Blur value | 🟡 Orta |
| **G11** | **Bottom nav refinement** — 0.5px border, 28px radius, 11px label | `CustomerApp.tsx` | Style dəyişikliyi | 🟡 Orta |
| **G12** | **Skeleton loaders** — menu loading, order history | `OrderTab.tsx`, `ProfileTab.tsx` | Skeleton component | 🟡 Orta |
| **G13** | **Noise texture** — glass panel-lərə 2% noise | `index.css` | SVG noise filter | 🔵 Aşağı |

### Phase 3: Excellence (1-2 ay) — Mastery

| # | Təklif | Fayl | Dəyişiklik | Təsir |
|---|--------|------|-----------|-------|
| **G14** | **Multi-layered depth** — kart + panel + background = 3 blur layer | `index.css` | Z-index layering | 🔵 Aşağı |
| **G15** | **Dynamic corner radius** — stacked sheets radius progression | `OrderTab.tsx` | Math-based radius | 🔵 Aşağı |
| **G16** | **Pull-to-refresh** — elastic pull animation | `CustomerApp.tsx` | `react-pull-to-refresh` | 🔵 Aşağı |
| **G17** | **Live blur behind nav** — content scroll behind nav, nav blur-layır | `CustomerApp.tsx` | `backdrop-filter` + scroll | 🔵 Aşağı |
| **G18** | **Card 3D tilt** — gyroscope-based card tilt (native) | `HomeTab.tsx` | Capacitor gyroscope | 🔵 Aşağı |

---

## 8. Glassmorphism CSS Spec (Tərtibat üçün)

```css
/* ═══════════════════════════════════════════════════════════
   WORLD-CLASS GLASSMORPHISM SYSTEM — Customer App
   macOS/Apple/Linear estetikası
   ═══════════════════════════════════════════════════════════ */

/* 1. Base Shell — Deeper darkness for glass contrast */
.customer-app-shell {
  background: linear-gradient(180deg, #0a0908 0%, #0c0a09 100%);
}

/* 2. Aurora Background — 3 animated blobs */
.customer-app-aurora {
  position: fixed; inset: 0; z-index: 0;
  pointer-events: none; overflow: hidden;
  background:
    radial-gradient(ellipse 80% 50% at 20% 40%, rgba(244, 140, 36, 0.06) 0%, transparent 50%),
    radial-gradient(ellipse 60% 40% at 80% 60%, rgba(26, 67, 41, 0.05) 0%, transparent 50%),
    radial-gradient(ellipse 50% 50% at 50% 100%, rgba(59, 130, 246, 0.03) 0%, transparent 50%);
  animation: aurora-drift 25s ease-in-out infinite;
}

/* 3. Noise Overlay — 2% grain for glass realism */
.customer-app-noise {
  position: fixed; inset: 0; z-index: 1;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.025'/%3E%3C/svg%3E");
  opacity: 0.6;
  mix-blend-mode: overlay;
}

/* 4. Glass Panel — Apple-vari with subsurface light */
.glass-panel-apple {
  background: linear-gradient(
    170deg,
    rgba(255, 255, 255, 0.10) 0%,
    rgba(255, 255, 255, 0.04) 40%,
    rgba(255, 255, 255, 0.01) 100%
  );
  border: 0.5px solid rgba(255, 255, 255, 0.15);
  border-top-color: rgba(255, 255, 255, 0.25);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.12),
    0 4px 16px rgba(0, 0, 0, 0.10),
    0 1px 4px rgba(0, 0, 0, 0.06);
  backdrop-filter: blur(28px) saturate(160%);
  -webkit-backdrop-filter: blur(28px) saturate(160%);
}

/* 5. Glass Card — Premium floating card */
.glass-card-apple {
  background: linear-gradient(
    170deg,
    rgba(255, 255, 255, 0.08) 0%,
    rgba(255, 255, 255, 0.03) 50%,
    rgba(255, 255, 255, 0.01) 100%
  );
  border: 0.5px solid rgba(255, 255, 255, 0.12);
  border-top-color: rgba(255, 255, 255, 0.20);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.10),
    0 8px 32px rgba(0, 0, 0, 0.12),
    0 2px 8px rgba(0, 0, 0, 0.08),
    0 0 0 1px rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(24px) saturate(140%);
  border-radius: 24px;
}

/* 6. Glass Chip — Small inline elements */
.glass-chip-apple {
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.10) 0%,
    rgba(255, 255, 255, 0.04) 100%
  );
  border: 0.5px solid rgba(255, 255, 255, 0.12);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 2px 8px rgba(0, 0, 0, 0.08);
  backdrop-filter: blur(12px) saturate(140%);
  border-radius: 12px;
}

/* 7. Active/Primary Chip — Desaturated gold with inner glow */
.glass-chip-active {
  color: #161006;
  background: linear-gradient(180deg, #d8b156 0%, #c9a24b 100%);
  border: 0.5px solid rgba(216, 177, 86, 0.70);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    0 4px 12px rgba(161, 120, 44, 0.20);
}

/* 8. Bottom Nav — Floating glass capsule */
.glass-nav-capsule {
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.08) 0%,
    rgba(255, 255, 255, 0.04) 100%
  );
  border: 0.5px solid rgba(255, 255, 255, 0.12);
  border-top-color: rgba(255, 255, 255, 0.20);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 8px 32px rgba(0, 0, 0, 0.15),
    0 2px 8px rgba(0, 0, 0, 0.10);
  backdrop-filter: blur(24px) saturate(160%);
  border-radius: 28px;
}

/* 9. Shimmer — Hover-only, slower, subtler */
.shimmer-hover:hover::after {
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(
    105deg,
    transparent 40%,
    rgba(255, 255, 255, 0.04) 50%,
    transparent 60%
  );
  background-size: 200% 100%;
  animation: shimmerSweep 5s ease-in-out infinite;
  pointer-events: none;
  border-radius: inherit;
}

/* 10. Animations */
@keyframes aurora-drift {
  0%, 100% { transform: translate3d(-2%, -1%, 0) scale(1); opacity: 0.9; }
  33% { transform: translate3d(3%, 2%, 0) scale(1.03); opacity: 1; }
  66% { transform: translate3d(-1%, 3%, 0) scale(0.97); opacity: 0.85; }
}

@keyframes shimmerSweep {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

---

## 9. İşıq (Light) Teması — Yeni Nəsil

Mövcud light tema (`#F8F6F4`) çox "sarımtıl"dır. Dünya standartı (Apple, Starbucks light mode):

```css
/* Yeni Light Shell — Pure white with subtle warmth */
.customer-app-shell-light {
  background: linear-gradient(180deg, #ffffff 0%, #f5f5f7 100%);
}

/* Light glass — iOS 18 style */
.glass-panel-light {
  background: linear-gradient(
    170deg,
    rgba(255, 255, 255, 0.85) 0%,
    rgba(255, 255, 255, 0.65) 40%,
    rgba(255, 255, 255, 0.45) 100%
  );
  border: 0.5px solid rgba(0, 0, 0, 0.06);
  border-top-color: rgba(255, 255, 255, 0.80);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.60),
    0 4px 16px rgba(0, 0, 0, 0.06),
    0 1px 4px rgba(0, 0, 0, 0.04);
  backdrop-filter: blur(28px) saturate(140%);
}
```

**Fərq:** `border-top-color` iOS-vari "içəri işıq" effekti yaradır — light mode-da daha parlaq.

---

## 10. Nəticə — Dünya Səviyyəsinə Çatmaq

### Ən Böyük 5 Təsirli Dəyişiklik (En Maksimum Visual Impact)

1. **Aurora + noise arxa fon** — Customer App-a dərhal "premium" hiss qatır (Phase 1, G2)
2. **Apple-vari glass panel** — `inset` işıq + `border-top` highlight + `0.5px` border (Phase 1, G1)
3. **Typography refinement** — `font-black` → `font-bold`, `uppercase` azaltmaq (Phase 1, G3)
4. **Spacing açmaq** — 16px → 24px section gap (Phase 1, G4)
5. **Card edge highlight** — kart üst kənarında güclü gradient (Phase 1, G5)

### 1 Cümlə

> **Customer App-in glassmorphism altyapısı (blur, aurora, shimmer) möhkəmdir, amma dünya səviyyəli (Starbucks, Apple, Linear) olmaq üçün 5 əsas dəyişiklik tələb olunur: (1) aurora + noise arxa fon layer, (2) Apple-vari `inset` işıqlı glass panel, (3) typography refinement (black→bold, uppercase azaltmaq), (4) spacing genişləndirmə (16px→24px), (5) card edge highlight gücləndirmə. Bu dəyişikliklər 1-2 həftə ərzində tətbiq oluna bilər və app-in vizual dəyərini 6.0/10 → 8.5/10-a çatdırar.**

---

*Audit tamamlandı. Source code (CustomerApp.tsx, HomeTab.tsx, OrderTab.tsx, ProfileTab.tsx, BaristaTab.tsx, FalciTab.tsx, index.css) ətraflı oxundu, mövcud audit sənədləri (CUSTOMER_APP_UI_AUDIT.md, CUSTOMER_APP_STARBUCKS_BENCHMARK.md) nəzərə alındı, dünya standartları (Apple HIG, macOS, Linear, Raycast, Starbucks) ilə müqayisə edildi.*
