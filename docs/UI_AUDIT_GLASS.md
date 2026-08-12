# UI Audit & macOS Glass Planı — iRonWaves POS

> 🌐 **English version:** [UI_AUDIT_GLASS_EN.md](UI_AUDIT_GLASS_EN.md)

> Bu sənəd UI-nin hazırkı vəziyyətini, macOS-üslublu glass (frosted glass) dizayn sisteminə keçid planını və production-da təhlükəsiz tətbiq qaydalarını təsvir edir. Komanda gələcək glass işlərini bu plana uyğun aparmalıdır.

**Status (2026-08):** Phase 1 (glass token sistemi + `data-ui-mode` bağlantısı) və PinLogin glass-ı implementasiya olunub. Aşağıdakı bölmələrdə status hər maddə üzrə qeyd olunub.

---

## 1. Məqsəd

1. Proqramın bütün personal ekranlarına (POS, Masalar, KDS, Admin) macOS "Ventura/Sonoma" üslublu **yumşaq şüşə** effekti gətirmək: translucency + `backdrop-blur`, hairline border, yumşaq laylı kölgə, iç parıltı.
2. **Göz yorğunluğunu azaltmaq:** doymuş sarı akcenti (`#facc15`) doymamış qızılıya (`#d8b156`) yumşaltmaq, saturasiyanı 140%-ə endirmək.
3. **Production təhlükəsizliyi:** bütün dəyişikliklər default OFF/geri qaytarıla bilən olmalı; kafelərdə işləyən mövcud görünüş korlanmamalıdır.

---

## 2. Hazırkı vəziyyət (audit nəticəsi)

| Aspekt | Vəziyyət | Qeyd |
|---|---|---|
| Ümumi üslub | "Metal & Neon" | Tünd navy (`#0e1526`), qızıl (`#facc15`) |
| Glassmorphism | Yalnız Müştəri Tətbiqi | `cust-glass`: `blur(24px) saturate(180%)` |
| Personal ekranlar | Opaque (90–96%) | `backdrop-filter` effekt vermir (arxada məzmun yoxdur) |
| Light tema | Mövcud, yaxşı qurulub | 3 səviyyəli dərinlik: `#f1f5f9 → #ffffff → shadow` |
| `html[data-ui-mode='new']` CSS | **Ölü kod idi → indi qoşulub** | Əvvəl `App.tsx` hər zaman `'old'` yazırdı |

### 2.1 Kritik texniki tapıntılar

1. **`data-ui-mode` hardcoded idi.** `App.tsx` sətir ~746: `root.setAttribute('data-ui-mode', 'old')` — `html[data-ui-mode='new']` altındakı ~500 sətir CSS heç vaxt işləmirdi. **Düzəldildi:** artıq `session_settings.ui_mode` ayarına bağlıdır (default `'old'`).
2. **POS "modern" rejimi natamam idi.** `POS.tsx` `isNewUiMode` öz ayrıca məntiqlə işləyir (`localStorage iw_pos_ui_mode` / `tables_ui_mode==='modern'`), amma `pos2-shell` arxa fonu `data-ui-mode='new'` altında təyin olunubdu — heç vaxt aktivləşmirdi. **Hələ də açıq boşluq** (bax §9).
3. **Lightning CSS + Chrome-ın `-webkit-backdrop-filter` problemi.** Müasir Chrome `-webkit-backdrop-filter`-i nəzərə almır. Eyni blokda `backdrop-filter` + `-webkit-backdrop-filter` cütü yazıldıqda Lightning CSS cütü yalnız `-webkit-` formasına endirir → blur Chrome-da səssizcə ölür. **Qayda: glass CSS-də yalnız unprefixed `backdrop-filter` yazılır.**

---

## 3. Glass Token Sistemi (Phase 1 — implementasiya olunub)

`src/index.css`-ə əlavə olunub (`:root` səviyyəsində, `@layer components` sonunda "GLASS UI LAYER" bloku ilə):

```css
:root {
  --glass-blur: 18px;          /* panel blur-u */
  --glass-saturate: 140%;      /* saturasiya (customer app 180% → 140%) */
  --glass-border: rgba(255, 255, 255, 0.10);   /* hairline border */
  --glass-highlight: rgba(255, 255, 255, 0.08); /* iç parıltı */
  --glass-accent: #d8b156;     /* doymamış qızılı (akcent) */
  --glass-accent-deep: #c9a24b;
}
```

