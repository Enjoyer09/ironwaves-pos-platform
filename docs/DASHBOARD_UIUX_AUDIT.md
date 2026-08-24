# Merchant Dashboard — UI/UX Audit (vizual qarışıqlıq və estetika)

**Tarix:** 2026-08-24
**Fokus:** İstifadəçi "dashboard ümumən qarışıq, estetik olaraq yorucu və çətindir" dedi. Bu audit
kod səviyyəsində (DashboardPanel.tsx) nəyin düzgün, nəyin yorucu olduğunu əsaslandırır və yenidənqurma
planı verir. Əvvəlki `DASHBOARD_AUDIT.md` "faydalılıq boşluqları"na baxırdı; bu sənəd isə **vizual
iq və estetikaya** yönəlmişdir.

---

## 1. Mənim fikrim (qısa)

İstifadəçi haqlıdır. Dashboard hal-hazırda **"hər şey bir ekranda" (kitchen-sink)** yanaşması ilə
qurulub: 10 KPI kartı + ayrı bir tam Analitika mərkəzi + 8 panel + 2 ayrı AI bölməsi + xəbərdarlıq
zolağı hamısı eyni scroll-da, eyni vizual çəki ilə düzülüb. Gözün "haraya baxım" deyən bir mərkəzi
yoxdur. Rəng palitrası 9+ aksent rəngindən ibarətdir (fuchsia, cyan, rose, emerald, amber, sky,
violet, orange, yellow) — bu "canlı" deyil, "söhbət küyü" yaradır. Nəticə: estetik olaraq yorucu və
operator üçün qərar vermək çətin.

**Yaxşı xəbər:** Məlumatların ÖZÜ dəyərlidir (satış, əmək, top müştəri, heyət). Problem məlumat deyil,
**təqdimat və ierarxiyadır**. Onu "Overview (1 ekran) + tablar" modelinə salmaqla böyük bir təkmilləşmə
əldə edərik, yeni məlumat əlavə etmədən.

---

## 2. Cari struktur xəritəsi (yuxarıdan aşağı, kod xətləri ilə)

| # | Blok | Fayl xətti | Nədir |
|---|------|-----------|-------|
| 1 | **AlertBar** (yapışqan) | 560–567, 912–943 | Kritik xəbərdarlıq zolağı (boşdursa emerald, varsa rose) |
| 2 | **Hero "Live command center"** | 570–604 | Böyük başlıq + alt-başlıq + tarix aralığı + CSV düyməsi, ağır kölgə |
| 3 | **KPISection** | 606–633 (kartlar 1119–1153) | **10 KPI kartı** bir zolaqda (2xl-də 10 sütun): revenue(+delta+goal ring), cash, card, expenses, net profit, active tables, open checks, avg ticket, kitchen load, cash gap, COGS, gross margin |
| 4 | **AIManagerStrip** (cyan) | 635–639, 846–910 | AI menecer tövsiyələri, 4 sütun kart grid-i |
| 5 | **AnalyticsCenter** (lazy) | 641–654 | **Ayrı bir tam analitika modulu** — özündə 4 böyük panel (2xl:grid-cols-4, h-[300px]) |
| 6 | **Main 2-column grid** | 656–731 | |
| 6a | — Live Sales (feed) | 658–665 | Son 8 satış |
| 6b | — Top məhsullar + Open checks | 667–680 | 2 sütun |
| 6c | — Saatlıq satış bölgüsü | 683–699 | 24 bar |
| 6d | — Əmək haqqı vs Satış | 702–704 | (yeni əlavə olunan) |
| 6e | — ControlPanel (maliyyə) | 708–713 | Balans + anomaliyalar |
| 6f | — Heyət performansı | 715–717 | |
| 6g | — Top müştərilər | 720–722 | (yeni əlavə olunan) |
| 6h | — Xəbərdarlıq bölgüsü | 724–729 | |
| 7 | **BackgroundAgentStrip** (fuchsia) | 733–739, 756–844 | İkinci AI bölməsi (genişlənə bilən) |

