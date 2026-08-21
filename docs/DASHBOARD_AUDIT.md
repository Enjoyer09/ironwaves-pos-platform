# Dashboard Audit — Müştəri Loyalty + Menecer Paneli

**Tarix:** 2026-08-21
**Məqsəd:** İstifadəçilərin "dashboard faydasızdır, qlobal brend proqramları daha yaxşı UI/UX verir" şikayətinə cavab olaraq — hansı funksiyalarda geridə qaldığımızı müəyyən etmək.
**Əsas:** `src/components/customer/HomeTab.tsx`, `src/components/customer/ProfileTab.tsx`, `src/components/admin/DashboardPanel.tsx` kodunun birbaşa oxunması + Starbucks/Costa/Pret (müştəri) və Square/Toast (menecer) ilə müqayisə.

---

## 1. Müştəri Loyalty Dashboard (Home + Profile)

### Hal-hazırda nə var (koddan təsdiqlənib)
- Rəqəmsal üzvlük kartı: 10-luq damğa gridi, ulduz balansı, tier, növbəti səviyyə progress barı.
- Wallet: cashback faizi, bal etiketi.
- Tier sistemi: `next_threshold` + `progress_pct` (progress var).
- Mükafatlar: aktivləşdirilmiş rewards / tələb.
- Profil: ad, doğum tarixi, endirim %, kart növü, qoşulma tarixi, kart ID.
- Bildirişlər, alış dinamikası qrafiki (SimpleAreaChart), sifariş tarixçəsi.
- Dil seçimi (AZ/RU/EN), kart arxasında QR.
- Wallet pass URL (Apple/Google Wallet açmaq imkanı var).

### Qlobal brendlərdə (Starbucks Rewards, Costa Club, Pret) nə var ki, bizdə zəif/və yoxdur
| Funksiya | Bizdə | Starbucks/Costa | Boşluq |
|---|---|---|---|
| "Növbəti pulsuz içkiyə" aydın yaxınlıq | Tier progress var, amma "2 ulduz → pulsuz latte" deyil | "X stars to a free drink" | Konkret mükafat yaxınlığı yox |
| Doğum günü mükafatı | Doğum tarixi yığılır, amma surfaca çıxarılmır | Pulsuz içki doğum günü | Surfacelənməyib |
| Şəxsi təkliflər (personalization) | Offers ümumi | Süni təkliflər | Personalizasiya yox |
| Oyunlaşdırma (scratch/spin) | Yox | "Starbucks for Life" oyunları | Tam yox |
| Bir toxunuşla Wallet əlavəsi | Pass URL var, amma prominent deyil | Add to Apple/Google Wallet düyməsi | Bir toxunuş yox |
| Sürpriz və sevindirmə | Yox | Random freebie | Yox |
| Aydın "indi nə edə bilərsən?" | Yox | Həmişə bir CTA | Next-action zəif |
| Favorites/son sifarişi təkrar et | variable var, amma ana ekrana zəif | "Order again" kəskin | Çıxarış zəif |
| AI barista tövsiyəsi ana ekrana | Yalnız AI tabında | — | Əlaqə yox |

### Nəticə (müştəri): biz nə ilə geridəyik?
1. **Mükafatın aydınlığı** — istifadəçi "mən nəyə görə ulduz yığırım?"i görmür.
2. **Doğum günü + sürpriz mükafat** tamamilə susub.
3. **Personalizasiya və oyunlaşdırma** yox (qlobal brendlərin əsas engagement mənbəyi).
4. **Wallet-ə bir toxunuşla əlavə** yox.
5. **Ana ekran "indi nə etməliyəm"** yönləndirməsi zəif.

---

## 2. Menecer Dashboard (DashboardPanel.tsx)

