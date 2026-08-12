# Rəqabət UI Auditi — iRonWaves POS (dünya standartları ilə müqayisə)

> 🌐 **English version:** [UI_COMPETITIVE_AUDIT_EN.md](UI_COMPETITIVE_AUDIT_EN.md)

> Bu sənəd iRonWaves POS-un UI-sini dünya səviyyəli restoran POS/SaaS platformaları (Toast POS, Square for Restaurants, Lightspeed Restaurant, Poster POS, iiko) ilə müqayisə edir — estetik, funksional və sürət baxımından geridə qalan məqamları, hər biri kod əsaslı dəlillə, və prioritetli aksiya planını təsvir edir. Komanda gələcək UI işlərini bu plana uyğun aparmalıdır.

**Status (2026-08-12):** Auditi çəkilmişdir — implementasiya hələ başlamamışdır. Prioritetlər aşağıdakı aksiya planındadır.

---

## 1. Xülasə

| Aspekt | Vəziyyət | Dünya səviyyəsinə məsafə |
|---|---|---|
| Estetik | Parçalanmış dizayn sistemi (5 fərqli vizual dil eyni məhsulda) | 🟠 Orta — glass işi (UI_AUDIT_GLASS.md) yaxşı başladı, amma tək sistem yoxdur |
| Funksional | Güclü biznes məntiqi (maliyyə, tenant, offline), lakin layout/UX detalları geridə | 🟡 Orta-aşağı |
| Sürət | Lazy loading ✓, amma 2.4MB JS ümumi, 398KB dashboard chunk | 🟠 Optimallaşdırma tələb olunur |

---

## 2. Estetik baxımdan geridə qalanlar

### 2.1 Tək dizayn sistemi yoxdur — 5 fərqli vizual dil eyni məhsulda

| Dil | Harada | Xüsusiyyət |
|---|---|---|
| "Metal & Neon" | Staff (default) | Tünd navy `#0e1526` + `#facc15` qızıl (`:root` tokenları) |
| POS2/POS3 | `isNewUiMode` layout | Ayrıca klass sistemi (`pos2-*`, `pos3-*`) |
| Masalar "classic" | TablesPage | Masa kartları ayrıca rəngli gradientlər |
| CustomerApp | Müştəri tərəfi | Tam başqa vizual (orange `#F48C24`, retro tema, glass) |
| Mobile Waiter | MobileWaiterUI | Menulux-style solid gradient kartlar |

**Dünya standartı:** tək design system + rol əsaslı view (Toast/Square) — eyni tokenlar, eyni kart dili bütün ekranlarda. Bu gün bir ofisiant POS-da fərqli, masalarda fərqli, telefonda fərqli görünüş görür.

### 2.2 Rəng semantikası tutarsızdır

- Eyni məna üçün fərqli rənglər: `#facc15` (staff), `#F48C24` (customer), `#d8b156` (glass), `#fbbf24` (masalar), fuchsia/violet/cyan (admin).
- Status rəngləri tutarsız: masalarda `emerald`=boş, KDS-də `emerald`=READY, müştəridə `emerald`=online.
- **Dünya standartı:** semantik rəng sistemi — status = rəng, hər yerdə eyni (məs. `boş=dolu=rezerv=aktiv=təmizlik` üçün tək palitra).

### 2.3 Tip skala parçalanıb

- Arbitrary ölçülər hər yerdə: `text-[9px]`…`text-[17px]` (TableGrid, KDS, POS kartları).
- **Dünya standartı:** 3–4 səviyyəli tip skala (display / title / body / caption) — tutarlı hiyerarxiya.

### 2.4 Floor plan real deyil

- `FloorView` masa hüceyrələri düz rəngli grid kvadratlarıdır (`bg-emerald-500/15 border-emerald-300/40`), plan şəkli/fon yoxdur.
- **Dünya standartı (Toast, Square, iiko):** real mərtəbə xəritəsi — restoran planı şəkli üzərində masalar, forma/ölçü/rotasiya, divarlar, bar sayğacı.