**Cəmi:** 1 alert bar + 1 hero + 10 KPI + 1 AI strip + 1 tam analitika mərkəzi + 8 panel + 1 AI agent
strip = **3–4 tam viewport** həcmində, heterojen məzmun.

---

## 3. Əsas problemlər

### A. Məlumat həcmi / ierarxiya yoxdur
- 10 KPI kartı + ayrı AnalyticsCenter + 8 panel → göz "haraya baxım" bilmir. Hamısı "vacib".
- Eyni metrik formalar bir neçə yerdə təkrar olunur: **revenue** (KPI + AnalyticsCenter + Labor
  kartında istifadə olunur), **avg ticket** (KPI + Top products), **COGS** (KPI + AnalyticsCenter),
  **open checks** (KPI + ayrı panel). Təkrar metriklər yorğunluq yaradır.
- Proqressiv açılım (progressive disclosure) yoxdur: kəşfiyyat məlumatı (saatlıq, top məhsul, heyət,
  top müştəri, alerts breakdown) ilə komanda məlumatı (alert bar, canlı satış) eyni səviyyədə.

### B. Rəng və ton qarışıqlığı
- İstifadə olunan aksent rəngləri: `yellow-300` (hero), `emerald`, `rose`, `fuchsia` (AI agent),
  `cyan` (AI menecer), `amber`, `sky`, `violet`, `slate`, `orange` (brand). **9+ rəng**.