### Hal-hazırda nə var (koddan təsdiqlənib)
- Kritik xəbərdarlıq zolağı (hərəkət + dismiss — çox güclü).
- 10 KPI: bu gün satış, gündəlik xərclər, xalis mənfəət, aktiv masalar, açıq hesablar, orta çek, mətbəx yüklənməsi, kassa fərqi, COGS, ümumi marja.
- Canlı idarəetmə mərkəzi (satış, masa, mətbəx, kassa bir ekranda).
- Canlı satış axını (real-time).
- Top məhsullar, heyət performansı, xəbərdarlıqların bölgüsü + maliyyə auditi.
- Insights (oxunmamış), tarix aralığı filteri (`activeRange`), lazy recharts, avto-yeniləmə.

### Qlobal brendlərdə (Square, Toast, Lightspeed) nə var ki, bizdə yoxdur
| Funksiya | Bizdə | Square/Toast | Boşluq |
|---|---|---|---|
| Keçən dövrə müqayisə (% delta) | Tarix aralığı var, delta yox | "vs last week +12%" | Müqayisə yox |
| Gündəlik satış hədəfi / progress ring | Yox | Goal ring | Hədəf yox |
| Proqnozlaşdırma | Insights var, proqnoz yox | Sales forecast | Yox |
| Export (CSV/PDF) | Görünmür | Export | Yox |
| KPI → dərindən baxış (drill-down) | Analyticsə keçir (səthi) | Detailed drill | Səthi |
| Əmək haqqı xərci vs satış | Yox | Labor vs sales | Yox |
| Top müştərilər / müştəri analitikası | Yox | Customer analytics | Yox |
| Widget yerləşməsini fərdiləşdirmə | Yox | Customizable | Yox |
| Mobil-optimallaşdırılmış dashboard | Desktop grid | Mobile view | Zəif |
| Qrafiklərdə qeyd/annotation | Yox | Annotations | Yox |

### Nəticə (menecer): biz nə ilə geridəyik?
1. **Keçən dövrə müqayisə və trend delta** yox — rəqəmlər "bu gün nəticə" verir, amma "yaxşıyamız pisik?" sualını cavabsız qoyur.
2. **Hədəf/progress ring** yox — motivasiya və günü idarə etmək üçün bələdçi yox.
3. **Export və drill-down** zəif — menecer rəqəmləri başqa yerə apara bilmir, detala enə bilmir.
4. **Əmək + müştəri analitikası** yox — ən vacib biznes sualları cavabsız.
5. **Mobil dashboard** zəif — sahib telefonla baxanda sıx və ağır.

---

## 3. Ümumi: biz nə ilə geridəyik? (prioritized)

**P0 — ən böyük boşluqlar**
- Müştəri: "Növbəti mükafata neçə addım" aydınlığı + doğum günü/sürpriz mükafat + bir toxunuşla Wallet.
- Menecer: KPI-lərdə "keçən həftəyə ±%" delta + gündəlik satış hədəfi ringi.

**P1 — təcrübə fərqi**
- Müştəri: personalizasiya (AI barista tövsiyəsi ana ekrana), oyunlaşdırma, favorites "order again" kəskinliyi.
- Menecer: export (CSV/PDF), KPI drill-down, əmək vs satış, top müştərilər.

**P2 — cilasızlıq**
- Müştəri: "indi nə etməliyəm" yönləndirməsi, daha az sıx layout.
- Menecer: widget fərdiləşdirmə, mobil-optimallaşdırma, qrafik annotation.

---

## 4. Tövsiyə — haradan başlamalı (quick wins)
1. **Müştəri ana ekranına** "Sənin üçün: 2 ulduz → pulsuz Latte" pilli + doğum günü yaxınlaşanda "Pulsuz içki" kartı.
2. **Wallet düyməsini** profildən çıxarıb hər ekranın yuxarısına bir toxunuşlu "Wallet-ə əlavə et" et.
3. **Menecer KPI kartlarına** kiçik "▲12% vs ötən həftə" delta qeydini əlavə et (mövcud `activeRange` ilə hesablanır).
4. **Gündəlik satış hədəfi** parametri əlavə et və KPI yanında progress ring göstər.

Bu 4 addım kodda mövcud məlumatlarla (ulduz, tier, satış tarixçəsi, activeRange) həll olunur və "faydasız" hissini ən çox azaldan yerlərdir.