---

## 3. Funksional baxımdan geridə qalanlar

### 3.1 POS layout-u sürətli əmr girişi üçün deyil

- Kateqoriyalar **üfüqi chip-lərdir** (`pos3-chip`); solda **persistent kateqoriya rail yoxdur** (`left_widget_order: ['menuHeader','search','categories','productGrid']` — hər şey bir sütunda).
- Ürün kartları kiçikdir (`grid-cols-2 md:grid-cols-3 2xl:grid-cols-4`).
- **Dünya standartı:** sol şaquli kateqoriya rail (hər zaman görünən) + böyük ürün kartları (touch target ≥ 90×90px, tez-tez alınan ürünlər daha böyük) + sağda cart paneli. Landşaft tablet üçün sol rail kritikdir.

### 3.2 Klaviatura qısa yolları yoxdur

- POS-da `onKeyDown` qısayolları tapılmadı (0 nəticə).
- Axtarış mövcuddur ✓ (`pos-menu-search`, autofocus), lakin match sadə `includes`-dir (`POS.tsx:1005`) — fuzzy/phonetic yoxdur.
- **Dünya standartı:** qısayollar (F=fire, P=pay, `#`=open item, nömrə+enter) + typo-tolerant axtarış.

### 3.3 Dashboard məlumat bombardmanı — skeleton yoxdur

- Dashboard 10+ məlumat mənbəyi birdən yükləyir (`DashboardPanel.tsx:32-41`): sales, finance, inventory, kds, tables, logs, anomalies, AI insights.
- Loading sadə `snapshot.loading` boolean-dır — **skeleton yoxdur** (yalnız PinLogin-də skeleton var).
- **Dünya standartı:** hər KPI card üçün skeleton + progressive loading.

### 3.4 Boş state-lər və bələdçilik zəif

- TableGrid boş state var ✓; lakin ümumi sistemdə boş ekranlar (inventory, CRM, recipes) "nə var, nə yoxdur" göstərmir.
- **Dünya standartı:** boş state = "burdan başlayın" + aksiya düyməsi.

### 3.5 Optimistic UI yarımcıqdır

- Masa əməliyyatları (masa açma, round göndərmə) server round-trip gözləyir (`await open_table_live(...)`).
- Offline-first mövcuddur ✓, lakin onlayn rejimdə belə gecikmə hiss olunur.
- **Dünya standartı:** optimistic update — UI dərhal dəyişir, səhv olarsa geri qayıdır.

---

## 4. Sürət baxımından geridə qalanlar (ölçülmüş)

| Problem | Ölçü | Səbəb |
|---|---|---|
| DashboardPanel chunk-u | **398KB** (gzip ~117KB) — ən böyük chunk | `recharts` (AreaChart, PieChart…) dashboard ilə birgə yüklənir |
| App.tsx | 245KB | Bütün modul konfiq + 30+ useEffect bir faylda |
| Ümumi JS | **2.4MB** (gzip ~700KB) | 18 admin modulu + customer app + PWA |
| Dashboard yükləməsi | 10+ API paralel | Skeleton yoxdur → "boş ekran" hissi |
| Şəkillər | Optimallaşdırılmır | `image_url`/`thumbnail` olduğu kimi — webp/avif/responsive `srcset` yoxdur |

**Yaxşı olanlar (mühafizə edin):** lazy loading ✓ (hər modul ayrı chunk), tenant hot-path preload ✓ (App.tsx ~1470: 500ms sonra stagger ilə), offline-first local SQLite ✓, realtime subscription ✓, VirtualKeyboard + haptics ✓, KDS time-urgency rəng kodlaşdırması ✓ (15d+ qırmızı, 10d+ sarı).

---

## 5. Güclü tərəflər (mühafizə edin)

