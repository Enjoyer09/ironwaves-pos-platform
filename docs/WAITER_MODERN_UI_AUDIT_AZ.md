# Ofisiant İnterfeysi — Modern (BahaY) Rejimi UI/UX Auditi

Tarix: 27.09.2026
Əhatə: **YALNIZ ofisiant (staff) rolunun Modern / BahaY rejimindəki təcrübəsi.** Klassik rejimə toxunulmur.
Metod: bütün `isBahaYLab === true` kod yolları oxundu (TablesPage.tsx, BahaYTableCompose.tsx, MenuGrid.tsx, MobileWaiterUI.tsx, StaffPosMode.tsx, App.tsx, index.css) + iPad (1024×768, touch) və telefon (390×844) ölçülərində canlı ekran görüntüləri (lokal rejim, `iw_pos_ui_mode=modern`).

> **Ən vacib nəticə:** Ofisiantın gündəlik axınındakı iki əsas əməliyyat **canlı olaraq çökür** (crash). Bunlar UX problemi deyil — sınmış funksiyadır və hər şeydən əvvəl düzəldilməlidir. Feedbackdəki "qarışıqlıq" hissinin bir hissəsi məhz bu sınıqlardan gəlir.

---

## 0. Rejim necə seçilir (kontekst)

Modern rejim `TablesPage`-də `tablesUiMode === 'modern'` (`isBahaYLab`) ilə idarə olunur. Prioritet sırası ilə 3 mənbə var:
1. `localStorage.iw_tables_ui_mode` / `iw_pos_ui_mode`
2. host `super.ironwaves.store`
3. tenant ayarı `session_settings.tables_ui_mode`

Ofisiantın gördüyü ekran cihaza görə dəyişir:
- **`isMobileView`** = `innerWidth < 1024` **VƏ YA** `pointer: coarse`. Yəni **hər sensorlu iPad** (hətta iPad Pro landşaft) "mobil" sayılır və zal planı üçün `MobileWaiterUI` render olunur, `FloorView`/`TableGrid` yox.
- Sifariş ekranı isə hər cihazda `BahaYTableCompose`-dur (tam ekran `z-[90]` overlay).

Nəticə: **eyni tenant üçün iki fərqli zal UI-si və üç fərqli rejim bayrağı** (`ui_mode`, `tables_ui_mode`, localStorage) paralel yaşayır. Bu, altda (§7) təsvir olunan uyğunsuzluqların kökündədir.

---

## P0 — Kritik: Sınmış / çökən funksiyalar

> **Status (27.09.2026): P0-1, P0-2, P0-3 və P1-7 (void menecer parolu) düzəldildi.** `tsc` 33 → 0 xəta, CI-yə `npm run typecheck` gate əlavə olundu. Əlavə olaraq tip xətalarının gizlətdiyi 2 səssiz bug bağlandı: qonaq sayı dəyişikliyi və kurs (C1/C2/C3) seçimi backend tərəfindən atılırdı; indi saxlanılır (`backend/tests/test_waiter_table_edits.py`).

Bunlar canlı ekran görüntüləri ilə təsdiqləndi.

### P0-1. "Köçür" (Masa Əməliyyatları) tam ekran çökür
- Ofisiant sifariş ekranında **Köçür** düyməsinə basanda bütün ekran `AppErrorBoundary`-yə düşür: **"UI xətası baş verdi — isManagerUser is not defined"**.
- Kök səbəb: `TablesPage.tsx:2952-2953` — Operations modalında `isManagerUser` və `userCanEditTable` dəyişənləri o scope-da mövcud deyil (IIFE-dən kənarda istifadə olunur).
- Təsir: ofisiant **masa köçürə, birləşdirə, ayıra, yaxud oradan ləğv edə bilmir**; ekran çökür, yenidən yükləmə tələb olunur.

### P0-2. "Pre-Check" (aralıq hesab çapı) işləmir
- **Pre-Check** düyməsi toast verir: **"zReceiptRef is not defined"**.
- Kök səbəb: `TablesPage.tsx:1267` — `handlePrintPreCheck` içində mövcud olmayan `zReceiptRef` istinad olunur.
- Təsir: müştəriyə aralıq hesab çapı ümumiyyətlə çıxmır.

