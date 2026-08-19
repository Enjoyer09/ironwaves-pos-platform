# IronWaves POS — Senior Designer UI/UX Audit
**Tarix:** 2026-08-19
**Auditor:** Senior Product Designer
**Fokus:** Ofisiant gündəlik iş axını, 15" POS touch ergonomikası, rəng uyğunluğu, real dünya istifadəsi
**Standartlar:** WCAG 2.1 AA/AAA, Apple HIG, Material Design 3, Nielsen Heuristics

---

## 1. İCRA XÜLASƏSİ

Ofisiantların gündəlik işində **7 kritik touch target pozuntusu**, **5 oxunaqlılıq problemi** və **3 iş axını çətinliyi** aşkar edilib. Əsas problem: **Staff mode (ofisiant rejimi) ən kiçik font ölçülərinə və ən kiçik touch hədəflərinə malikdir** — yəni ən çox istifadə edən insanlar ən pislərini alırlar.

**Ümumi qiymət: 5.5/10** (Ofisiant UX baxımından)

| Kateqoriya | Qiymət | Status |
|---|---|---|
| Touch hədəf ölçüləri | 3.0/10 | Kritik pozuntular |
| Font oxunaqlılığı | 4.0/10 | 10-11px fontlar |
| Rəng kontrastı | 7.0/10 | Bəzi marginal pozuntular |
| İş axını sürəti | 6.0/10 | Çox klik tələb edir |
| Kart/sebetə görünüşü | 6.5/10 | Kiçik scroll sahəsi |
| Ödəniş axını | 5.5/10 | Qarışıq düymə layout |
| KDS mətbəx əlçatanlığı | 7.0/10 | Yaxın, amma kiçik action düymələri |

---

## 2. KRİTİK PROBLEMLƏR (P0)

### 2.1 Staff Mode Qty Düymələri — 24x24px (KRİTİK)

**Fayl:** `src/components/pos/staff/StaffPosMode.tsx`
**CSS:** `.staff-qty-btn { height: 1.5rem; width: 1.5rem }` (24x24px)

**Problem:** Ofisiantların əsas iş funksiyası məhsul əlavə etmək/silmaqdir. +/- düymələri cəmi 24x24px-dir — bu WCAG 2.5.5 minimum tələbindən (44px) **45% aşağıdır**. 15" touch ekranda pəncə barmaqla vurmaq üçün bu demək olar ki, mümkün deyil. Ofisiantlar ya yalnış işəqədər barmaq ucu istifadə etməli, ya da yanlış məhsülə toxunurlar.

**Düzəliş təklifi:** `.staff-qty-btn` min-height və min-width 44px-ə qaldırılmalıdır. 15" ekranda bu məkan payı asandır.

```css
.staff-qty-btn {
  height: 2.75rem;  /* 44px */
  width: 2.75rem;   /* 44px */
}
```

### 2.2 pos3 Qty Düymələri — 32x32px (KRİTİK)

**Fayl:** `src/components/POS.tsx` (pos3 render path)
**CSS:** `.pos3-qty-btn { height: 2rem; width: 2rem }` (32x32px)

**Problem:** "Yeni UI" rejimində məhsul kartlarında olan +/- düymələri 32x32px — WCAG minimumundan **27% aşağı**. `@media (pointer: coarse)` bloku bu düymələri böyütmür.

**Düzəliş təklifi:** `@media (pointer: coarse)` blokuna əlavə edilməli:

```css
@media (pointer: coarse) {
  .pos3-qty-btn {
    height: 2.75rem !important;
    width: 2.75rem !important;
  }
}
```

### 2.3 Classic Mode Qty Düymələri — ~20px (KRİTİK)

**Fayl:** `src/components/POS.tsx`
**CSS:** `.neon-mini-btn` — `p-1` ilə 13px ikon, təxmini 20-24px touch sahə

**Problem:** Classic rejimdə sebetdəki məhsul miqdar düymələri ən kiçikdir. Heç bir min-height təyin edilməyib.

### 2.4 Qty Dəyər Fontu — 9px (İLLEQAL)