- Hər panel fərqli border/glow resepti ilə işıq saçır → "sakit" deyil, "qarışıq" oxunur.
- Brend narıncı (#FF8B26/#F48C24) fuchsia/cyan panelərə rəqabət edir, brend identikliyini zəiflədir.

### C. Ağır vizual tretman
- Təkrarlanan `shadow-[0_24px_80px_rgba(0,0,0,0.28)]` nəhəng düşmə kölgələri hər paneldə → "void
  üzərində üzən kartlar" effekti = vizual ağırlıq.
- `rounded-[28px]` hər yerdə, yapışqan barında `backdrop-blur-xl`.
- **DashboardLayout** (744–753) arxada `web-aurora-subtle` + `web-noise-overlay` saxlayır. Sıx
  məlumat ekranının arxasında hərəkətli aurora = diqqət ayıran. (Customer app-də bu blur-u performans
  üçün silmişdik; admin paneldə hələ qalır.)

### D. Ardıcıl olmayan kart sistemləri
- Ən azı 4 fərqli "kart" implementasiyası var: `PanelCard` (standart), `KpiCard`, `ControlPanel`
  (xüsusi), `AIManagerStrip`/`BackgroundAgentStrip` (xüsusi bölmələr), `AlertBar` (xüsusi).
- `PanelCard` təmiz sistemdir, amma çox bölmə onu keçib fərdi stilləşmə edir → vizual ardıcıllıq pozulur.

### E. Sıxlıq və uzun scroll
- Standart noutbukda istifadəçi bunları scroll edir: alert bar → hero → 10 KPI → AI menecer → tam
  AnalyticsCenter (4 böyük kart) → 8 panel. "Bir baxışda xülasə" ekranı yoxdur.
- Sahib üçün əsas sual: "İndi pul qazanıram? Hər hansı yanğın varmı?" → bu, alert bar + 4–6 KPI + canlı
  satışdır. Qalan hamısı ikinci dərəcəlidir və tablarda/molrada olmalıdır.

### F. Ad/qarışıqlıq (Information Architecture)
- "Live command center" hero başlığı sual şəklindədir ("What is happening right now?") amma dekorativdir;
  əsl komanda məlumatı aşağıdakı KPI zolağındadır. İki "giriş" mətni (hero + alert bar) rəqabət edir.
- Ad toqquşmaları: "Open checks" (KPI) vs "Open checks" paneli; "Top məhsullar" (AnalyticsCenter? +
  sol panel); "Live Sales" feed vs KPI "sales". Haranın nə olduğu qarışıq.
- `AIManagerStrip` (cyan) və `BackgroundAgentStrip` (fuchsia) — iki ayrı AI səth; hansı nə edir, qarışıq.

### G. Oxunaqlılıq / kontrast
- Çoxlu `text-[10px]`/`text-[11px]` mikro etiket (saatlıq barlar, KPI köməkçiləri, tip balonları).
  Tünd slate-950 fonunda slate-500 mətn = aşağı kontrast → oxumaq yorucu (istifadəçi "yorucu" dedi).
- Böyük kölgə + tünd fon → panellar arasında ayrı-seçkilik aşağı; göz daha çox işləyir.
- Çoxlu `tracking-[0.24em]` uppercase mikro-başlıqlar fərqli rənglərdə = dekorativ küy.

### H. Proqressiv açılım / rejim yoxdur
- Merchant dashboard "Overview" (1 ekran: alert + 4–6 hero KPI + canlı satış + 1–2 əməliyyat) +
  ikinci dərəcəli tablar (Analitika, Əmək, Müştərilər, Heyət) olmalıdır. Hal-hazırda hər şey xətti
  düzülüb.

---

## 4. Prioritizasiya

### P0 — İerarxiya və sıxlıq (ən böyük təsir)
- AnalyticsCenter-i əsas axından ÇIXAR və onu "Analitika" tabına daşı (və ya "Ətraflı" düyməsi ilə
  açılan modal). Bu tək addım ekranı 1/3 azaldar.
- KPI zolağını 10-dan **4–6 əsas**ə endir (revenue+delta, net profit, open checks, kitchen load və ya
  cash gap). Qalanlarını "Ətraflı KPI" altına yığ.
- İki AI bölməsini (cyan + fuchsia) **birə** birləşdir və ya "AI" tabına daşı.

### P1 — Vizual sistem
- Rəng palitrasını məhdudlaşdır: **1 brend rəngi (narıncı) + 1 uğur (emerald) + 1 risk (rose/amber)
  + neytral (slate)**. AI üçün tək rəng (məs. indigo/violet) təyin et, fuchsia/cyan-ı sil.
- Bütün panel üçün **tək kölgə** resepti (kiçik: `shadow-lg` səviyyəsi) və ya kölgəsiz, incə border.
- `DashboardLayout` arxasındakı **aurora + noise**u admin dashboard-dan sil (və ya çox zəiflət).
- Kart sistemini unifikasiya et: hamı `PanelCard` istifadə etsin; xüsusi bölmələri ona uyğunlaşdır.

### P2 — Oxunaqlılıq və detallar
- Mikro etiketləri `text-xs`/13px-ə böyüt, kontrastı artır (slate-400→slate-300).
- Panellar arası boşluğu (space-y) və daxili padding-i uyğunlaşdır.
- "Overview / Analytics / Labor / Customers / Staff" sol nav və ya yuxarı tablara böl.

---

## 5. Təklif olunan yenidənqurma (konkret)

**Ekran 1 — Overview (1 viewport):** yapışqan AlertBar → kiçik hero (ad + tarix aralığı + CSV) →
6 KPI grid → Live Sales feed + ControlPanel yan-yana → "Ətraflı" düymələri ilə AnalyticsCenter/AI
modal-a açılır.

**Ekran 2+ — Tablar:** Analitika (eski AnalyticsCenter), Əmək (labor vs sales + wages), Müştərilər
(top + segmentlər), Heyət (performance + shifts). Hər tab özü bir təmiz ekran.

**Palitra:** narıncı (əməliyyat/brand), emerald (müsbət), rose/amber (risk), slate (neytral),
violet/indigo (yalnız AI). Başqa rəng yox.

**Kölgə:** tək `shadow-[0_8px_24px_rgba(0,0,0,0.18)]` və ya yalnız incə border; aurora/noise sil.

---

## 6. Növbəti addım
İstəsən, P0-ları (AnalyticsCenter-i axından çıxar + KPI-ni 6-ya endir + AI bölmələrini birləşdir)
kodla edib, sonra P1 vizual sistemi tətbiq edə bilərik. Təsdiq ver, başlayaq.
