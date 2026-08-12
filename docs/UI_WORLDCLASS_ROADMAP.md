# 🚀 UI World-Class Yol Xəritəsi (iRonWaves POS)

> 🌐 **English version:** [UI_WORLDCLASS_ROADMAP_EN.md](UI_WORLDCLASS_ROADMAP_EN.md)

## 1. Fəlsəfə — "Əvvəl sürət və aydınlıq, sonra parıltı"

Dünya səviyyəli restoran POS-unu (Toast, Square, Poster, iiko) gözəllik yox, **ofisiantın əmr daxiletmə sürəti** müəyyən edir. Glass/aurora brend qatıdır, əsas deyil. Bu sənəd 3 qatlı dizayn sistemini, macOS tərzli aurora reseptini, şüşə primitiv spec-ini, göz yormayan tünd palitra qaydalarını və 5 addımlı yol xəritəsini müəyyən edir. Bütün dəyişikliklər `data-ui-mode='new'` opt-in qapısı arxasında qalır — mövcud kafelər (classic) dəyişmir.

## 2. 3 qatlı dizayn sistemi

Dünya səviyyəsinə çıxmağın əsası **"tək vizual dil"**dir — bu, rəqabət auditindəki ən böyük boşluqdur (5 fərqli dil eyni məhsulda: metal/neon staff, pos2/pos3, classic masalar, customer orange, mobil waiter).

| Qat | Nədir | Vəziyyət |
|---|---|---|
| **1. Tokenlar** | CSS dəyişənləri: rəng, radius, blur, border, kölgə, tip, spacing | 🟡 Başlanıb — glass tokenlər var; tip/spacing tokenləri çatışmır |
| **2. Primitivlər** | Təkrar komponentlər: `glass-panel`, `glass-card`, `glass-input`, `chip`, `badge`, `modal` | 🔴 Ən böyük boşluq — indi hər ekranda ad-hoc Tailwind sinifləri |
| **3. Semantika** | Status rəngləri, tip skala, sürət qaydaları | 🟢 Status rəngləri **hazır** (`TABLE_STATUS_THEME` + `ORDER_STATUS_THEME`) |

### 2.1 Token qatı (başlanmış, genişləndiriləcək)

```
--glass-blur:    16px          (böyük səthlərdə; §7.6 zəif-cihaz limiti)
--glass-saturate: 140%
--glass-border:   rgba(255,255,255,0.08)   (hairline)
--glass-edge:     rgba(255,255,255,0.06)   (1px yuxarı işıq kənarı)
--glass-accent:   #d8b156      (doymamış qızılı)
--bg-base:        #0b131f      (isti tünd, saf qara deyil)
```

Çatışmayan: `--type-scale` (4 səviyyə), `--space-*` (4/8/12/16/24/32), `--ease-*`, `--duration-*`.

### 2.2 Primitiv qatı (qurulacaq)

Təkrar istifadə olunan `glass-*` klassları (tək CSS qaydası, bütün ekranlarda eyni):

```
glass-panel  → panellər, sidebar-lar        (blur 16px + saturate 140% + hairline + laylı kölgə)
glass-card   → kartlar                       (blur 16px, incə border, hover: 1px lift)
glass-input  → axtarış/giriş sahələri        (solid fon + hairline, focus ring accent)
glass-chip   → kateqoriya/filtr çipləri      (aktiv = accent gradient)
solid-btn    → əsas düymələr                 (SOLID — kontrast və basıla bilən hiss üçün)
```

### 2.3 Semantik qatı (hazır)

- **Status rəngləri:** Boş=emerald · Rezerv=amber · Dolu=rose · Aktiv=violet · Təmizlik=slate (floor plan)
- **Order statusları:** NEW/SENT=blue · PREPARING=orange · READY=emerald · VOID_REQUESTED=yellow · VOIDED=rose · COMPED=sky · WASTE=slate · SERVED=violet (KDS)
- Hər iki palitra ortaq util fayllarında tək mənbədir — yeni status əlavə etmək = bir yerdə dəyişiklik.

## 3. Aurora fon resepti

macOS tərzli yumşaq, hərəkətli rəng ləkələri — 4 qayda ilə. **✅ Hazır (2026-08-12):** `index.css` GLASS UI LAYER-də `html[data-ui-mode='new'] .metal-app::before/::after` — 2 yumşaq ləkə (qızılı + mavi/teal), `transform`+`opacity` keyframes (32s/40s), `z-index:-1` + `isolation:isolate` + `overflow:clip`. Yalnız shell/login arxa fonunda — panellərin arxasında deyil.

