# Mətbəx Çap Sistemi — Dərindən Audit

**Tarix:** 2026-08-24
**Müəllif:** WorkBuddy AI (kod-səviyyəli audit)
**Əhatə:** ESC/POS builder, QZ Tray, yerli print-agent, KDS, çap trigger axını (POS / TablesPage / KDS)
**Status:** Audit tamamlandı. P1-7, P1-8 ✅ hazır; digər P0/P1 maddələri planlanır (kod hələ yazılmayıb)

---

## 1. Arxitektura xülasəsi

Çap **100% brauzer tərəfindədir**. Backend heç vaxt printerə bayt göndərmir — yalnız `KitchenOrder` sətirlərini yazır və `kitchen.updated` realtime hadisəsi yayır. Brauzer(lər) həmin hadisəyə və ya yerli "göndər" düyməsinə reaksiya verir, HTML və ya ESC/POS baytları qurur və üç nəqliyyatdan birinə ötürür:

1. **Yerli print-agent** (`http://127.0.0.1:17777`) — əsas
2. **QZ Tray** (brauzer əlavəsi / veb-socket) — ehtiyat
3. **Brauzer çap dialoqu** (`iframe.print()`) — son çıxış yolu

Sistemdə **server tərəfli çap yoxdur, növbə (queue) yoxdur, təkrar (retry) yoxdur, idempotensiya (eyni çeki iki dəfə çap etməmək) yoxdur, kateqoriya üzrə yönləndirmə yoxdur.**

Ən ciddi problemlər:
- **P0:** Sifariş "göndər" anında çap edilən mətbəx çekində **modifikatorlar və qeydlər düşür** → yanlış içki/yemək.
- **P0:** Default `raw_escpos` mühərrikində **kiril (rus) mətni qarışır (mojibake)**.
- **P1:** Mətbəx çeki **iki dəfə çap olur** (ofisiant göndərir + KDS avto-çap), və ya agent yavaş olanda agent + QZ eyni çeki basır.
- **P1:** Agent çökərsə / oflayn olanda çek **səssizcə itir** (növbə yoxdur).

---

## 2. Çap data-axını (diaqram)

### Axım A — Ofisiant "Mətbəxə göndər" basır (zal / masa)

```
Ofisiant "Mətbəxə göndər" basır
   │
   ├─1─ send_to_kitchen_live()  ──► Backend: INSERT KitchenOrder (status NEW)
   │                                Backend: _emit_realtime("kitchen.updated") ──► WebSocket
   │
   └─2─ buildKitchenTicketHtml() ──► HTML   (escaped)
       buildKitchenTicketEscPos() ──► ESC/POS baytları (CP437)
                    │
                    ▼
   printDirectOrFallback(html, {printerName, printEngine:'raw_escpos', rawCommands})
                    │
     ┌──────────────┼──────────────────────────────────────────────┐
     ▼              ▼                                                ▼
 [1] Yerli agent  [2] QZ Tray (ehtiyat)                      [3] Brauzer dialoqu
 POST :17777/     qz.websocket → qz.print                    (iframe print())
 print-html       (raw/command və ya pixel/html)             yalnız allowBrowserFallback
     │              │                                          olduqda
     ▼              ▼
 Agent: HTML → Chrome → OS spool → kağız   QZ host → termal printer
                                          (CP437 ⇒ kiril QARIXIR ★)
                                          ★ named printer oflayn ⇒ səssiz yanlış yön
                                          ★ agent >2.5s ⇒ brauzer vaz keçdi ⇒
                                            QZ da çap edir ⇒ TƏKRAR
                                          ★ agent çökdi ⇒ fetch atılır ⇒
                                            retry/növbə yox ⇒ İTİR
```

### Axım B — KDS avto-çap (asılı, paralel)

```
Backend "kitchen.updated" ──► KDS.tsx subscribe (300ms debounce) + 8s poll
        ▼
applyIncomingOrders(): previousOrderIdsRef-də OLMAYAN hər sifariş ──► handlePrintOrderTicket()
        │  (modifiers + notes VAR, amma göndərmə anındakı çekdə YOX)
        ▼
printDirectOrFallback(...)  ──► eyni nəqliyyatlar, eyni kitchen_printer_name
        │
   ★ Ofisiant artıq çap edibsə (Axım A) VƏ KDS avto-çap AÇIQsa ⇒ TƏKRA
   ★ KDS tab yenidən mount olunursa ⇒ previousOrderIdsRef təmizlənir ⇒
     BÜTÜN aktiv sifarişlər yenidən çap olunur
```

---