1. **Biznes dərinliyi:** maliyyə auditing, tenant izolyasiyası, deposit/override axınları, X/Z hesabatları.
2. **Offline-first:** lokal DB + sync qeydləri — Toast/Square səviyyəsində.
3. **Rol əsaslı modul girişi** — hər rol öz ekranını görür.
4. **Glass UI (Phase 1–3)** — PinLogin, Masalar artıq dünya səviyyəsində görünür (bax UI_AUDIT_GLASS.md).
5. **i18n (az/ru/en)**.

---

## 6. Prioritetli Aksiya Planı

| # | Prioritet | Dəyişiklik | Təsir | Status |
|---|---|---|---|---|
| 1 | 🔴 Yüksək | DashboardPanel-dən `recharts`-i ayrıca lazy chunk-a ayır (400KB→~120KB) | Sürət | ✅ **Hazır (2026-08-12)** — 398KB→34KB shell, recharts ayrıca 374KB lazy chunk (Suspense + skeleton, yalnız məlumat hazır olanda yüklənir) |
| 2 | 🔴 Yüksək | POS-a **sol kateqoriya rail** + böyük ürün kartları (≥90px touch target) | Funksional + estetik | ⏳ |
| 3 | 🟠 Orta | **Semantik rəng sistemi** — 1 palitra, eyni status rəngləri hər yerdə | Estetik | ✅ **Hazır (2026-08-12)** — tək palitra: Boş=emerald, Rezerv=amber, Dolu=rose, Aktiv=violet, Təmizlik=slate. `floorUtils.ts`-də ortaq `TABLE_STATUS_THEME` + `TABLE_STATUS_LABELS` (FloorView legend/xəritə + TableGrid kartları ortaq mənbədən oxuyur). Tutarsızlıqlar düzəldildi: SEATED sky→rose (map), ACTIVE_CHECK legend rose→violet, legend-ə SEATED əlavə olundu, TableGrid label-ları vahidləşdi. **KDS order statusları da vahidləşdi:** `tableUtils.ts`-də `ORDER_STATUS_THEME` (NEW/SENT=blue, PREPARING/REMAKE/CORRECTION=orange, READY=emerald, VOID_REQUESTED=yellow, VOIDED=rose, COMPED=sky, WASTE=slate, SERVED=violet) — KDS `getStatusColor`/`getStatusBadge`/`kitchenItemTone`, TablesPage və SentItemsSlideUp dot-ları ortaq mənbədən oxuyur. KDS yaşlanma eskalasiyası (>10d sarı, >15d qırmızı) qəsdən saxlanıldı |
| 4 | 🟠 Orta | POS klaviatura qısa yolları + fuzzy axtarış | Funksional | ⏳ |
| 5 | 🟠 Orta | Dashboard skeleton-ları + KPI prioritizasiyası | Sürət + estetik | ⏳ |
| 6 | 🟡 Aşağı | Real floor map (plan şəkli üzərində masalar) | Funksional | ⏳ |
| 7 | 🟡 Aşağı | Şəkil optimallaşdırma (webp + srcset) | Sürət | ⏳ |
| 8 | 🟡 Aşağı | Tək tip skala + boş state bələdçiləri | Estetik | ⏳ |

---

## 7. Double-Check Siyahısı (hər implementasiyadan sonra)

- [ ] `npx tsc --noEmit` — yeni xəta yoxdur (mövcud 23 xəta tanınmış texniki borcdur)
- [ ] `npm run build` — keçir; chunk ölçüləri ölçülür (`ls -la dist/assets/*.js`)
- [ ] Default rejimdə görünüş dəyişməyib (opt-in qaydası: yalnız `data-ui-mode='new'` / tenant ayarı)
- [ ] Giriş → POS → Satış → Çap → Z-hesabat axını sınanıb
- [ ] Light-temada kontrast qorunur
- [ ] Yalnız UI dəyişiklikləri — biznes məntiqi (satış, maliyyə, inventar) toxunulmayıb

---

## 8. Əlaqəli Sənədlər

- `docs/UI_AUDIT_GLASS.md` (+ EN) — macOS glass dizayn sistemi və tətbiq qaydaları
- `docs/UI_COMPETITIVE_AUDIT_EN.md` — bu sənədin ingiliscə versiyası