1. **Qlobal, elementar deyil.** Aurora shell-in arxa fonudur (login, dashboard, POS boş vəziyyəti). Panellərin arxasına ləkə qoymaq oxuna bilməni öldürür.
2. **GPU-dostu animasiya.** `transform` + `opacity` ilə 2-3 rəng ləkəsi, 25-40s yavaş dövr, `will-change` yalnız 1 elementdə. CSS keyframes — JS yox. Layout-animasiya (top/left) qadağandır.
3. **Zəif cihaz + reduced-motion.** `prefers-reduced-transparency` (ləkələr gizlənir) və `prefers-reduced-motion` (statikləşir) — hər ikisi implementasiya olunub. Blur limiti §7.6 (≤16px).
4. **KDS-də yoxdur.** Mətbəx ekranında aydınlıq kritikdir — aurora yalnız xidmət/staff ekranlarında.

## 4. Şüşə primitivləri — spec

```
glass-panel {
  backdrop-filter: blur(16px) saturate(140%);
  border: 1px solid var(--glass-border);
  box-shadow: inset 0 1px 0 var(--glass-edge),   /* yuxarı işıq kənarı */
              0 16px 40px rgba(2, 6, 23, 0.4);
}
```

**Kritik qayda:** şüşə **panellərdə**, düymələrdə **deyil**. Düymələr kontrast və "basıla bilən" his üçün solid qalır — bu, glass-ı yanlış tətbiq edənlərin №1 səhvidir. @supports fallback (blur dəstəklənmirsə → solid tünd fon) artıq GLASS UI LAYER-də mövcuddur.

## 5. Tünd palitra qaydaları

| Qayda | Dəyər | Niyə |
|---|---|---|
| Saf qara yox | `#0b131f` ailəsi (isti tünd) | Saf qara gözü yorur, aurora ilə uyğun deyil |
| Akcent | `#d8b156` (doymamış qızılı) | Neon sarıdan yumşaq; kontrast hesablanıb |
| Mətn kontrastı | WCAG AA (4.5:1 body, 3:1 böyük) | Auditdəki `#b45309` və cust-toast bug-ları bağlanıb |
| Status | emerald/amber/rose/violet/slate | Semantik, vahid, hər yerdə eyni |
| Parıltı | Yalnız aktiv/urgent elementlərdə | Az — daha çox təsir |

## 6. 5 addımlı yol xəritəsi

| # | Addım | Effekt | Status |
|---|---|---|---|
| 1 | **Primitiv komponent kitabxanası** — 5 vizual dil → tək `glass-*`/`solid-*` sistemi (token əsaslı, opt-in) | Tutarlılıq | ⏳ |
| 2 | **Sürət əməliyyatları** — POS sol rail, klaviatura qısayolları (F=fire, P=pay), touch ≥44px, optimistic UI | Order-entry sürəti | ⏳ (rail planı hazır) |
| 3 | **Mikro-interaksiyalar** — haptic, 120ms press state, kart lift, cart-a əlavədə yumşaq bounce | "Zövq alma" hissi | ⏳ |
| 4 | **Motion disiplini** — 150ms UI / 300ms overlay, vahid easing, `prefers-reduced-motion` sıfırlama | Peşəkarlıq hissi | ⏳ |
| 5 | **Tip sistemi** — 4 səviyyə (display/title/body/caption), qiymətlərdə `tabular-nums` | Aydınlıq + tarazlıq | ⏳ |

## 7. Double-check siyahısı (hər addımdan sonra)

1. `npx tsc --noEmit` — 23 xəta baza ilə eyni (yeni yoxdur)
2. `npm run build` — keçməli
3. Built CSS-də yeni klassların grep-i (Tailwind `.ts` literallarını scan edir)
4. **Computed-style vizual yoxlama** (clean-room demo: blur/saturate/border/kölgə dəyərləri)
5. **Classic rejim dəyişməz** — `data-ui-mode` qapısı yoxlanır
6. Zəif cihaz + `prefers-reduced-motion`/`-transparency` fallback-ları
7. Code review

## 8. Əlaqəli sənədlər

- [UI_AUDIT_GLASS.md](UI_AUDIT_GLASS.md) — glass tətbiqinin texniki spesifikasiyası (AZ)
- [UI_AUDIT_GLASS_EN.md](UI_AUDIT_GLASS_EN.md) — eyni sənəd (EN)
- [UI_COMPETITIVE_AUDIT.md](UI_COMPETITIVE_AUDIT.md) — rəqabət audit + prioritetlər (AZ)
- [UI_COMPETITIVE_AUDIT_EN.md](UI_COMPETITIVE_AUDIT_EN.md) — eyni sənəd (EN)