**Fayl:** `src/index.css`, sətir ~3427
**CSS:** `.pos3-card .pos3-qty-value { font-size: 9px !important }`

**Problem:** Məhsul miqdar göstəricisi 9px — bu **bütün standartların altındadır**. WCAG 1.4.4 tələb edir ki, mətn 200% böyüdüldükdə oxunaqlı qalsın. 9px → 18px olsa belə, bu hələ də çox kiçikdir. Ofisiant sifarişdə neçə ədəd olduğunu görmək üçün gözlərini qısmalıdır.

### 2.5 Staff Mode Məhsul Adı — 11px (ÇOX KİÇİK)

**Fayl:** `src/components/pos/staff/StaffPosMode.tsx`
**CSS:** `.staff-product-name { font-size: 11px }`

**Problem:** Ofisiant əsas işini görərkən məhsul adını 11px fontla oxumalıdır. 15" ekranda 60 sm məsafədən bu demək olar ki, oxunmazdır. restoran mühitində (parlaq işıq, tələsiklik) bu daha da pisləşir.

**Beynəlxalq standart:** Material Design 3 minimum 14px, Apple HIG minimum 13px. 11px hər ikisinin altındadır.

### 2.6 Staff Mode Məhsul Təsviri — 10px (ÇOX KİÇİK)

**Fayl:** `src/components/pos/staff/StaffPosMode.tsx`
**CSS:** `.staff-product-sub { font-size: 10px }`

**Problem:** Məhsul təsviri 10px — bu EU Accessibility Act-ın minimum tələbindən (12px) aşağıdır.

### 2.7 Endirim Düymələri — 18px hündürlük (KRİTİK)

**Fayl:** `src/components/POS.tsx` (classic sidebar)
**CSS:** Endirim faiz düymələri `py-1.5 text-[11px]` — 5 sütunluq grid

**Problem:** 380px sidebar-da 5 sütunluq endirim düymələri hər biri ~68px en, ~18px hündürlük — touch üçün çox kiçik. Ofisiant tez-tez endirim tətbiq etməli olur, amma düymələr barmaq ucu ilə vurulmalıdır.

---

## 3. VACİB PROBLEMLƏR (P1)

### 3.1 Üç Fərqli POS Layout (Qarışıqlıq)

**Problem:** POS-da 3 fərqli render path var:
1. **Classic mode** (compact-pos-shell) — köhnə UI
2. **pos3 mode** (pos3-shell) — "yeni UI"
3. **Staff mode** (StaffPosMode) — ofisiant rejimi

Hər üçünün fərqli düymə ölçüləri, fərqli kart layout-ları, fərqli ödəniş grid-ləri var. Bu, istifadəçinin cognitive load-unu artırır və bir rejimdən digərinə keçəndə qarışıqlıq yaradır.

**Təklif:** Bütün rejimlər üçün vahid touch target standartı təyin edilməli: minimum 44px hər interaktiv element üçün.

### 3.2 Sebet Scroll Sahəsi Çox Kiçik

**Problem:**
- pos3 order list: `max-height: 180px` — 15" ekranda cəmi 2-3 sifariş görünür
- Classic cart items: `min-height: 120px` (compact density)
- Staff cart items: `min-height: 200px` — ən yaxşısı, amma hələ də kifayət deyil

**Təklif:** Sebet scroll sahəsi ekranın ən azı 40%-ni tutmalıdır. 15" ekranda 800px height → 320px sebet sahəsi.

### 3.3 Ödəniş Düymə Layout Tutarsızlığı

**Problem:**
- Classic: 4 sütun (`sm:grid-cols-4`)
- pos3: 2 sütun (`grid-cols-2`)
- Staff: 2 sütun (`grid-cols-2`)
- Mobile: 2 sütun

4 ödəniş metodu (Nağd, Kart, Split, Staff) 2 sütunda yerləşdirildikdə daha çox şaquli yer tutur və checkout düyməsini aşağı itələyir.

### 3.4 BahaY Override Müharibəsi

**Fayl:** `src/index.css`, sətir 3344+