## 3. Tapıntılar

### P0 — Kritik (normal işdə səhv məhsul / məlumat itkisi)

#### P0-1. Mətbəx çekində modifikatorlar və qeydlər düşür
**Nə baş verir:** Kahve mağazasında modifikator = süd növü, şəkər, sirop. Bu məlumat çekə düşmədikdə mətbəx yanlış içki hazırlayır.
**Texniki:** `buildKitchenTicketEscPos` və `buildKitchenTicketHtml` modifikatorları göstərməyə qadirdir (escpos_builder.ts:232–257), amma **göndərmə anındakı çağırıcılar məlumatı ötürmür**:
- `POS.tsx:1497–1502` — `items` yalnız `item_name, qty, seat_label, cup_mode` (modifiers/notes YOX)
- `TablesPage.tsx:863–869` — `notes` var, `modifiers` YOX
- `TablesPage.tsx:930–935` — `notes` də YOX, `modifiers` də YOX

**Ziddiyyət:** Eyni sifarişin **KDS təkrar-çapı** (`KDS.tsx:92–99`) modifiers + notes göstərir. Yəni eyni çek iki yerdə fərqli məlumatla çap olur.
**Düzəliş:** Bütün göndərmə çağırıcıları `ticketData.items`-ə `modifiers`, `selected_modifiers`, `notes` sahələrini KDS kimi ötürməlidir.

#### P0-2. Kiril (rus) mətni default ESC/POS mühərrikində qarışır
**Nə baş verir:** Tənzimləmələrdə rus dili dəstəklənir, amma məhsul adları/qeydlər kiril olduqda printerdə `?` və ya qarışıq simvollar çıxır.
**Texniki:** `escpos_builder.ts:9–27` `sanitizeEscPosText` yalnız Azərbaycan latın diakritiklərini (Ə/Ğ/İ/Ö/Ş/Ü/Ç) xəritələyir, kiril yox. `escpos_builder.ts:133` kod səhifəsini PC437-yə məcbur edir (`ESC t\x00`), PC857 (türk) heç vaxt seçilmir. PC437 kirili ifadə edə bilməz.
**Düzəliş:** Kiril qabiliyyətli səhifə seç (məs. kod səhifəsi 17/Windows-1251) VƏYA kiril məzmunu avtomatik pixel/HTML mühərrikinə yönləndir VƏYA sanitize ilə transliterasiya et.

---

### P1 — Vacib (etibarlılıq, təkrar-çap, çox-printer)

#### P1-1. Mətbəx çeki iki dəfə çap olur (ofisiant + KDS)
`POS.tsx`/`TablesPage.tsx` göndərmə anında avto-çap edir (default `auto_print_kitchen_ticket = true`); eyni zamanda `KDS.tsx:180–185` avto-çap açıqsa eyni çeki basır. Korrelasiya id (print-once) yoxdur.
**Düzəliş:** `localStorage`/IndexedDB-də `printed_ticket_ids` set-i (tab-lar arası paylaşılan) və ya KDS avto-çapı yeganə mətbəx printerinə çevirib göndərmə-anı avto-çapı onunla söndürmək.

#### P1-2. Agent 2.5s taymaut → QZ ehtiyatı ilə təkrar-çap
`local_print_agent.ts:69` `printViaLocalAgent` 2.5s-də `abort` edir. macOS-da agent Chrome→qlmanage→sips→lp zəncirində 2.5s keçə bilər; brauzer vaz keçib QZ-yə düşür → eyni çek agent + QZ tərəfindən basılır.
**Düzəliş:** Taymautu 8–10s-ə qaldır; agent "qəbul etdi" cavabını uğur say və QZ-ə yalnız agent qəbul etməyibsə düş.

#### P1-3. Çap növbəsi / retry / oflayn yoxdur
`printDirectOrFfallback` uğursuzluqda sadəcə `false` qaytarır. Agent/QZ çökərsə çek qaçır (yalnız əllə təkrar-çap xilas edir).
**Düzəliş:** IndexedDB "outbox" — agent/QZ təsdiq edənədək retry; "təkrar çap" düyməsi.

#### P1-4. macOS agent səhifə ölçüsü səhv (ölü regex)
`receipt_print_css.ts:3` `@page { size: auto; }`. Agentin regex-ləri (`ironwaves-print-agent.js:173–176`) yalnız `size: <w>mm auto` / `size: auto <h>mm` / `size: <w>mm <h>mm` uyğunlaşır; çılpaq `size: auto` heç birinə uyğun gəlmir → əvəzetmə ötürülür → Chrome US Letter/A4 çap edir → macOS-da kəsilmiş / artıq kağız.
**Düzəliş:** CSS-də açıq `@page { size: 58mm <h>mm }` yaz VƏYA agent regex-ini `size: auto` üçün də genişləndir.