### P0-3. Layihə TypeScript-dən keçmir (build riski)
- `npx tsc --noEmit` → **33 xəta**. Bir hissəsi yuxarıdakı runtime çökmələrinin mənbəyidir. POS.tsx-də də `finalSaleId`, `lastCompletedSaleId`, `lastReceiptHtml` təyin olunmayıb (mətbəx bileti + çek təkrar çapı yolları).
- Bu, "işləyir kimi görünür, amma müəyyən düymələr basılanda çökür" vəziyyətini yaradır. **Frontendə tip yoxlaması (tsc) CI gate kimi əlavə olunmalıdır** — hazırda yalnız `vite build` var və bu xətaların çoxu build-i dayandırmır.

> Tövsiyə: P0-ları bağlamadan qalan UX işlərinə başlamayın — çünki auditdə "qarışıq" deyilən hissin bir qismi əslində "düymə işləmir / ekran çökür" təcrübəsidir.

---

## P1 — Yüksək: Ofisiantı ən çox çaşdıran axın problemləri

> **Status (27.09.2026): P1-1, P1-2, P1-3, P1-5, P1-6 düzəldildi** (tsc təmiz, build uğurlu, iPad+telefon Playwright yoxlaması keçdi). P1-7 (void menecer parolu) artıq P0-da bağlanmışdı. P1-4 (Servis mobil dead-end) hələ açıqdır — növbəti dövrə.

### P1-1. Hər göndərişdən sonra ekran avtomatik bağlanır
- `sendRoundDirectly` uğurdan sonra `if (isMobileView || isBahaYLab) closeTableDetail()` çağırır (`TablesPage.tsx:981, 1051`).
- Ofisiant "Mətbəxə Göndər" edən kimi masadan çıxarılıb zal siyahısına atılır. Əvvəl içki, sonra yemək göndərmək istəyən ofisiant hər dəfə masanı yenidən açmalıdır.
- Nəticəni (nə göndərildi, mətbəx qəbul etdi?) görə bilmir. Bu, ən çox şikayət doğuran davranışlardandır.

### P1-2. Telefonda "səbət" və bütün əməliyyatlar əlçatmaz olur
- `BahaYTableCompose`-da telefon (`<md`) səbəti aşağıdan açılan vərəqdir və **onu açan yeganə düymə** üzən "🛒 Səbət" barıdır, o da yalnız `draftRows.length > 0` olduqda görünür.
- Nəticə: masada yalnız **göndərilmiş** məhsullar varsa (yeni qaralama yoxdursa), telefonda ofisiant **Pre-Check, Hesabı Al, Köçür, Servis, Endirim, qonaq sayı, Masanı ləğv et**-ə çata bilmir. Yeganə çıxış — başlıqdakı "←".
- Telefonda iş sahəsi tabları da gizlədilir (`isBahaYLab && isMobileView ? 'hidden'`, `TablesPage:2520`), ona görə "Servis"ə keçdikdən sonra geri qayıtmaq yolu qalmır (dead-end).

### P1-3. Boş masada sifariş paneli yoxdur
- `BahaYTableCompose` sağ paneli yalnız `hasCartContent` (qaralama və ya göndərilmiş var) olduqda görünür; əks halda `md:hidden`.
- Yeni açılmış boş masada ofisiant **heç bir düymə görmür** — nə "Geri", nə "Ləğv", nə qonaq sayı. Yalnız menyu şəbəkəsi. İlk məhsulu əlavə edənə qədər panel gizli qalır. (Ekran görüntüsü: `compose-empty` — sağ tərəf boşdur.)

### P1-4. "Servis" mobil rejimdə tələ (dead-end)
- Quick-action "Servis" `tableWorkspaceTab`-ı `service`-ə keçirir, `BahaYTableCompose` unmount olur. Mobil tab bar gizli olduğu üçün compose-a qayıtmaq mümkün deyil — masanı bağlayıb təzədən açmaq lazımdır.