**Aktivləşmə şərti:** yalnız `html[data-ui-mode="new"]` olduqda. Tenant `session_settings.ui_mode === 'new'` qoysa bütün personal ekranlarında glass işləyir. Default `'old'` → heç nə dəyişmir.

**Glass layer-in əhatə etdiyi elementlər:**
- Panellər: `.metal-panel`, `.pos2-checkout-pane`, `.pos3-checkout/menu/header`, `.staff-pos-header/main`, `.staff-cart-panel`
- Düymələr: `.neon-btn/chip/tab`, `.pay-btn`, `.neon-item` — `blur(14px)`
- Inputlar: `.neon-input` — `blur(12px)`
- Kartlar: `.pos2-product-card`, `.pos3-card`, `.staff-product-card`, `.staff-recent-card`
- Aktiv düymələr: `#d8b156 → #c9a24b` gradient, tünd mətn `#161006`
- `.metal-app` fonuna vibrancy ləkələri (blur-un bulanıqlaşdıracağı məzmun)

**Fallback-lər:**
- `@supports not (backdrop-filter)` → panellər möhkəm tünd rəng alır (oxunaqlılıq qorunur)
- `@media (prefers-reduced-transparency: reduce)` → blur söndürülür, möhkəm fon

**Əlaqəli dəyişiklik:** `src/App.tsx` — `data-ui-mode` `settings.session_settings.ui_mode`-a bağlandı.

---

## 4. PinLogin Glass (implementasiya olunub)

`src/components/PinLogin.tsx` — yalnız bu fayl dəyişdi:

- **Fon:** sağ panel düz qaranlıqdan yumşaq radial ləkələrə keçdi (`LOGIN_BG_GRADIENT`: qızılı/mavi/teal, hərəsi ~10–16% alfa).
- **Kart:** `GLASS_CARD` = `bg-white/[0.07]` + `backdrop-blur-[18px]` + `backdrop-saturate-[140%]` + `border-white/10` + yumşaq laylı kölgə.
- **Sol panel (restoran şəklinin üstündə):** `GLASS_CARD_OVER_IMAGE` = tünd frosted `rgba(13,18,28,0.55)` — parlaq şəkillərdə oxunaqlılıq üçün.
- **Akcent:** bütün `#facc15`/`#f59e0b` → `#d8b156 → #c9a24b`, tünd mətn `#161006`.
- **Qeyd:** Bu dəyişiklik **default açıqdır** — bütün tenantların giriş ekranı növbəti deploydan etibarən glass görünəcək (Phase 1-dən fərqli olaraq opt-in deyil; bu şüurlu qərardır).

---

## 5. Kontrast Analizi (WCAG 2.x)

Hesablama: relative luminance + kontrast düsturu ilə aparıldı (`node /tmp/contrast.mjs` kimi skript). Qısa xülasə:

### 5.1 Akcent fon + tünd mətn (düymə etiketi)

| Akcent | `#111827` mətn | `#161006` mətn | Ağ mətn |
|---|---|---|---|
| `#facc15` (cari) | 11.58 AAA | 12.34 AAA | 1.53 ❌ |
| `#b45309` (köhnə `--gold-b`, indi `#c9a24b`) | **3.53 ⚠️** | 3.76 ⚠️ | 5.02 AA — mətn kimi saxlanır |
| `#d8b156` (təklif) | **8.74 AAA** | **9.31 AAA** | 2.03 ❌ |
| `#c9a24b` (təklif) | **7.39 AAA** | **7.88 AAA** | 2.40 ❌ |
| `#e8c877` (açıq mətn) | 10.95 AAA | 11.67 AAA | 1.62 ❌ |

### 5.2 Akcent mətn kimi (tünd fonlar)

| Akcent | Kontrast | | Akcent | Kontrast |
|---|---|---|---|---|
| `#facc15` | 11.88 AAA | | `#d8b156` | 8.96 AAA |
| `#fcd34d` (qiymətlər) | 12.62 AAA | | `#e8c877` | 11.23 AAA |
| `#fbbf24` | 10.90 AAA | | `#c9a24b` | 7.59 AAA |

### 5.3 Kritik nəticələr