#### P1-5. Windows-da printer yönləndirmə yarışı
`ironwaves-print-agent.js:223–228` adlı printer üçün maşının **default printer-i** dəyişir, sonra sabit 9s-dən sonra bərpa edir (321–325). 9s pəncərəsində fərqli printerlərə iki eyni vaxtlı iş bir-birinin default-nu üstə yazır → hər ikisi son təyin olunan printerə düşə bilər. (macOS `lp -d <ad>` istifadə etdiyi üçün təhlükəsiz.)
**Düzəliş:** Global default-u dəyişmək əvəzinə Chrome-a per-job printer ötür, VƏYA spool təsdiqlənəndən sonra bərpa et.

#### P1-6. Kateqoriya üzrə printer yönləndirmə yoxdur
Yalnız bir `kitchen_printer_name` mövcuddur (`SettingsPanel.tsx`). Kahve→bar, yemək→mətbəx ayrıla bilməz.
**Düzəliş:** Kateqoriya/stansiya üzrə printer təyinatı; builder item-ləri kateqoriyaya görə bölüb ayrı çeklər çap etsin.

#### P1-7. `use_qz` tənzimləməsi əsas axında ölür
`printDirectOrFallback` (`local_print_agent.ts:77–122`) heç vaxt `options.useQz` oxumur — agent həmişə ilk sınanır, sonra QZ. Admin paneldə `use_qz=false` etmək POS/Tables axınında heç nə dəyişməz (yalnız AdminPanel hörmət edir).
**Düzəliş:** `printDirectOrFallback` `useQz`-i hörmət etsin (false olanda QZ budağını keç), yaxud tənzimləməni sil. ✅ **HAZIR** (2026-08-25): `useQz === true` olduqda QZ **birinci** sıralanır (agent 8s gözləməsi yoxdur); `false` olduqda QZ budağı keçilir. QZ fail-də `error` mesajı qaytarılır və çağırıcılar notify edir.

#### P1-8. Checkout/settle çeklərində `allowBrowserFallback:false`
`POS.tsx:1520` və `TablesPage.tsx:887,952` çeklərdə brauzer ehtiyatı söndürülüb. Agent və QZ yoxkən çek səssizcə itir.
**Düzəliş:** Ən azı brauzer ehtiyatına icazə ver, yaxud aydın "çek çap olunmadı" xətası göstər + növbəyə al. ✅ **HAZIR** (2026-08-25): `allowBrowserFallback` yalnız `true` olduqda açılır (əvvəlki `!== false` default-u QZ-first axınlarında pəncərə açırdı). Uğursuzluqda `error` (QZ qoşulma/printer/sertifikat dostu mesaj) qaytarılır və bütün çağıranlar `notify('error')` ilə göstərir — çek səssiz itmir, səbəb görünür.

---

### P2 — İstəyə bağlı (təhlükəsizlik / gigiyena / möhkəmlik)

- **P2-1.** Print-agent auth yoxdur (localhost + CORS ilə məhdud). Agentlə POS arasında gizli başlıq əlavə et.
- **P2-2.** Tray icon sənəddə var, kodda yox (`ironwaves-print-agent.js`/`README`). Düzəlt və ya sənədi düzəlt.
- **P2-3.** `setup-windows.ps1:68` `Stop-Process -Name "node"` bütün Node proseslərini öldürür — yalnız agenti hədəflə.
- **P2-4.** `setup-windows.ps1` yüklənən `node.exe` üçün checksum yoxdur.
- **P2-5.** QZ kitabxanası açıq CDN-dən (`qz.ts:7`) — oflayn dözümlülük üçün yerliyə köçür.
- **P2-6.** Windows-da Chrome sabit 12s-dən sonra öldürülür (agent) — spool tamamlanmasına əsaslan.
- **P2-7.** Çap müşahidə/audit log yoxdur — uğursuzluqlar yalnız `console.warn`/`logUiError`. Sifariş id + mühərrik + printer + uğur/xəta logu əlavə et.
- **P2-8.** Kəsmədən əvvəl yalnız 4 sətir feed (`escpos_builder.ts:275`) — printerə görə konfiqurasiya olun.
- **P2-9.** QZ private key bundle-da, rotasiya yox — QZ modeli üçün normal, amma sənədləşdir və rotasiya planı qur.

---

## 4. Trigger xəritəsi (harada çap baş verir)