### P1-5. Rejim keçid düyməsi ofisiantda görünür
- Başlıqdakı **"Müasir Rejim / Klassik"** düyməsi (`App.tsx:2066`) heç bir rol yoxlaması ilə qorunmur — ofisiant görür və basa bilər.
- Basanda `localStorage`-a yazır və bu, tenant ayarını **üstələyir**, cihazda qalır, növbəti PIN ilə girən ofisiantı da təsir edir. Ofisiant təsadüfən klassikə keçib "interfeys tamam dəyişdi" deyə çaşa bilər.
- Yanında ofisiantın işinə aid olmayan **"Analitika"** modulu da naviqasiyada görünür (`App.tsx:733` staff siyahısına şərtsiz `analytics` əlavə edir).

### P1-6. Eyni sifarişi almaq üçün iki fərqli ekran
- Modern staff üçün POS `StaffPosMode`-a düşür (öz menyusu, səbəti, "Masaya Göndər"i var), Masalar isə `BahaYTableCompose`-a (öz menyusu, qaralaması, "Mətbəxə Göndər"i). Eyni dine-in sifariş üçün **iki ayrı menyu UI, iki səbət, iki göndər düyməsi** var. Ofisiant hansından istifadə etməli olduğunu bilmir.

### P1-7. Təhlükəli əməliyyatlarda menecer icazəsi işləmir
- Göndərilmiş məhsulu ləğv edərkən `ItemActionModal`-da status **hardcoded "SENT"** ötürülür (`ItemActionModal.tsx:34`), `itemActionNeedsManager('VOID','SENT')` false qaytarır → **"Menecer Təsdiqi" parol bloku heç vaxt görünmür**. Ofisiant mətbəxə getmiş (READY/PREPARING) məhsulu parolsuz ləğv edə bilir (backend ayrıca yoxlamırsa).
- Endirim: ofisiant compose-da 0→5→10→15→20% dövr edə bilir — **heç bir icazə/parol/təsdiq yoxdur** (`BahaYTableCompose` quick-action). Backendə əməliyyat çatmır (lokal state), amma UX baxımından ofisiant sərbəst endirim tətbiq edir kimi görünür.

---

## P2 — Orta: Ardıcıllıq və aydınlıq problemləri

> **Status (27.09.2026): P1-4, P2-1, P2-2, P2-6 düzəldildi** (tsc təmiz, build uğurlu, telefon Playwright yoxlaması keçdi). Qalan P2 maddələri (P2-3 kiçik toxunma hədəfləri/şriftlər, P2-4 qaralama/göndərilmiş vizual fərqi, P2-5 status rəngləri) və P3 açıqdır.

### P2-1. Termin qarışıqlığı (eyni söz ≠ eyni əməliyyat)
- **"Bağla"**: PaymentModal-da = ödənişi tamamla (Settle); Göndərilmişlər / FullOrderList / StatusLog panellərində = paneli qapat. İki tam fərqli məna.
- **"Ləğv / Ləğv et"**: PaymentModal-da modalı bağlayır; masa üçün = masanı ləğv et; məhsul üçün = void. Üç fərqli məna.
- Hesab terminləri qarışıqdır: **"Hesab" / "Hesabı Al" / "Çek" / "Pre-Check" / "hesabını bağla"** eyni anlayış üçün.
- Servis/status: "Servis" həm tabdır, həm SERVED statusu. READY = "Hazır" və "Servisə hazırdır". SENT = "Göndərilib", "Mətbəxə çatdı", "Mətbəxə göndərildi".
- Göndər: "Mətbəxə Göndər" (səbətdə) ≠ "🍳 Göndər" (mobil bar); toast bəzən "sifariş", bəzən "raund".
- Qonaq: "nəfər / Nəfər / qonaq / Qonaq sayı" qarışıq.

### P2-2. Çoxlu təkrarlanan və dublikat düymələr
- **Geri düyməsi 3 variant**: başlıqda "←", "← Masalara qayıt", bəzən "← Masalar".
- **Masanı ləğv et 5 giriş nöqtəsi**: BahaY düyməsi, Ops modal, Ops tab, yuxarı "safe-cancel" banner, aşağı eyni bannerin ikinci nüsxəsi (eyni anda görünür).
- **Servis** iki yerdən (tab bar + quick-action), **Endirim** üç yerdən (compose cycle + PaymentModal select + PaymentModal preset grid).
- **Ödəniş üsulu iki dəfə seçilir**: əvvəl compose-da (Nəğd/Kart/QR), sonra PaymentModal-da (Tam nəğd/Tam kart/Split). Compose seçimi çaşdırıcıdır — ofisiant "indi ödədim" kimi başa düşə bilər, halbuki yalnız ön-seçimdir və `QR → Kart`-a map olunur (QR kosmetikdir).