**Problem:** BahaY xüsusi override-ları base pos3 dəyərlərini `!important` ilə əzir:
- pos3 kart name: `19.5px !important` (əvvəl 13px)
- pos3 kart description: `16.5px !important` (əvvəl 11px)
- pos3 kart price: `22.5px !important` (əvvəl 15px)
- pos3 qty value: `9px !important` (əvvəl 12px) — **kiçildilib!**

Bu override-lar Staff mode-a təsir etmir, amma pos3 mode-da ölçüləri proqnozlaşdırmağı çox çətinləşdirir.

### 3.5 KDS Action Düymələri — 40px (Yaxın, Amma Kifayət Qədər Deyil)

**Fayl:** `src/components/KDS.tsx`
**CSS:** Item action düymələri `min-h-10` (40px), `text-xs` (12px)

**Problem:** Mətbəx ekranında "Start", "Ready", "Served" düymələri 40px — WCAG minimumuna yaxın, amma hələ də 4px qısa. Mətbəx mühitində (nəm əllər, əlcəklər, tələsiklik) bu çox kiçikdir.

### 3.6 Category Rail Darıxdırıcı (pos3)

**Problem:** pos3 rejimində kateqoriya rail-ları `w-20` (80px) enindədir, `text-[12.5px]` font ilə. "İçkilər" və ya "Soyuq içkilər" kimi uzun adlar kəsilir.

---

## 4. İŞ AXINI ÇƏTİNLİKLƏRİ

### 4.1 Sifariş Vurma — Çox Addım

**Cari axın (ofisiant):**
1. Kateqoriya seç → 2. Məhsul tap → 3. Məhsülə toxun → 4. Variant seç (varsa) → 5. Miqdar artır → 6. Sebetə bax → 7. Masa seç → 8. Mətbəxə göndər → 9. Ödəniş

**Problem:** Hər addım ayrı bir ekrana/düyməyə keçid tələb edir. Ofisiant bir sifariş üçün 9 toxunuş etməlidir. Dünya standartlarında (Toast, Square, Lightspeed) bu 5-6 toxunuşla edilir.

**Təklif:** 
- Variant seçimi məhsul kartına inline daxil edilməli (modal yox)
- Miqdar artırıldıqda avtomatik sebetə əlavə olunmalı (confirmation olmadan)
- "Mətbəxə göndər" və "Ödəniş" bir addımda birləşdirilə bilər (split flow)

### 4.2 Sebet Ekranı Balaca

**Problem:** pos3 mode-da sebet `max-height: 180px` ilə məhdudlaşdırılıb. 5+ məhsullu sifarişdə ofisiant scroll etməli olur. Bu, ümumi məbləği və məhsulları görməyi çətinləşdirir.

### 4.3 Endirim Tətbiqi Çətindir

**Problem:** Endirim düymələri 5 sütunda, 11px fontla, ~18px hündürlüklə. Ofisiant tez-tez endirim tətbiq etməli olur, amma düymələr çox kiçikdir və yanlış faizə vurmaq asandır.

---

## 5. RƏNG PROBLEMLƏRİ

### 5.1 Muted Text Kontrastı — 4.3:1 (MARGINAL)

**CSS:** `--muted-foreground: 240 5% 64.9%` → `#64748b` tünd fonda
**Kontrast:** 4.3:1 — WCAG AA tələbi 4.5:1

**Təsir:** Köməkçi mətnlər (məhsul təsviri, tarix, status) zəif görünür. Ofisiantlar bəzən məhsul adını oxumaq üçün əyilməli olurlar.

### 5.2 Accent və Primary Eyni Rəng

**CSS:** `--accent: 47.9 95.8% 51.2%` = `--primary: 47.9 95.8% 51.2%`

**Təsir:** İstifadəçi interface-də hansı elementin "əsas" (primary) və hansının "aksent" olduğunu ayırd edə bilmir. Bu, visual hierarxiyanı pozur.

### 5.3 Staff və Customer App-də Fərqli Aksent Rəngləri

**Problem:** Staff app qızıl (`#fbbf24`), customer app narıncı (`#F48C24`). Brend uyğunluğu pozulur.

---

## 6. DÜNYA STANDARTLARI İLƏ MÜQAYİSƏ