| Trigger | Fayl:sətir | Çap edir | Mühərrik | Avto bayraq | Düşən məlumat |
|---|---|---|---|---|---|
| Ofisiant "Mətbəxə göndər" | `POS.tsx:1474–1525` | Mətbəx | raw_escpos (default) | `auto_print_kitchen_ticket` (default **true**) | **modifiers, notes** |
| Masa "raund göndər" (qaralama) | `TablesPage.tsx:855–892` | Mətbəx | raw_escpos | eyni | notes var, **modifiers yox** |
| Masa "raund göndər" (kompozer) | `TablesPage.tsx:921–957` | Mətbəx | raw_escpos | eyni | **notes + modifiers yox** |
| POS ödəniş çeki | `POS.tsx:1431–1438` | Çek | QZ pixel (`useQz:true`) | `auto_print_receipt` (default true) | —; `allowBrowserFallback:false` |
| Masa hesab çeki | `TablesPage.tsx:1194–1199` | Çek | QZ pixel | eyni | `allowBrowserFallback:false` |
| KDS avto-çap | `KDS.tsx:180–185` | Mətbəx | raw_escpos (default) | `kds_auto_print` (localStorage, default **off**) | modifiers+notes VAR (ziddiyyətli) |
| KDS əllə təkrar-çap | `KDS.tsx:683` | Mətbəx | raw_escpos | — | modifiers+notes VAR |
| Çek "yalnız çap" | `POS.tsx:1805` / `TablesPage.tsx:1583` | Çek | QZ pixel | — | `allowBrowserFallback:true` |
| Admin test çap | `AdminPanel.tsx` / `SettingsPanel.tsx:940` / `ZReportPanel.tsx:851` | müxtəlif | QZ/agent | — | — |

---

## 5. Prioritləşdirilmiş düzəliş planı

**Birinci (P0):**
1. Göndərmə anındakı üç çağırıcıya `modifiers`/`selected_modifiers`/`notes` ötür (P0-1).
2. Kiril üçün səhifə seç və ya pixel mühərrikinə yönləndir (P0-2).

**İkinci (P1):**
3. "Artıq çap olunub" qoruyucusu + KDS avto-çapı yeganə mətbəx printerinə çevir (P1-1).
4. Agent taymautunu qaldır, "qəbul edildi"ni uğur say (P1-2).
5. IndexedDB outbox + retry (P1-3).
6. macOS `@page` ölçüsünü düzəlt (P1-4).
7. Windows default-printer yarışını aradan qaldır (P1-5).
8. Kateqoriya üzrə printer yönləndirmə (P1-6).
9. `use_qz` ölü tənzimləməsini düzəlt (P1-7). ✅ hazır
10. Checkout/settle çeklərində brauzer ehtiyatına icazə ver (P1-8). ✅ hazır

**Üçüncü (P2):** təhlükəsizlik/gigiyena (P2-1…P2-9).

---

## 6. Təsir və risk

| Tapıntı | Təsir | Tezlik | Ağrı |
|---|---|---|---|
| P0-1 modifiers düşür | Yanlış içki/yemək, qaytarma | Hər kahve sifarişində | 🔴 Yüksək |
| P0-2 kiril qarışır | Oxunmaz çek (rus müştəri) | Rus məhsul adı/geydində | 🔴 Yüksək |
| P1-1 iki dəfə çap | Artıq kağız, qarışıqlıq | KDS avto-çap açıqsa | 🟠 Orta |
| P1-2 agent taymaut təkrarı | İki eyni çek | Yavaş agent (macOS) | 🟠 Orta |
| P1-3 itən çek | Sifariş mətbəxə getmədi | Agent/QZ çökərsə | 🟠 Orta |
| P1-4 macOS ölçü | Kəsilmiş/artıq kağız | macOS + agent | 🟠 Orta |
| P1-5 Windows yarış | Yanlış printerə çap | Çox-printer Windows | 🟠 Orta |

---

## 7. Nəticə

Sistem "işləyir" səviyyəsindədir, amma istehsal (kahve) mühitində iki kritik səhv verir: **modifikatorsuz çek** (mətbəx yanlış hazırlayır) və **kiril qarışıqlığı**. Etibarlılıq tərəfi də kövrəkdir — təkrar-çap və səssiz itkilər real iş axınında baş verir. P0-lar kiçik kod dəyişiklikləri ilə (məlumatı tam ötürmək + kod səhifəsi) həll olunur; P1-lər isə növbə/idempotensiya mexanizmi ilə sistemi möhkəmləndirir.