### P2-3. Çox kiçik hədəflər və şriftlər (touch üçün)
- `text-[8px]`–`text-[11px]` çoxdur: quick-action etiketləri, sent meta, kurs "C1", "Lock-u aç", geri/ləğv linkləri, kart alt-yazıları.
- 44px-dən kiçik toxunma hədəfləri: quick-action bar (~40px `py-1.5`), qonaq seçici `h-7`, kurs/qeyd/sil `h-8`, sent panel `h-8 w-8`, "Masanı ləğv et" və "Masalara qayıt" `py-1` (~24px), "Servis edildi" `px-2 py-1`.
- Qeyd: `html { font-size: 90% }` (`index.css:157`) hər şeyi 0.9× kiçildir, yəni `text-xs` ≈ 10.8px. Ofisiant üçün kritik düymələr min 44×44px və ≥13px olmalıdır.

### P2-4. Qaralama vs Göndərilmiş fərqi zəif
- Göndərilmiş məhsullar əsas siyahıda deyil — yığcam açılan panelin arxasında, **etiketsiz rəngli nöqtələrlə** (emerald/orange/blue/yellow) göstərilir; legend yoxdur.
- Masada çoxlu göndərilmiş məhsul olsa belə, qaralama boşdursa boş vəziyyət kartı **"🍽️ Sifariş üçün məhsul seçin"** görünür — ofisiant "sifariş boşdur" kimi oxuya bilər.

### P2-5. Status rəngləri komponentlər arasında ziddiyyətli
- `TableGrid` (desktop): boş = boz/slate, dolu (SEATED/ACTIVE_CHECK) = emerald; amma statistika pilləri boş = emerald, dolu = violet — kartlarla ziddiyyət.
- `MobileWaiterUI`: boş = emerald, dolu = rose, mənim = amber, hazır = cyan, hesab = purple.
- Məhsul statusu nöqtələri: PREPARING BahaY-da orange, HistoryTab-da amber; SERVED BahaY-da violet, HistoryTab-da cyan.
- İki fərqli zaman-sayğac həddi: TableGrid 35/75 dəq, MobileWaiterUI 45/90 dəq.

### P2-6. Qarışıq dil (az içində İngilis/hardcoded)
- "Pre-Check", "Open check hesabını bağla", "Lock-u aç", "Owner-i ötür", "N item", "QR / App", "C1/C2/C3", FloorView "Main Floor" (hər üç dildə), `Seat ${n}`, toastlarda 'Error creating floor plan'.
- Hardcoded (tx-siz): `${elapsedMin} dəq`, "Hs Md", 'Masa'/'Sifaris' fallback, `Oturacaq ${n}`.

---

## P3 — Aşağı: Təmizlik və detallar

### P3-1. Ölü / əlçatmaz UI (modern rejimdə)
- `OpenTableDialog` (fast-open onu keçir), `SentItemsSlideUp`, `FullOrderListModal` (batch void), `StatusLogModal`, `RevisionModal`, `StickyActionBar showSettle` — modern rejimdə heç vaxt çağırılmır.
- `TableGrid` uzun-basma quick-action: 450ms basılır, cihaz vibrasiya edir, **heç nə açılmır** (`quickActionsTableId` render olunmur).
- FloorView list layout-unda sağda 340–420px boş `div` görünür.

### P3-2. Səssiz uğursuzluqlar və qorumanın olmaması
- `MobileWaiterUI` masa açması uğursuz olsa yalnız `console.error` — ofisiant heç nə görmür.
- Fast-open-da (`handleSelectWaiterTable`) və Settle-də **in-flight guard yoxdur** — cüt toxunuş iki masa aça / iki dəfə hesab bağlaya bilər. Loading göstəricisi də yoxdur.
- Qaralama silmək ("−"→0, "Təmizlə", "Sil") təsdiqsizdir.
- Masanı ləğv etmə isə **üçqat təsdiq** tələb edir (custom modal + native prompt), üstəlik səbəb sahəsi əvvəlcədən doldurulub — ofisiant sadəcə OK basır. Balanssız: adi silmə heç, tam ləğv 3 dialoq.