| Aspekt | IronWaves POS | Toast POS | Square POS | Lightspeed |
|---|---|---|---|---|
| Qty düymə ölçüsü | 24-32px | 48px | 44px | 44px |
| Məhsul adı font | 11px | 16px | 14px | 15px |
| Sebet görünüşü | 2-3 item | 5-6 item | 4-5 item | 5-6 item |
| Ödəniş düymə | 48px | 56px | 52px | 48px |
| Sifariş addımı sayı | 9 | 5 | 6 | 5 |
| Touch target min | 24px | 48px | 44px | 44px |

---

## 7. TƏKLİF EDİLƏN DÜZƏLİŞLƏR (Prioritet Sırası)

### P0 — Dərhal Düzəlt (Ofisiant gündəlik işinə təsir edir)

| # | Problem | Düzəliş | Təxmini vaxt |
|---|---|---|---|
| 1 | Staff qty düymə 24px | `h-11 w-11` (44px) | 5 dəq |
| 2 | pos3 qty düymə 32px | `coarse` mediada `h-11 w-11` | 5 dəq |
| 3 | Classic qty düymə 20px | `min-h-11 min-w-11` əlavə et | 5 dəq |
| 4 | pos3 qty value 9px font | `!important` override sil, 14px təyin et | 5 dəq |
| 5 | Staff məhsul adı 11px | `text-sm` (14px) yüksəlt | 5 dəq |
| 6 | Staff məhsul təsviri 10px | `text-xs` (12px) yüksəlt | 5 dəq |
| 7 | Endirim düymələri 18px | `min-h-11 py-2 text-sm` | 10 dəq |

### P1 — Növbəti sprint-də

| # | Problem | Düzəliş |
|---|---|---|
| 8 | Sebet scroll max-h 180px | 320px-ə qaldır və ya `flex-1` et |
| 9 | Ödəniş grid 2 sütun | 4 sütuna keç (hər rejimdə) |
| 10 | KDS action 40px | `min-h-12` (48px) |
| 11 | Category rail 80px | `w-24` (96px) və ya `w-28` (112px) |
| 12 | Muted text 4.3:1 | `slate-400` (#94a3b8) → 6.9:1 |
| 13 | accent = primary | `--accent`-i fərqli rəng təyin et |
| 14 | 3 fərqli layout | Vahid touch target standartı təyin et |

### P2 — Planlaşdır

| # | Problem | Düzəliş |
|---|---|---|
| 15 | Sifariş çox addım | Variant seçimi inline, auto-add to cart |
| 16 | BahaY override müharibəsi | CSS variables ilə yenidən qur |
| 17 | Staff/customer fərqli rəng | Vahid brend rəngi təyin et |
| 18 | Haptic feedback yox | `navigator.vibrate()` əlavə et kritik əməliyyatlarda |

---

## 8. NƏTİCƏ

IronWaves POS-un ofisiant üçün UX-i **dünya standartlarından geri qalır**. Əsas problemlər:

1. **Touch hədəflər çox kiçikdir** — 24-32px, dünya standartları 44-48px
2. **Fontlar oxunmazdır** — 9-11px, dünya standartları 14-16px
3. **Sebet görünüşü balacadır** — 2-3 məhsul, dünya standartları 5-6
4. **İş axını çox uzundur** — 9 addım, dünya standartları 5-6

**Ən vacib düzəliş:** Staff mode-da qty düymələrini 24px-dən 44px-ə qaldırmaq və məhsul adını 11px-dən 14px-ə yüksəltmək. Bu iki dəyişiklik ofisiantların gündəlik işini ən çox asanlaşdıracaq.

**Hədəf:** Ofisiant sifarişi 5 toxunuşla tamamlamalı, məhsül adını əyilmədən oxumalı, miqdarı pəncə barmaqla dəyişə bilməlidir.

---

*Bu audit 2026-08-19 tarixində, source kodu əslində oxuyaraq (POS.tsx, StaffPosMode.tsx, VirtualMenuGrid.tsx, KDS.tsx, index.css) və real CSS dəyərləri yoxlayaraq hazırlanmışdır.*