1. **`#b45309` kontrast bug-ı:** `neon-btn-active` gradient dibi tünd mətndə cəmi 3.53:1 — normal mətn üçün AA keçmir. `#d8b156→#c9a24b` keçidi bunu düzəldir (7.39 AAA). **✅ Hazır (2026-08-12):** `--gold-b` həm `:root`, həm də `:root[data-ui-mode='new']`-də `#c9a24b` edildi — old/light/new bütün variantlarda gradient dibi `#c9a24b`-dir (build + vizual yoxlama keçdi).
2. **Qızıl üzərində ağ mətn qadağandır** (bütün tonlarda FAIL). CustomerApp toast-ları (`#F48C24` + ağ mətn = 2.44:1) ayrıca düzəliş tələb edir.
3. **Light-temada qızıl mətn yoxdur:** açıq qızılı (`#fcd34d`) ağ kartda 1.44:1 — ən azı `#b45309` (5.02 AA) işlədilməlidir.
4. **KDS üçün parlaq sarı saxlanmalıdır** — mətbəx ekranı uzaqdan oxunur (`#facc15` + `#0f172a` = 13.17 AAA).
5. **POS akcenti tenant-əsaslıdır** (`pos_layout.accent_color`, default `#facc15`) — default-u `#d8b156` etmək yeni tenant-lar üçün keçərlidir; mövcud tenantların dəyəri toxunulmaz.

---

## 6. Ekran-ekran Tətbiq Planı (prioritet + status)

| Prioritet | Ekran | Təklif | Status |
|---|---|---|---|
| 🥇 1 | **PinLogin** | Fon ləkələri + glass kart + `#d8b156` | ✅ **Hazır** |
| 🥇 2 | **POS (satış)** | Səbət paneli `blur(16px)`, menü kartları şəffaf | ⏳ Phase 1 CSS-də hazır, tenant aktivləşdirməsi lazım |
| 🥈 3 | **App shell / naviqasiya** | Üst bar + modul naviqasiyası glass pill | ⏳ `metal-panel`/`neon-*` vasitəsilə hazır |
| 🥈 4 | **Masalar (Tables)** | Masa kartları glass, status rəngləri saxla | ✅ **Hazır (2026-08-12)** — opt-in `data-ui-mode='new'`; `table-card-glass`/`floor-table-cell`/`tables-glass-panel` blur(16px, §7.6), shell ləkələri; status rəngləri saxlanıb |
| 🥉 5 | **KDS (mətbəx)** | Parlaqlıq saxlanmalı; yalnız panellərdə yumşaq blur | ⚠️ xüsusi diqqət |
| 🥉 6 | **AdminPanel** | Glass kartlar; light-temada açıq variant | ⏳ yoxlanılmayıb |
| ✅ Hazır | **CustomerApp** | Tam glass mövcuddur | ℹ️ yalnız `saturate(180%)→140%` endirmə |
| ✅ Hazır | **Akcent kontrast bug-ı** | `--gold-b` gradient dibi `#b45309`→`#c9a24b` (old/light/new) | ✅ **Hazır (2026-08-12)** |

---

## 7. Production Rollout Qaydaları

1. **Opt-in, default OFF:** `session_settings.ui_mode === 'new'` olmadan heç bir ekran dəyişmir. SettingsPanel həmişə `'old'` saxlayır — təsadüfi aktivləşmə mümkün deyil.
2. **Deploy-dan əvvəl:** production DB-də `ui_mode='new'` olan tenant olub-olmadığını yoxla (varsa, həmin tenant növbəti deployda yeni görünüşü alacaq — bu, əvvəllər ölü olan CSS-in ilk real işləməsi olacaq).
3. **Çap sistemi toxunulmaz:** `THERMAL_RECEIPT_PRINT_CSS`, barkod/QR rendering ayrıdır — dəyişmək qadağandır.
4. **`backdrop-filter` qaydası:** yalnız **unprefixed** yazılır (Chrome `-webkit-` formasını nəzərə almır, Lightning CSS cütü dedupe edir).
5. **Kontrast qaydaları:** hər dəyişiklikdən sonra mətn ≥4.5:1 (AAA hədəf); qızıl üzərində ağ mətn yoxdur; light-temada qızıl mətn yoxdur.
6. **Zəif cihazlar:** blur-ü böyük səthlərdə 16px-dən yuxarı qaldırma; `prefers-reduced-transparency` və `@supports` fallback-ləri qorunmalıdır.

---

## 8. Double-Check Siyahısı (hər dəyişiklikdən sonra)