### P3-3. Offline göstəricisi işçi ekranlarında görünmür
- Yeganə offline banneri `tables-page-shell` başındadır; həm `z-[90]` detal overlay, həm `z-[60]` MobileWaiterUI onu örtür. Üstəlik başlıqdakı yaşıl nöqtə hardcoded "online" təəssüratı verir.

### P3-4. Vizual sistem qarışıqlığı
- `data-ui-mode` yalnız `ui_mode`-dan asılıdır, `SettingsPanel` isə saxlayanda `ui_mode: 'old'` hardcode edir (`SettingsPanel:1461` və s.). Nəticədə "modern" layout qala-qala glass CSS sönə bilər.
- `index.css`-də blanket override-lar (`[class*='text-slate-300']`, `bg-slate-900/` → `!important`) mətn ierarxiyasını düzləşdirir və `hover:text-white` effektini məhv edir; şüşə naviqasiyanı demək olar qeyri-şəffaf edir.
- Hər məhsul kartında ayrıca `backdrop-filter: blur(12px)` — onlarla kartlı şəbəkədə POS planşetlərində performans riski.

---

## Ofisiant axını (addım-addım, müşahidə)

1. **Giriş** → PIN. (Qeyd: fast-switch avto-təsdiq 4 rəqəmdə işə düşür (`App.tsx:1664`), amma `staff_pin_length` 6 ola bilər → 6-rəqəmli PIN 4-də yanlış təsdiq olar.)
2. **Zal** → iPad/telefonda `MobileWaiterUI` (zonalar, axtarış, 6 filtr, "Toxun və dərhal aç" kartları).
3. **Masa aç** → boş masaya toxun → qonaq seçici (1–8,10,12,16,20+); iPad desktop yolunda isə prompt-suz 2 qonaqla açılır. Rezerv/dirty/lock yoxlamaları MobileWaiterUI yolunda **atlanılır**.
4. **Sifariş yığ** → menyu şəbəkəsi (şəkilli kartlar, kateqoriya pill-ləri, uzun-basma miqdar popover). Boş masada sağ panel görünmür (P1-3).
5. **Mətbəxə göndər** → toast → **ekran avtomatik bağlanır** (P1-1).
6. **Əlavə et** → masanı yenidən aç.
7. **Pre-Check** → **çökür** (P0-2).
8. **Hesabı Al** → PaymentModal (endirim seçici + 10 preset dublikat, Nəğd/Kart/Split, nağd üstü qalıq). Cancel edəndə iş sahəsi artıq bağlandığı üçün zala qayıdır.
9. **Köçür/Əməliyyat** → **çökür** (P0-1).

---

## Tövsiyə olunan sıra

1. **P0 (bu həftə):** `isManagerUser`/`userCanEditTable` scope düzəlişi (2952), `zReceiptRef` (1267), POS.tsx undefined dəyişənlər; `tsc --noEmit`-i CI gate et.
2. **P1:** göndərişdən sonra avtomatik bağlanmanı ləğv et (masada qal, "göndərildi" onay göstər); telefonda səbət/əməliyyatlara daimi çıxış (sabit alt panel); boş masada da minimal panel; rejim toggle və Analitika-nı ofisiantdan gizlət; sifarişi bir axına yığ (Masalar VƏ YA StaffPos, ikisi yox); void/endirim üçün menecer qorumasını real işlət.
3. **P2:** termin lüğəti (Bağla/Ləğv/Hesab), dublikat düymələri azalt, toxunma hədəflərini 44px+ et, status rənglərini vahid palitraya bağla.
4. **P3:** ölü UI-ni sil, səssiz uğursuzluqları görünən et, offline bannerini overlay-lərdə göstər, vizual sistemi sadələşdir.

---

### Əlavə: yoxlama mühiti
- Lokal rejim + `iw_pos_ui_mode=modern`, Playwright/Chrome, iPad 1024×768 (touch) və telefon 390×844.
- Runtime çökmələr canlı təsdiqləndi (ekran görüntüləri ilə). Backend-tərəf davranış (məsələn void üçün server-side menecer yoxlaması, PRECHECK statusu) bu auditdə yoxlanmadı — yalnız frontend.