- [ ] `npx tsc --noEmit` — yeni xəta yoxdur (mövcud 23 xəta köhnədir: POS.tsx, TablesPage.tsx, CustomerApp.tsx, background_fetch.ts — bu layihədə tanınmış texniki borcdur)
- [ ] `npm run build` — production build keçir
- [ ] Built CSS-də glass tokenlər var: `grep -o "glass-blur:[^;]*" dist/assets/*.css`
- [ ] Default rejimdə (`data-ui-mode='old'`) görünüş dəyişməyib (computed-style yoxlaması)
- [ ] Giriş → POS → Satış → Çap → Z-hesabat axını sınanıb
- [ ] Light-temada kontrast qorunur
- [ ] Offline rejimdə UI sıradan çıxmır (glass sırf CSS-dir, offline-a təsirsiz)
- [ ] Yalnız CSS/class dəyişiklikləri — biznes məntiqi (satış, maliyyə, inventar) toxunulmayıb

---

## 9. Məlum Boşluqlar / Növbəti Addımlar

1. **POS `isNewUiMode` uzlaşdırılması:** ~~`POS.tsx` hələ `session_settings.ui_mode`-a baxmır (yalnız `tables_ui_mode`/localStorage). Tenant `ui_mode='new'` qoysa qlobal glass işləyir, amma POS layout `pos2/pos3` klasslarına keçmir. İki qapı eyniləşdirilməlidir.~~ **✅ Hazır (2026-08-12):** `POS.tsx` `isNewUiMode` və `App.tsx` `currentUiMode` artıq `session_settings.ui_mode === 'new'`-ı da yoxlayır (lokal override → host → `ui_mode` → `tables_ui_mode`). Glass tenant-ı indi `pos2/pos3` layout-a da keçir — tək qapı. **Qeyd:** `TablesPage.isBahaYLab` bilərəkdən `ui_mode`-a bağlanmır — bu eksperimental lab qapısıdır (`super.ironwaves.store` + `tables_ui_mode='modern'`); glass CSS masalar ekranına `data-ui-mode` vasitəsilə ayrıca tətbiq olunur.
2. **`#b45309` düzəlişi:** ~~`neon-btn-active` gradient dibi 3.53:1 — `#c9a24b`-yə dəyişilməlidir (bax §5.3.1).~~ **✅ Hazır (2026-08-12)** — `--gold-b` → `#c9a24b` (old/light/new variantlarında; mətn rəngi `#b45309` qəsdən saxlanıldı, 5.02 AA).
3. **KDS yoxlanışı:** ~~glass rejimində parlaqlıq itməməlidir.~~ **✅ Yoxlanıldı (2026-08-12, computed-style):** KDS neon-* sinifləri işlətmədiyi üçün glass layer masalarına toxunmur — order kartlarının `bg-{c}-900/20` + `border-{c}-300/*` rəngləri NEW mode-da eyni qalır (utilities qazanır), sarı akcentlər (`text-yellow-300`) parlaq saxlanılır; yalnız `metal-panel` (header çipi) yumşaq glass blur alır. Kod dəyişikliyi tələb olunmadı.
4. **Light-temada qızıl mətn** (qiymətlər) — ~~ən azı `#b45309`-a endirilməlidir.~~ **✅ Artıq təmin olunub:** `html[data-theme='light'] [class*='text-amber-100']` (və yellow/orange) `color: #b45309` (5.02 AA) ilə xəritələnir — dəyişiklik tələb olunmur.
5. **CustomerApp portağalı** (`#F48C24`) — ~~ağ mətnli toast/düymələr tünd mətnə çevrilməlidir.~~ **✅ Hazır (2026-08-12):** `.cust-toast` mətn rəngi `#fff` → `#1c1917` (2.44:1 → ~7.18:1). Join düyməsi artıq `text-slate-950` idi — dəyişiklik tələb olunmadı.
6. **Demo artefaktları:** ~~`.freebuff-glass-preview/` qovluğu (demo HTML-lər, hər biri ~380KB inline CSS) müvəqqətidir — commit etməzdən əvvəl silinməlidir.~~ **✅ Silindi (2026-08-12)** — qovluq repository-dən təmizləndi.

---

## 10. Yoxlama Komandaları

```bash
npx tsc --noEmit                              # tip yoxlaması (yeni xəta = 0 olmalı)
npm run build                                 # production build
grep -o "glass-blur:[^;]*" dist/assets/*.css  # glass tokenlər built CSS-də
node smoke_test.mjs                           # customer app smoke test (VM-də flaky)
```

**Qeyd:** `smoke_test.mjs` bu VM-də etibarsızdır (headless Chromium təsadüfi asılır). Etibarlı alternativ: built CSS ilə statik demo HTML + computed-style yoxlaması (bu sənəd hazırlanarkən istifadə edilib).
