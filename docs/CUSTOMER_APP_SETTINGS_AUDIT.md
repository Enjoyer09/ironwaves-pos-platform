# Customer App Dizaynı — İdarəetmə Paneli Auditi

Tarix: 2026-09-03
Əhatə: `src/components/admin/CustomerAppPanel.tsx` (AdminPanel tab `customerapp`) və onun arxasındaki
settings / campaign / loyalty zənciri — `src/api/settings.ts`, `backend/app/routers/operations.py`,
`backend/app/routers/pos.py`, `backend/app/services/birthday_scheduler.py`.

Mövcud `docs/CUSTOMER_APP_*` sənədləri müştəri tətbiqinin **özünü** auditə alır. Bu sənəd
tətbiqin **idarəetmə panelini** auditə alır: nə idarə olunur, nə idarə olunduğunu iddia edir
amma etmir, nə itir.

---

## 1. Nəticə: 4 / 10

> **P0 tam bitdi (2026-09-04) — yenidən qiymət: 7 / 10.** Aşağıdaki cədvəl **auditin ilk
> anına** aiddir. P0.1–P0.7-dən sonra dəyişən ballar: real təsir 3 → **7** (yalnız 4 qazanma
> sahəsi ölü qalır — P1.1), bütövlük 2 → **8** (PATCH artıq merge edir), ön baxışın doğruluğu
> 2 → **8** (yalanlar silindi, ölü sahələr nişanlandı). Dəyişməyənlər: vahid idarə mərkəzi 3
> (kampaniya hələ 2 paneldə — P2), panelin UX-i 4 (P1.4), müşahidə olunabilirlik 1 (P3).
> "Panel istifadəçiyə yalan deyir" cümləsi artıq **doğru deyil**: hər saxlanan sahə ya real
> işləyir, ya da "tətbiqdə hələ işləmir" nişanı daşıyır.

> **P1.1 bitdi (2026-09-04) — yenidən qiymət: 8 / 10.** Sonuncu 4 ölü qazanma sahəsi
> (`earn_rate_per_azn`, `min_purchase_for_earn`, `first_purchase_bonus`, `double_points_days`)
> və tier `multiplier`-i artıq kassada işləyir → real təsir 7 → **9**; ön baxış POS-un öz
> mühərriki ilə hesablanır (panel öz düsturunu saxlamır) → doğruluq 8 → **9**; `points`
> rejimində ledger yazılmağa başladı, yəni hesabat üçün data **var**, ekran hələ yox →
> müşahidə olunabilirlik 1 → **3** (P3). Qalan boşluqlar: tier redaktoru (P1.2), hədiyyə
> kataloqu (P1.3), push idarəsi (P1.4), kampaniya modeli (P1.5).

> **P1.2 bitdi (2026-09-04) — ümumi qiymət 8 / 10 olaraq qalır.** Nərdivan artıq paneldən
> redaktə olunur (§3.5 bağlandı) və hardcoded nüsxələr dilə görə tək mənbəyə yığıldı (§4.2),
> amma bal qalxmır: qalan üç P1 boşluğu (hədiyyə kataloqu, push idarəsi, kampaniya modeli)
> hələ açıqdır. Ölçülər daxilində dəyişən: vahid idarə mərkəzi 3 → **4** (tier bir yerdən
> yazılır; kampaniya hələ 2 paneldə, rəng hələ 3 sistemdə), panelin öz UX-i 4 → **5**
> (nərdivan blokunda "server nə saxlayacaq" ön baxışı, təkrar/boş açar xəbərdarlığı və sətir
> sayğacı var — panelin real validasiyası olan ilk bloku). Dəyişməyən: real təsir **9** —
> nərdivanın `discount_percent` sahəsi saxlanılır, amma kassa onu oxumur (P1.6), ona görə
> P0.4 nişanı **məhz o sahədə** qaldı.

> **P1.3 bitdi (2026-09-05) — yenidən qiymət: 9 / 10.** Hədiyyə artıq tək "ad + hədd" cütü deyil,
> 20 sətirə qədər kataloqdur (qiymət, məhsul bağlantısı, stok limiti, aktiv/deaktiv, 3 dil) və
> zəncirin **hər beş həlqəsi** onu oxuyur: panel yazır, `wallet.rewards` göstərir, claim `reward_id`
> ilə sətrə bağlanır, kassa endirimi bağlı məhsula tətbiq edir, stok verilmiş kodlardan sayılır.
> Dəyişən ballar: əhatə genişliyi 6 → **8** (stok və məhsul bağlantısı yeni ox açır), vahid idarə
> mərkəzi 4 → **5** (hədiyyə bir yerdən idarə olunur; kampaniya hələ 2 paneldə, rəng 3 sistemdə),
> panelin UX-i 5 → **6** (kataloq blokunun üç real xəbərdarlığı var: aktiv sətir yoxdur,
> `reward_threshold` ən ucuz sətirdən fərqlidir, 20 sətir həddi aşılıb). Dəyişməyən: real təsir
> **9** — `reward_threshold` hələ də kassanın avtomatik pulsuz içki sayğacıdır (birləşdirmə P2),
> müşahidə olunabilirlik **3** (hansı hədiyyə nə qədər alınıb — ekran yox, P3). Qalan P1
> boşluqları: push idarəsi (P1.4), kampaniya modeli (P1.5), endirim yığımı (P1.6).

Panel kağız üzərində zəngindir — 34 sahə, 3 dizayn preseti, canlı telefon ön baxışı, kampaniya
və filial CRUD. Problem odur ki, **bu sahələrin təxminən yarısı heç bir şeyə təsir etmir**, bir
qismi isə saxlanarkən başqa parametrləri silir.

| Ölçü | Bal | Səbəb |
|---|---|---|
| Əhatə genişliyi (kağız üzərində) | 6 | Branding, earn rules, kampaniya, filial, widget — geniş görünür |
| Real təsir (save → tətbiqdə dəyişir?) | 3 | 34 sahədən 10-u tam ölüdür, 6-sı yarımçıq işləyir |
| Bütövlük / təhlükəsizlik | 2 | Hər save `tiers`, `birthday_enabled`, `onesignal_app_id` sahələrini silir |
| Vahid idarə mərkəzi olması | 3 | Kampaniya 2 yerdə, tier 4 yerdə, 3 ayrı rəng sistemi |
| Ön baxışın doğruluğu | 2 | Ön baxış ölü sahələri işləyirmiş kimi göstərir |
| Panelin öz UX-i | 4 | 1000 sətir tək scroll, 4 ayrı Save, dirty-state yox, validasiya yox |
| Müşahidə olunabilirlik (hesabat) | 1 | Hesabat ekranı yox — üstəlik `points` üçün ledger heç yazılmır (§3.11) |

Ən vacib cümlə: **panel istifadəçiyə yalan deyir.** Kafe sahibi "1 AZN = 2 xal" yazır, save edir,
yaşıl bildiriş görür — və kassa heç vaxt o qaydaya görə xal vermir.

---

## 2. Hazırkı inventar

`CustomerAppPanel.tsx` — 1003 sətir, tək flat scroll, 6 kart + sağda sticky telefon ön baxışı:

1. Dizayn presetləri — `rewards` / `cashback` / `playful` (`:443-455`)
2. Branding sahələri — app adı, hero başlıq/altbaşlıq, razılaşma mətni, balans adı, reward adı /
   həddi / izahı / kart stili, cashback %, primary / accent / background rəngləri, hero və fon şəkli (`:458-571`)
3. Qeydiyyat axını — `simple` / `lightweight` / `full` (`:574-646`)
4. Qazanma qaydaları — 1 AZN = n xal, min alış, ad günü bonusu, ilk alış bonusu, 2x günlər (`:648-687`)
5. Kassa onboarding QR — klub tipi + başlanğıc endirim (`:689-716`)
6. Kampaniyalar CRUD — ad, saat aralığı, endirim %, günlər, kateqoriyalar, aktivlik (`:720-815`)
7. Filiallar CRUD — ad, ünvan, telefon, lat/lng, açılış/bağlanış saatı, default (`:817-903`)
8. Fun & AI + görünürlük açarları — QR kartı, balans, kampaniyalar, tarixçə, bildirişlər,
   AI Barista, AI Falçı, offline kampaniya bloku, aktivasiya pəncərəsi (`:906-955`)
9. Canlı ön baxış — saxta telefon çərçivəsi (`:959-998`)

---

## 3. Kritik tapıntılar

> **Status (2026-09-04).** Bu bölmə **auditin ilk anını** qeyd edir və tarixi sənəd kimi
> olduğu kimi saxlanılır — sətir nömrələri o vaxtkı koda aiddir və artıq sürüşüb. Hansı
> tapıntının bağlandığı §5-dəki P0/P1 bloklarındadır: **3.1** → P0.1 ✅, **3.2** → P0.2 ✅,
> **3.3** → P1.1 ✅, **3.4** → P0.3 ✅, **3.7** → P0.3 + P0.4 ✅, **3.8** → P0.5 ✅,
> **3.9** → P0.6 ✅, `tiers` multiplier → P1.1 ✅, **3.11** → P1.1 ✅ (ledger `points`
> rejimində də yazılır; hesabat ekranı hələ yox → P3). Açıq qalanlar: **3.6** (push idarəsi —
> P1.4), **3.10**. **3.5** → P1.2 ✅ (nərdivan paneldən yazılır, hardcoded nüsxələr dilə
> görə tək mənbəyə yığıldı).

### 3.1 Kök səbəb: `PATCH` bütün obyekti əvəz edir

`backend/app/routers/operations.py:2964-3003` — endpoint gələn payload-dan **sıfırdan yeni dict
qurur** (`cleaned = {...}`), göndərilməyən hər açar üçün hardcoded default qoyur, sonra bunu
bütövlükdə yazır. Merge yoxdur.

Nəticə: panelin göndərmədiyi hər açar **hər save-də sıfırlanır**. Bu, aşağıdaki üç problemi
sadəcə "çatışmayan funksiya"dan "aktiv dağıdıcı davranış"a çevirir.

### 3.2 Ad günü bonusu heç vaxt işləyə bilməz

Üç ayrı qırıq həlqə üst-üstə düşür:

- `birthday_scheduler.py:232` bütün ad günü mexanizmini `birthday_enabled` açarına bağlayır,
  default `False`.
- Panel `birthday_enabled` açarını **heç vaxt göndərmir** (`src/` boyu qrep = 0 nəticə), amma
  `operations.py:2994` onu `payload.get("birthday_enabled", False)` ilə yenidən qurur →
  **hər save onu `False`-a qaytarır.**
- Panel `birthday_bonus_points` yazır (`CustomerAppPanel.tsx:340`), scheduler isə
  `birthday_bonus_stars` oxuyur. İki fərqli açar. Yəni paneldəki ad günü rəqəmi heç kimin
  oxumadığı bir açara gedir, scheduler-in oxuduğu açar isə hər save-də `5`-ə sıfırlanır.

### 3.3 Bütün "Qazanma Qaydaları" kartı dekorativdir

Panel `earn_rate_per_azn`, `min_purchase_for_earn`, `first_purchase_bonus`, `double_points_days`,
`birthday_bonus_points` yazır və backend onları saxlayır (`operations.py:2997-3001`) — amma
**heç bir accrual kodu onları oxumur.**

Real xal məntiqi `backend/app/routers/pos.py:714-720`:

```python
coffee_qty += int(item.qty or 0)          # qəhvə tipli hər məhsul üçün +1
free_coffees = int((current_stars + coffee_qty) // 10)
customer_stars_after = (current_stars + coffee_qty) % 10
```

Yəni: AZN-ə görə deyil, məhsul sayına görə; minimum alış yoxdur; həftə günü çarpanı yoxdur;
ilk alış bonusu yoxdur. **5 nəzarət elementi tamamilə saxtadır.**

Vacib istisna: `program_mode` **işləyir.** `pos.py:698-699` `program_mode` və `cashback_percent`
oxuyur və `:1030-1042` `cashback` rejimində məbləğə görə faiz hesablayır. Yəni panelin ən
mürəkkəb görünən sahəsi (`cashback_percent`) düzgün işləyir, sadə görünən 5 sahə isə ölüdür.
Problem "loyallıq heç işləmir" deyil — **`points` rejimi konfiqurasiya oluna bilmir.**

### 3.4 `reward_threshold` tətbiqlə kassa arasında ziddiyyət yaradır

`operations.py:4376` və `:4643` konfiqurasiya olunmuş həddi hörmətlə oxuyur — progress bar və
`RewardClaim` yaradılması üçün. Lakin `pos.py:718-720` literal `// 10` və `% 10` işlədir, həmçinin
`HomeTab.tsx:515-530` ştamp şəbəkəsini 10 yuvaya hardcode edib.

Nəticə: həddi 10-dan başqa bir rəqəm qoysan, müştəri tətbiqi ilə kassa **hədiyyənin nə vaxt
qazanıldığı barədə fərqli cavab verir.** Bu, birbaşa müştəri şikayəti doğuran bir uyğunsuzluqdur.

> ✅ **Bağlandı: P0.3 (hədd) + P1.3 (kataloq).** `pos.py` literal `// 10` yerinə ayarın həddini,
> `HomeTab.tsx` isə ştamp şəbəkəsini `reward_threshold`-dan oxuyur — yəni **eyni rəqəm**. P1.3-də
> hədiyyə çoxsətirli kataloqa çevrildi, amma `reward_threshold` **qəsdən** saxlanıldı: kassanın
> avtomatik pulsuz içki sayğacı hələ ona baxır. İki mənbənin ayrılmaması üçün panel ən ucuz aktiv
> kataloq sətri həddən fərqlənəndə xəbərdarlıq göstərir; tam birləşdirmə **P2**-dədir.

### 3.5 `tiers` oxunur, amma yazıla bilmir

`operations.py:4429` müştərinin tier-ini `app_settings.get("tiers") or DEFAULT_TIERS`-dən hesablayır,
tətbiq isə onu göstərir (`HomeTab.tsx:168-170`, `ProfileTab.tsx:75-77`). Amma `tiers` PATCH-in
`cleaned` dict-ində **yoxdur** → nə admin idarə edə bilir, nə də saxlanmış dəyər sağ qalır.

`DEFAULT_TIERS` (`operations.py:4206-4210` — bronze 0 / silver 100 / gold 300) bütün tenantlar
üçün hardcoded qalır. Üstəlik tier-in `multiplier` sahəsi (gold 1.5x) müştəriyə göndərilir amma
**heç bir accrual yerində tətbiq olunmur.**

> ✅ **Bağlandı: P0.1 (merge) + P1.1 (multiplier) + P1.2 (redaktor).** `tiers` artıq PATCH
> dict-indədir və paneldə redaktə olunur (`CustomerAppPanel.tsx` → "Səviyyə nərdivanı"),
> `multiplier` `tier_multiplier_enabled` keçidi ilə kassada işləyir. `DEFAULT_TIERS` hələ
> hardcoded-dır, amma artıq **hər dildə bir dəfə** (`operations.py::DEFAULT_TIERS` və
> `src/lib/loyalty.ts::DEFAULT_LOYALTY_TIERS`) və paritet testi ilə bağlıdır — detal P1.2
> blokunda.

### 3.6 Push per-tenant ölüdür

`onesignal_app_id` `operations.py:3800` və `:4400`-də müştəriyə göndərilir,
`CustomerApp.tsx:737-744` onunla OneSignal SDK-nı işə salır. Lakin PATCH dict-ində yoxdur →
həmişə `None` → **brauzer push abunəliyi hər tenant üçün ölüdür.** Server tərəfi qlobal env
açarlarına düşür (`core/config.py:105-106`), yəni push platforma səviyyəsində bir parametrdir və
tenant-ın heç bir nəzarəti yoxdur.

> ✅ **Bağlandı: P0.1 (merge) + P1.4 (idarə).** `onesignal_app_id` PATCH dict-indədir, panelin
> "Bildirişlər" bloku onu yazır, REST açarı isə **ayrı** `push_settings` açarındadır (o blob
> müştəriyə qaytarılmır). Göndərici `app_id` + açarı **bir mənbədən** götürür — qarışıq cüt
> (tenant app + platforma açarı) heç vaxt qurulmur, çünki OneSignal onu `invalid_player_ids`
> ilə rədd edir. Detal P1.4 blokunda.
>
> ⚠️ **Açıq qalan (P1.4-ün həll etmədiyi) iki defekt:**
>
> 1. **`Customer.push_token` tək sütundur** (`models.py:538`), yəni bir müştəri **bir cihaz**
>    saxlayır: telefonda qeydiyyatdan keçib sonra brauzerdən girsə köhnə token üzərinə yazılır
>    və birinci cihaz susur. Düzəlişi ayrı `customer_push_tokens` cədvəli tələb edir → **P2**.
> 2. **Native cihaz tokenləri çatdırıla bilmir.** Həmin sütun iki fərqli şey saxlayır: brauzer
>    SDK-sı OneSignal **abunəlik id-si** (36 simvol UUID), `@capacitor/push-notifications` isə
>    APNs/FCM **cihaz tokeni** (məs. 64 hex simvol) yazır. `include_subscription_ids` ikincisini
>    qəbul etmir. P1.4 bunu **gizlətmir**: `split_deliverable_tokens` təsnifat verir və panel
>    "N token OneSignal abunəliyi deyil — onlara çatdırılma mümkün deyil" yazır. Əsl düzəliş
>    native tərəfdə OneSignal SDK-sının işlədilməsidir (`App.tsx` push qeydiyyatı) → **P2**.


### 3.7 Dizayn sahələrinin böyük hissəsini tətbiq oxumur

`CustomerApp.tsx` + `customer/*.tsx` boyu qrep nəticəsi — bu sahələri **heç bir komponent
oxumur**: `layout_preset`, `background_color`, `background_image_url`, `reward_card_style`,
`hero_title` (əsas hero hardcoded), `hero_subtitle` (yalnız join ekranında işlənir).

Yəni: üç böyük "dizayn preseti" əsasən ölü sahələr yazır, rəng seçiciləri və kart stili
dropdown-u real tətbiqdə heç nə etmir. `hero_image_url` isə hero-ya deyil, yalnız üzvlük
kartının fonuna düşür (`HomeTab.tsx:542-543`).

Əsas hero tam hardcoded-dır — `HomeTab.tsx:322-347`:
`linear-gradient(135deg, #FF8B26 0%, #F48C24 100%)` + sabit başlıq + sabit CTA.

**Canlı ön baxış bu problemi gizlədir:** `CustomerAppPanel.tsx:968-987` ön baxışda
`background_color`, `background_image_url` və `reward_card_style` sahələrini işləyirmiş kimi
render edir. Yəni panel yalnız ölü sahə saxlamır — ölü sahənin işlədiyini **vizual olaraq
sübut edir.** Ön baxışın tab bar-ı da 4 emoji göstərir (`['🏠','🎁','📋','👤']`) halbuki real
tətbiqdə 5-6 tab var.

### 3.8 Multi-tenant platformada bir kafenin datası hardcoded

- `CustomerApp.tsx:2216` və `HomeTab.tsx:301` — `<img src="/logo.jpg" alt="Emalathhana" />`.
  Bir tenantın loqosu bütün tenantlar üçün hardcoded və `branding.logo_url`-i üstələyir.
- `logo_url` `src/` boyu **heç bir admin input tərəfindən yazılmır** — nə bu paneldə,
  nə `BusinessProfileSection.tsx`-də.
- `CustomerApp.tsx:1211-1213` — geofence `CAFE_LAT = 40.37767`, `CAFE_LNG = 49.84583`, 100 m,
  yalnız AZ mətn. Bir kafenin koordinatı bütün tenantlar üçün.
- `HomeTab.tsx:704-707` — milestone nərdivanı sabit hədiyyə adları ilə: 'Çay / Espresso',
  'Cappuccino / Latte', 'Böyük Qəhvə + Desert'.
- `HomeTab.tsx:175-179` — növbəti hədiyyə ipucu `reward_name`-dən asılı olmayaraq
  "pulsuz Latte" yazır.

### 3.9 Tətbiqin verdiyi, biznesin öhdəsinə düşməyən vədlər

- **Referral tamamilə uydurmadır.** `HomeTab.tsx:191-204` — "Dostunu dəvət et, ikinizə də ulduz!"
  dörd fırlanan mətndən biridir. Referral kodu yox, backend sahəsi yox, izləmə yox.
- `surpriseMessages` — `new Date().getDate() % 4` ilə fırlanır və "ad günündə pulsuz içki" və
  "saat 11-ə qədər sifariş = 2x ulduz" vəd edir. **Hər ikisinin arxasında heç bir qayda yoxdur.**

Bunlar müştəriyə verilən, sistemin yerinə yetirə bilmədiyi vədlərdir — kassada arqumentə çevrilir.

### 3.10 İki xırda amma real defekt

- `CustomerApp.tsx:1973` — `sessionCreds={{ cardId: ..., token: '' }}`, `tenantId` yoxdur.
  Ona görə `FeedbackTab.tsx:33` həmişə `'tenant_default'`-a düşür və **tenantın
  `preset_tags` etiketləri heç vaxt görünmür.**
- Tier fallback-ları fərqlidir: `HomeTab` `'#cd7f32'` / `'Member'`, `ProfileTab.tsx:76-77`
  isə `'#F48C24'` / `'Golden Member'`. Eyni müştəri iki ekranda iki fərqli tier kimliyi görür.

### 3.11 `points` rejimində loyallıq ledger-i heç vaxt yazılmır

`LoyaltyLedgerEntry` bütün backend boyu yalnız iki `unit` ilə yazılır: `cashback`
(`pos.py:1023`, `:1037`, `analytics_api.py:699`, `:716`, `:950`) və `birthday`
(`birthday_scheduler.py:179`). **`unit="points"` heç bir yerdə yoxdur.**

`points` rejimində satış zamanı sadəcə `customer.stars = customer_stars_after` yazılır
(`pos.py:1009-1011`) — yəni balans tarixçəsi olmayan mutasiya edilən sayğacdır.

Nəticələri:
- Xal verilməsi/istifadəsi **auditə alına bilmir** — mübahisədə "bu müştəriyə nə vaxt neçə xal
  verildi" sualının cavabı yoxdur.
- Açıq loyallıq öhdəliyi (verilmiş amma istifadə edilməmiş xal) hesablana bilmir.
- §P3-dəki hesabatların yarısı üçün **data mövcud deyil** — hesabat əlavə etmək üçün əvvəlcə
  ledger yazılmalıdır.

Bu, §P3-ün (müşahidə olunabilirlik 1/10) əsl kök səbəbidir: problem hesabat ekranının olmaması
deyil, hesabatın oxuyacağı yazının olmamasıdır.

---

## 4. Parçalanma xəritəsi — "vahid idarə mərkəzi" niyə mövcud deyil

İstifadəçinin tələbi budur: loyallıq bonusları, kampaniyalar və per-tenant dizayn **bir yerdən**
idarə olunsun. Hazırda bunların heç biri bir yerdən idarə olunmur.

### 4.1 Kampaniya = 2 admin UI, 1 cədvəl, 0 çarpaz görünürlük

`CustomerAppPanel` "Kampaniyalar" bloku və `TablesHappyHourPanel` "Happy Hour" bloku
**eyni endpointə və eyni cədvələ** yazır:

| UI | Çağırdığı funksiya | Real endpoint |
|---|---|---|
| CustomerAppPanel | `list/create/update/delete_campaign_live` (`api/settings.ts:2328-2367`) | `/api/v1/ops/happy-hours` |
| TablesHappyHourPanel | `*_happy_hour_live` (`api/happy_hours.ts`) | `/api/v1/ops/happy-hours` |

Yəni admin Masalar bölməsində Happy Hour yaradır — o, xəbərsiz şəkildə müştəri tətbiqində
kampaniya kimi görünür. Və ya əksinə. İki ekran bir-birinin yazdığını göstərmir, iki fərqli
validasiya, iki fərqli forma sxemi işlədir.

Üstəlik: `list_campaigns_admin_live` **lokal rejimdə `[]` qaytarır**, `create_campaign_live` isə
saxta `{ id: 'campaign_...' }` cavabı verir. Backend olmayan quraşdırmada admin kampaniya yaradır,
yaşıl bildiriş alır, **heç nə saxlanmır.**

`"campaign"` sözü sistemdə 4 fərqli şeyi bildirir: `happy_hours` sətri, `CampaignActivation`
per-müştəri kuponu, push bildiriş mətni, və `FeedbackCoupon` rail-i.

### 4.2 Tier nərdivanı 5 yerdə, hər biri fərqli

> Audit ilk yazılanda **4 yer** sayılmışdı. P1.2-də beşincisi tapıldı: `main.py`-dakı boot
> təmiri. O, ən təhlükəlisidir, çünki panel deyil — **hər başlanğıcda müştəri datasına yazır.**

| Yer | Nə saxlayır | İdarə oluna bilir? | P1.2-dən sonra |
|---|---|---|---|
| `CustomerAppPanel.tsx:15` `CRM_MEMBER_TYPES` | golden/platinum/elite/thermos/ikram/telebe + endirim % | Yox — hardcoded | **Qəsdən qalır** — bu, avtomatik nərdivan deyil, işçinin qeydiyyatda verdiyi endirim oxu (aşağıda səbəb) |
| `src/api/crm.ts:16` `DEFAULT_TIERS` | frontend fallback nərdivanı | Yox — hardcoded | ✅ `lib/loyalty.ts::DEFAULT_LOYALTY_TIERS`-in alias-ı |
| `operations.py:4432` `DEFAULT_TIERS` | bronze 0 / silver 100 / gold 300 + multiplier | Yox — hardcoded | ✅ Python tərəfin tək mənbəyi; JS güzgüsü ilə paritet testində bağlı |
| `HomeTab.tsx:170` / `ProfileTab.tsx:77` | rəng + ad fallback-ları (bir-biri ilə ziddiyyətli) | Yox — hardcoded | ✅ `FALLBACK_TIER_COLOR` + `fallbackTierLabel()` — ziddiyyət bitdi |
| `main.py:723-751` `_repair_customer_discounts` | golden/platinum/telebe/tələbə/elite/thermos/ikram **+ vip + silver** | Yox — hardcoded, boot-da işləyir | ❌ **Açıq** — P1.6-ya (endirim yığımı) qalır |

Beləliklə "müştəri hansı səviyyədədir, nə qazanır" sualının əvvəl **beş ayrı cavab mənbəyi** var
idi. `app_settings["tiers"]` — nəzərdə tutulan tək mənbə — §3.5-ə görə yazıla bilmirdi; artıq
yazılır (P1.2) və avtomatik nərdivanın hər üç oxu yeri ondan qidalanır.

**`_repair_customer_discounts` niyə ayrıca problemdir.** `main.py` startup-da endirimi 0 olan
**bütün** müştəriləri gəzir və `customer.type`-a görə `discount_percent` yazır. İki nəticə: (a)
xəritədə `vip` (15%) və `silver` (5%) var, `CRM_MEMBER_TYPES`-də isə yox — yəni panelin heç vaxt
göstərmədiyi iki dərəcə mövcuddur; (b) admin bir müştərinin endirimini **qəsdən** 0-a salsa,
növbəti restart onu geri qaytarır. Bu, tier deyil, endirim mövzusudur — ona görə P1.2-də
toxunulmadı, P1.6-da (§4.6 endirim yığımı) həll olunmalıdır.

### 4.3 Üç ayrı rəng sistemi

1. `customer_app_settings.primary_color` / `accent_color` — paneldən yazılır, tətbiqin bir
   qismində oxunur.
2. `index.css` token layeri (`--primary`, `--accent`, `data-theme`, `data-ui-mode`) — admin/POS
   üçün, müştəri tətbiqi ilə əlaqəsi yox.
3. `HomeTab.tsx:322-347` hardcoded `#FF8B26 → #F48C24` gradient — praktikada müştərinin gördüyü
   əsas rəng, heç bir ayardan asılı deyil.

### 4.4 Loyallıq qaydaları paneldə yox, kodda yaşayır

Paneldə görünən: earn rate, min alış, ad günü, ilk alış, 2x günlər (hamısı ölü — §3.3).
Real qaydalar isə bu fayllarda hardcoded: `pos.py:714-720` (qəhvə sayı, `//10`),
`operations.py:4206` (tier hədləri), `HomeTab.tsx:704-707` (milestone adları),
`birthday_scheduler.py:232` (ad günü açarı).

### 4.5 Müştəri təcrübəsinə təsir edən ayarlar Ayarların başqa yerlərində

`SettingsPanel.tsx:1419-1439` — 21 bölmə var, **heç biri müştəri tətbiqi üçün deyil**:
`sec-profile`, `sec-email`, `sec-delivery`, `sec-print`, `sec-zreport`, `sec-interface`,
`sec-tables`, `sec-beverage`, `sec-bankfee`, `sec-finance`, `sec-yield`, `sec-security`,
`sec-staff`, `sec-qr`, `sec-feedback`, `sec-roles`, `sec-password`, `sec-users`, `sec-danger`,
`sec-ai`.

Halbuki müştərinin gördüyü şeylər bu bölmələrə səpələnib: eko-stəkan endirimi
(`sec-beverage` → İçkilər), feedback kuponu və QR (`sec-qr`, `sec-feedback`), biznes adı və
əlaqə (`sec-profile`), push açarları (env / `sec-ai` deyil, heç yer).

**Nəticə:** "Customer App Dizaynı" Ayarların bir bölməsi deyil — `AdminPanel` tabıdır
(`customerapp`). İstifadəçinin təsvir etdiyi "ayarlar → Customer App Dizaynı" yolu
**mövcud deyil.**

### 4.6 Ödəniş/endirim yığılması heç bir ekranda görünmür

Bir müştəriyə eyni anda tətbiq oluna bilən endirimlər: tier endirimi (5-100%), happy hour
endirimi, eko-stəkan endirimi, join QR başlanğıc endirimi, feedback kuponu, kampaniya
aktivasiyası. **Yekun yığımı göstərən tək ekran yoxdur** və `ikram` = 100% endirim daimi
QR kimi çap olunur, heç bir limit/təsdiq mexanizmi yoxdur.

---

## 5. Nə etmək lazımdır — prioritetlə

### P0 — Yalanları dayandır (funksiya əlavə etməmişdən əvvəl)

Bunlar yeni funksiya deyil; mövcud panelin dediyi ilə etdiyini uzlaşdırmaqdır. P0 bitmədən
P1-ə keçmək mənasızdır, çünki yeni sahələr də eyni PATCH-də itəcək.

**P0.1 — `PATCH`-i merge et.** `operations.py:2964-3003`: `cleaned = {...}` yerinə mövcud
`customer_app_settings` dəyərini oxu, `payload`-dakı açarları onun üzərinə yaz, qalanını
saxla. Bu tək dəyişiklik §3.1, §3.5, §3.6 və §3.2-nin bir hissəsini birdən həll edir.
Allow-list saxlanmalıdır (naməlum açar qəbul edilməməli), amma **göndərilməyən açar
silinməməli.**

**P0.2 — Ad günü zəncirini bağla.** ✅ **KODLANDI (2026-09-04).** `birthday_bonus_points`
kanonik açar oldu; `birthday_bonus_stars` yalnız güzgü/fallback kimi saxlanılır:

- `birthday_scheduler.py` — `_resolve_bonus()` əvvəl `birthday_bonus_points`, sonra köhnə
  `birthday_bonus_stars` oxuyur. `max(1, ...)` silindi → **0 legal dəyərdir** və "bonus
  verilməsin" mənasını daşıyır (tenant atlanır). `_resolve_points_label()` bildiriş və push
  mətnində hardcoded `★` yerinə tenant-ın `points_label`-ını işlədir.
- `operations.py` — `_canonical_birthday_bonus()` + `_has_meaningful_value()`. Normalizer
  hər iki açara **eyni** dəyəri yazır: points göndərilməyibsə köhnə stars dəyəri points-ə
  köçürülür (**lazy migrasiya**). Alembic ilə JSON data migrasiyası yazılmadı — canlı DB-də
  JSONB sətirlərini toplu UPDATE etmək daha riskli, effekt isə eynidir: hər GET/PATCH
  köhnə dəyəri kanonik açara çevirir, scheduler-də isə fallback onsuz da var.
- `src/api/settings.ts` — `canonicalBirthdayBonus()` backend güzgüsüdür (11 test halında
  Python ilə eyni nəticə). Lokal rejim də eyni davranır.
- `CustomerAppPanel.tsx` — "Ad günü bonusu avtomatik verilsin" açar/söndür düyməsi əlavə
  edildi və `birthday_enabled` artıq save payload-una daxildir. Söndürülübsə rəqəm sahəsi
  `disabled`, altında isə nəyin baş verdiyini deyən izah var.
- `tests/test_customer_birthday_reward.py` — 4 yeni test (kanonik açar, stars→points
  migrasiyası, bonus 0 → grant yox, `points_label` mətni); köhnə `★` assert-i yeniləndi.

Qalan hədəf: `birthday_bonus_stars` açarını bir buraxılışdan sonra tamamilə çıxarmaq.

**P0.3 — Ölü sahələri ya işlət, ya çıxar.** ✅ **KODLANDI (2026-09-04)** — `tiers` multiplier
istisna olmaqla (P1.1-ə keçirildi, aşağıda səbəb var).

| Sahə | Tövsiyə | Nə oldu |
|---|---|---|
| `earn_rate_per_azn`, `min_purchase_for_earn`, `first_purchase_bonus`, `double_points_days` | **İşlət** — `pos.py` accrual-ını bu ayarlardan oxutmaq (P1.1) | ✅ P1.1-də qoşuldu (keçidlər arxasında) |
| `reward_threshold` | **İşlət** — `pos.py:718-720` və `HomeTab.tsx:515` hardcoded 10-u ayardan al | ✅ 4 oxuyucu bir açarda birləşdi |
| `reward_card_style` | ~~Çıxar~~ → **İşlət** | ✅ kartın radius/blur-una bağlandı |
| `layout_preset` | ~~Çıxar~~ → **Saxla, adını dürüstləşdir** | ✅ "Sürətli başlanğıc dəstləri" |
| `background_color`, `background_image_url` | **İşlət** (asan) | ✅ tətbiq gövdəsinin fonu |
| `hero_title`, `hero_subtitle` | **İşlət** — `HomeTab.tsx:322-347` hardcoded hero mətnini əvəz et | ✅ ayardan, köhnə mətn fallback |
| `tiers` multiplier | **İşlət və ya sil** — göndərilir, tətbiq olunmur | ✅ P1.1-də işlədi (`tier_multiplier_enabled`) |

**`reward_threshold` — dörd oxuyucu, bir düstur.** Ən ciddi tapıntı burada idi: hədd oxu
yolunda (`operations.py` sessiya `next_reward_at` və reward claim) hörmət olunurdu, **yazı
yolunda isə yox** — `pos.py` accrual-ı `// 10` və `% 10` saxlayırdı, `src/api/pos.ts` isə
`/ 10`. Yəni tenant həddi 8 qoysa müştəri tətbiqdə "8" görürdü, kassada 10-luq dövrə ilə
qazanırdı. Artıq hamısı eyni funksiyanı işlədir:

- `pos.py::_reward_threshold` (yeni) — satış accrual-ı; `operations.py::_norm_int` güzgüsü.
- `operations.py` — iki oxu sahəsi `_norm_int(raw, 10, 1, 1000)`-ə keçdi. Köhnə
  `max(1, int(raw or 10))` legacy `"8.5"` dəyərində **ValueError → 500** verirdi.
- `src/lib/loyalty.ts::normalizeRewardThreshold` (yeni fayl) — `src/api/pos.ts` və
  `src/api/crm.ts` üçün tək mənbə. Ayrı fayldır ki, `crm.ts` (customer app-ın tək API
  modulu) `pos.ts` vasitəsilə `decimal.js` + finance kodunu customer bundle-ına dartmasın.

Vacib semantika: **0, mənfi və format xətası default 10-a düşür — 1-ə DEYİL.** Hədd 1 olsa
hər qəhvə pulsuz olar, yəni səhv oxuma kassanı dağıdar; 10-a düşmək sadəcə köhnə davranışdır.

**Fon (`background_color` / `background_image_url`).** `CustomerApp.tsx` gövdə fonuna bağlandı,
üç qorunma ilə: (1) backend `#0b1220`-ni "seçilməmiş" default kimi göndərir, ona görə o dəyər
sentinel sayılır və tətbiqin isti qradienti qalır — frontend onsuz da backend-in
`#facc15`/`#22d3ee` rəng default-larını bu cür saymırdı; (2) rəng yalnız **tünd temada**
tətbiq olunur, çünki işıqlı temada mətn `text-slate-900`-dır və tenant tünd rəng seçsə mətn
oxunmaz olardı; (3) şəkil inline `url(...)` içinə düşdüyü üçün hex/URL validasiyası var
(CSS injection) və şəklin üstündə tünd pərdə qoyulur ki, ağ mətnin kontrastı qalsın.

**`layout_preset` silinmədi.** Auditin ilk tövsiyəsi "çıxar" idi, amma kod oxunandan sonra
qərar dəyişdi: `applyPreset` **12 real sahəni** birdən yazır (`program_mode`, `app_name`,
`hero_title`, `hero_subtitle`, `consent_text`, `background_color`, `points_label`,
`reward_name`, `reward_description`, `reward_card_style`, `primary_color`, `accent_color`,
bəzən AI açarları). Yalan adında idi — "Hazır dizayn preset-ləri" layout mühərriki vəd
edirdi. Ad "Sürətli başlanğıc dəstləri" oldu, təsvirlər hər dəstin **hansı sahələri**
doldurduğunu yazır, `layout_preset` isə hansı düymənin seçili qaldığını yadda saxlayır.

**`reward_card_style` də silinmədi** — panelin öz ön baxışı onu artıq tətbiq edirdi və
backend `branding`-də göndərirdi; real etmək ~5 sətir oldu (radius + glass blur, HomeTab-ın
üç kart üzündə). Tenant-ın seçdiyi dəyəri silməkdənsə işlətmək düzgündür.

**`tiers` multiplier P1.1-ə keçirildi.** Bugün nə customer app-da, nə paneldə görünür (tier
redaktoru hələ yoxdur — o, P1.2-dir), yəni **heç kimə yalan demir**. Tək accrual funksiyası
yazılanda oraya girməlidir; indi yarımçıq bağlamaq iki yerdə multiplier məntiqi yaradardı.

**Ön baxış da düzəldildi (P0.4-ün bir hissəsi).** Panel `background_color`-u yalnız hero
blokuna verirdi, halbuki sahənin adı "Ümumi arxa fon rəngi"-dir. Ön baxış artıq real tətbiq
kimi bütöv gövdəyə verir və `#0b1220` sentinel qaydasını eyni cür işlədir.

**Toxunulan fayllar:** `backend/app/routers/pos.py`, `backend/app/routers/operations.py`,
`backend/tests/test_reward_threshold_setting.py` (yeni, 6 test), `src/lib/loyalty.ts` (yeni),
`src/api/pos.ts`, `src/api/crm.ts`, `src/components/customer/HomeTab.tsx`,
`src/components/CustomerApp.tsx`, `src/components/admin/CustomerAppPanel.tsx`.

**Yoxlama:** `npx tsc --noEmit` → 33 xəta (dəyişməyən baseline, sıfır yeni);
`python3 -m compileall -q app tests` → OK; hədd normalizasiyası cədvəli Python və TypeScript
tərəfində ayrı-ayrı işlədildi — 15 hal, hər ikisində eyni nəticə.

**P0.4 — Ön baxışı dürüstləşdir.** ✅ **KODLANDI (2026-09-04).** Ön baxışın üç yalanı silindi,
ölü sahələr isə nişanlandı.

**Ölü sahələrin dəqiq siyahısı.** Panelin 30 açarı bir-bir izlənildi (`backend/app` grep +
`pos.py` accrual oxusu): yalnız **dördü** heç kim tərəfindən oxunmur — `earn_rate_per_azn`,
`min_purchase_for_earn`, `first_purchase_bonus`, `double_points_days`. Onlar backend-də
yalnız default-larda və normalizer-də görünür; `pos.py:721-752` accrual-ı isə yalnız
`reward_threshold` və içki sayına baxır. Bu dördünün yanında artıq `NotAppliedBadge`
("tətbiqdə hələ işləmir", `title`-da tam izah) var, sahələr isə **redaktə edilə bilən qalır**
— dəyər saxlanılır, P1.1-də qoşulacaq. Kartın başında real qayda bir dəfə açıq yazılır:
"Hazırda POS hər içkiyə 1 ⟨points_label⟩ yazır və ⟨reward_threshold⟩ tamamlananda
1 ⟨reward_name⟩ açır. Məbləğə görə hesablama, minimum alış həddi və 2x günlər hələ
qoşulmayıb."

**Silinən üç yalan:**

| Ön baxışda nə vardı | Reallıq | Nə oldu |
|---|---|---|
| Tab bar-da 4 uydurma emoji (🏠🎁📋👤) | Tətbiqdə 5–6 tab var, adları və sırası fərqlidir (`CustomerApp.tsx:1764-1775`) | Real siyahı (`previewTabs`) + lucide ikonları; **AI tab-ı yalnız Barista/Falçı açıq olanda** — tətbiqdəki eyni şərt |
| Hero-da `registration_mode` nişanı | O ayar yalnız **qoşulma ekranını** dəyişir, ana səhifədə heç bir nişan yoxdur | Nişan silindi, çərçivənin altında "Qoşulma ekranı: …" izahına çevrildi |
| `hero_image_url` dairəvi avatar kimi | Tətbiqdə loyallıq **kartının fonudur** (`HomeTab.tsx:622-624`) | Avatar silindi, şəkil kartın fonuna qradientlə verildi; form sahəsi "Hero şəkli" → "Loyallıq kartının şəkli" (**açar adı `hero_image_url` qalır** — dəyişmək mövcud tenant dəyərlərini itirərdi) |

**Əlavə olunan:** kartda `reward_threshold`-dan qurulan möhür sırası (10-da kəsilir, qalanı
"+N" kimi) — ən təsirli ayar ön baxışda ümumiyyətlə görünmürdü.

**"Real-time" vədi də silindi.** "⚡ Dəyişikliklər real-time əks olunur" zolağı yalan idi:
tətbiqdə ayar polling-i **yoxdur** (yalnız 8 saniyəlik sifariş yeniləməsi,
`CustomerApp.tsx:481`). Yerinə: "Ön baxış siz yazdıqca yenilənir. Müştəri tətbiqi yalnız
«Yadda saxla»-dan sonra, tətbiq yenidən açıldıqda dəyişir."

**Toxunulan fayl:** `src/components/admin/CustomerAppPanel.tsx`.

**P0.5 — Tenant sızmalarını təmizlə.** ✅ **KODLANDI (2026-09-04).** Müştəriyə görünən heç bir
mətndə/şəkildə artıq başqa kafənin və ya platformanın adı yoxdur.

| Sızma | Nə idi | Nə oldu |
|---|---|---|
| Logo | `<img src="/logo.jpg" alt="Emalathhana">` — 3 yerdə (HomeTab başlığı, onboarding, sifariş uğur modalı) | `branding.logo_url`; yoxdursa ☕ ikonu (`HomeTab`) və ya heç nə (modallar) |
| Brauzer başlığı | `customer.html`-də statik `<title>Emalathhana</title>` | `customer.html` → "Loyalty Club" (neytral), üstəlik `CustomerApp` branding yüklənəndə `document.title` + favicon + apple-touch-icon-u tenant-a görə yazır |
| Platforma adı | "iRonWaves-ə yaxınsan!", "iRonWaves Loyalty", `branding.app_name \|\| 'iRonWaves'` | `brandName` (`company_name` → `app_name` → "Loyalty"); geofence başlığı isə tamamilə adsız oldu: "Yaxınlıqdasan!" |
| Geofence | `CAFE_LAT/CAFE_LNG = 40.37767, 49.84583` hardcoded | Filial koordinatlarından (`data.stores`); **ən yaxın** filial seçilir və adı bildirişdə keçir |
| Hədiyyə adı | "pulsuz Latte" hardcoded (tenant menyusunda Latte olmaya bilər) | `wallet.reward_name`; backend default-u `"Reward"` sentinel sayılır və tərcümə olunmuş "Hədiyyə" ilə əvəzlənir |

**Bir qərar dəyişdi: panelə logo yükləmə inputu QOYULMADI.** Audit "logo_url üçün panelə şəkil
yükləmə inputu" yazırdı, amma kod oxunandan sonra bu təhlükəli çıxdı: `logo_url`
`customer_app_settings`-in içində deyil, `BusinessProfile` sütunudur və
`PUT /business-profile` **bütün obyekti əvəz edir** — yalnız logo göndərmək VÖEN, ƏDV, NKA
seriya nömrəsi və fiskal açarı silərdi. Ona görə panel logonu **yalnız oxuyur** və
"Ayarlar → Biznes profili"-nə yönləndirir. Vahid yükləmə nöqtəsi P2-də (business-profile
PATCH-i yazıldıqdan sonra) qoyulacaq.

**Geofence-də mühüm davranış:** filialın koordinatı yoxdursa geofence **heç işə salınmır**.
Səhv yerdə bildiriş göndərməkdənsə heç göndərməmək düzgündür. `watchPosition` hər render-də
yenidən qurulmasın deyə effekt asılılığı koordinatları kodlayan sabit `geofenceKey`-dir.

**Qalan tək fallback:** join ekranının footer-i (`CustomerApp.tsx:1656`) tenant `app_name`
qoymayıbsa hələ "iRonWaves App v1.2.0" yazır — branding o mərhələdə hələ yüklənməmiş ola
bilər. Platforma-səviyyəli manifest ikonu (`server.js:90`, `scripts/gen_icons.py:14`,
`public/logo.jpg`) da qəsdən toxunulmadı: per-tenant manifest mexanizmi yoxdur, bu ayrı işdir.

**Toxunulan fayllar:** `customer.html`, `src/components/CustomerApp.tsx`,
`src/components/customer/HomeTab.tsx`, `src/components/customer/OrderTab.tsx`,
`src/components/admin/CustomerAppPanel.tsx`.

**P0.6 — Yerinə yetirilməyən vədləri sil.** ✅ **KODLANDI (2026-09-04).** Tətbiq artıq yalnız
backend-də **həqiqətən mövcud** olan qaydaları vəd edir.

Silinən vədlər (hamısı kassada mübahisə mənbəyi idi):

| Vəd | Niyə yalan idi |
|---|---|
| "Dostunu dəvət et, hər ikinizə ulduz!" | Referral sistemi backend-də ümumiyyətlə yoxdur — nə cədvəl, nə endpoint |
| "Səhər 11-dən qabaq sifarişə 2x ulduz!" | Saatdan asılı çarpan yoxdur; `double_points_days` ayarı da hələ heç yerdə oxunmur (P1.1) |
| "Doğum günündə pulsuz içki səni gözləyir 🎂" | Hər tenant-da göstərilirdi, halbuki `birthday_enabled` default **False**-dur |
| 3 pilləli hədiyyə nərdivanı — "Çay / Espresso" (0.3×), "Cappuccino / Latte" (0.6×), "Böyük Qəhvə + Desert" (1.0×) | Backend-də pilləli hədiyyə kataloqu yoxdur; `wallet.rewards` **tək sintetik sətirdir**. Müştəri heç vaxt ala bilmədiyi 2 hədiyyə görürdü |

`surpriseMessages` artıq sabit massiv deyil, real vəziyyətdən qurulan `useMemo`-dur: proqram
rejimi (`points` → "hər qəhvə 1 ⟨points_label⟩", `cashback` → "hər sifarişdən N% cashback"),
hədiyyəyə qalan məsafə, **`birthday_enabled` açıqsa** doğum günü sətri, **aktiv kampaniya
varsa** kampaniya sətri. Gün ərzində mətn sabit qalsın deyə indeks əvvəlki kimi tarixə
bağlıdır.

Nərdivanın yerinə tək **real** hədiyyə sətri qaldı (`⟨reward_threshold⟩★ · ⟨reward_name⟩`) və
altında `reward_description`. Nərdivan tier kataloqu gələndə (P1.2) qaytarılacaq.

**Backend-də 1 sətir dəyişiklik:** `get_customer_app_session` artıq cavabda
`birthday_enabled` göndərir — tətbiq bunu bilmədən doğum günü vədini gizlədə bilməzdi. Lokal
rejim paritetdədir (`crm.ts:494` eyni açarı verir). Əlavə açardır, mövcud testlərin heç biri
sessiya cavabının açar dəstini dəqiq yoxlamır.

**Hədiyyə mətnlərində sentinel qaydası.** Backend `reward_name` üçün `"Reward"`,
`reward_label` üçün sabit `"10 ulduza 1 pulsuz içki"` default-u göndərir. İkincisi tenant həddi
8-dirsə **yalan deyir**, ona görə hər ikisi "tenant seçməmişdir" sentineli sayılır və mətn real
həddən qurulur — bu, P0.3-dəki `#0b1220` fon sentinelinin eyni məntiqidir.

**Toxunulan fayllar:** `src/components/customer/HomeTab.tsx`,
`backend/app/routers/operations.py`.

**P0.7 — Lokal rejim səssiz uğursuzluğunu düzəlt.** ✅ **KODLANDI (2026-09-04).** Problem
auditdə yazılandan **daha genişdir** — üç bağlı defekt tapıldı, hamısı düzəldildi.

1. **Dörd funksiyanın lokal qolu yalan qaytarırdı.** `create_campaign_live` saxta id
   (`'campaign_' + Date.now()`), `update`/`delete` heç nə etmədən `{ success: true }`,
   `list_campaigns_admin_live` isə həmişə `[]`. Nəticə: panel "yadda saxlanıldı" yazırdı,
   dərhal sonra siyahı boş gəlirdi, tətbiqdə heç nə görünmürdü. Artıq dördü də `db_sim`-in
   `happy_hours` cədvəlinə **real yazır/oxuyur** — CLAUDE.md-dəki dual-mode paritetinə uyğun.
2. **Lokal rejimdə kampaniya QR-ı heç vaxt təsdiqlənə bilməzdi.** `crm.ts`-in validasiyası
   yalnız `days_of_week_json` sahəsini oxuyurdu — bu ad backend DB sütunundandır, heç bir
   lokal yazıcı onu yaratmırdı. Artıq hər lokal yazı **hər iki adı** (`days_of_week` +
   `days_of_week_json`) yazır, hər iki oxuyucu isə hər ikisini qəbul edir.
3. **Bazar günü heç bir happy hour aktiv görünmürdü.** `happy_hours.ts::get_active_happy_hour`
   `getDay()` işlədirdi (Bazar = 0), halbuki sistemin konvensiyası **B.E=1 … Bazar=7**-dir.

**Gün nömrələnməsi — bu, az qala səhv kodlanacaqdı.** Lokal `HappyHour` tipinin şərhi
"0=Sunday" yazır, ona görə ilk normalizer `0..6` yoxlayırdı. Üç mənbə əksini sübut etdi:
`operations.py:6900` (`now.weekday() + 1`), `CustomerAppPanel.tsx:894` (çip `id: 1..7`),
`TablesHappyHourPanel.tsx:132`. `0..6` filtri Bazar gününü səssizcə atardı. Normalizer artıq
`1..7` yoxlayır, köhnə `0`-ı **7-yə çevirir**, təkrarları silir və sıralayır.

**Əlavə qorunmalar:** `update`/`delete` sətri `id` **+ `tenant_id`** ilə birlikdə axtarır —
super_admin tenant dəyişdirəndə başqa tenant-ın kampaniyasını təsadüfən yazmasın; lokal oxu
backend-in `created_at desc` sıralamasını təkrarlayır (`operations.py:4503`); cavab formaları
`operations.py:4658-4668` ilə sahə-sahə tutuşdurulub.

**Toxunulan fayllar:** `src/api/settings.ts`, `src/api/crm.ts`, `src/api/happy_hours.ts`.

### P0 yoxlaması (P0.4–P0.7, 2026-09-04)

- `npx tsc --noEmit -p tsconfig.json` → **33 xəta** = dəyişməyən baseline, **sıfır yeni**;
  toxunulan fayllarda xəta yoxdur.
- `python3 -m compileall -q app tests` → OK.
- `npm run build` bu mühitdə işləmir (node_modules darwin-arm64 → `@rollup/rollup-linux-arm64-gnu`
  tapılmır), `pytest` isə quraşdırılmayıb — ona görə testlərə təsir **əl ilə** yoxlanıldı:
  sessiya cavabına əlavə edilən `birthday_enabled` açarı additivdir, test bazasında sessiya
  cavabının açar dəstini dəqiq yoxlayan assert yoxdur (`set(...keys())` / `sorted(...keys())`
  axtarışı boşdur).
- Lokal/backend paritet yoxlaması: `birthday_enabled` hər iki qolda göndərilir.

### P1 — Çatışmayan tək-mənbə nəzarətləri

**P1.1 — Konfiqurasiya edilə bilən accrual mühərriki.** ✅ **KODLANDI (2026-09-04).**
`pos.py`-dakı hardcoded "1 qəhvəyəbənzər içki = 1 ulduz" məntiqi ayarlardan oxuyan tək
funksiyaya çıxdı: `backend/app/services/loyalty_accrual.py::compute_points_earned` və onun
frontend güzgüsü `src/lib/loyalty.ts::computePointsEarned`. Router-dən ayrı modul olması
qəsdəndir — testlər FastAPI/DB qaldırmadan onu import edə bilir.

**Hesablama sırası (iki tərəfdə eyni olmalıdır — sıra dəyişsə nəticə dəyişir):**

1. minimum məbləğ yoxlanışı → keçmirsə qazanma 0 (ilk alış bonusu da verilmir)
2. baza: `per_drink` → içki sayı; `per_azn` → `floor(məbləğ × dərəcə)`
3. baza 0-dırsa dayan — 2x və multiplier sıfırı çoxalda bilmir
4. 2x gün → baza ×2
5. tier multiplier → `floor(× multiplier)`
6. ilk alış bonusu → düz üstünə gəlir (çoxaldılmır)
7. `MAX_EARN_PER_SALE = 10000` ilə kəsilir

Hər addımda **aşağıya yuvarlaqlaşdırma** var (kəsr ulduz yoxdur) və funksiya heç bir halda
exception atmır — satış axını bir ayar sətrindəki yazı səhvinə görə 500 verməməlidir.

**Üç yeni keçid — hamısı sönülü başlayır.** Buraxılışın ən vacib qərarı budur: mövcud
tenant-ların blobunda oturan defaultlar zərərsiz **deyil** (`earn_rate_per_azn=2.0`,
`first_purchase_bonus=5`, `gold.multiplier=1.5`). Sahələri qapısız qoşmaq hər tenant-ı
səssizcə "1 içki = 1 ulduz"-dan "1 AZN = 2 ulduz"-a keçirərdi — 5 AZN latte = 10 ulduz =
default 10 həddində dərhal pulsuz qəhvə.

| Keçid | Default | Nəyi açır |
|---|---|---|
| `earn_basis` | `per_drink` (köhnə davranış) | `per_azn` seçilsə `earn_rate_per_azn` işə düşür |
| `first_purchase_bonus_enabled` | `false` | `first_purchase_bonus` (maks 1000) |
| `tier_multiplier_enabled` | `false` | tier sətrinin `multiplier`-i (maks ×10) |

`min_purchase_for_earn` (default 0) və `double_points_days` (default boş) öz defaultlarında
onsuz da təsirsizdir — onlara ayrı keçid lazım deyil. Precedent: P0.2-nin `birthday_enabled`.
Üç açar hər iki normalizerdə var (`operations.py:3169-3171`, `src/api/settings.ts:601-603`).

**Float tələsi — niyə JS tərəf tam ədəd miqyasında işləyir.** Python `Decimal` işlədir, JS-də
isə `0.3 * 10` → `2.9999999999999996` və `floor` 3 yerinə **2** qaytarır. Ona görə `loyalty.ts`
bütün vurmaları tam ədəd miqyasında aparır (məbləğ → qəpik, dərəcə/çarpan → ×10⁴; normalizer
onsuz da 4 onluğa yuvarlaqlaşdırır). Eyni tələ **panel ipucu mətnində də** var idi: dərəcə
sahəsinin altındaki "12 AZN → N ulduz" hinti ilk yazılışda `Math.floor(12 * rate)` idi —
artıq o da mühərriki çağırır.

**Tier axtarışı bir qayda oldu.** `find_tier_multiplier` (`loyalty_accrual.py`) və
`findTierMultiplier` (`loyalty.ts`) `operations.py::_compute_tier` ilə **eynidir**: `key`-i
olmayan sətirlər atılır, `threshold`-a görə artan sıralanır, `lifetime_stars`-dan böyük olmayan
sonuncu sətir götürülür, heç biri uyğun gəlməsə ən aşağı pillə. Qaydalar ayrılsaydı tətbiq
"Gold ×1.5" göstərib kassa ×1 sayardı. Keçid yoxlanışı (`tier_multiplier_enabled`) bu
funksiyada deyil — xam dəyər buradan çıxır, `resolve_tier_multiplier`-dən keçir.
Üç nüsxənin tam birləşməsi P2-də qalır.

**Gün nömrələnməsi.** Hər yerdə **B.E=1 … Bazar=7**; köhnə saxlanmış `0` **7-yə çevrilir**,
atılmır (P0.7 tapıntısı — lokal `HappyHour` tipindəki "0=Sunday" şərhi yanlışdır).

**Ledger artıq `points` rejimində də yazılır — §3.11 bağlandı.** `pos.py::create_sale` üç
`unit="points"` sətri yazır (`:1084`, `:1099`, `:1132`): qazanma (təsviri
`accrual.describe()` verir, məsələn `Points earn (per drink, base 2, 2x day, tier +2, first
purchase +5)`), pulsuz içki güzəşti (`Free drink redeem x{n} ({spent} points)`) və xal
xərcləyən hədiyyə claim-i (`points_cost > 0` şərti ilə). Təsvir mətni qəsdən İngiliscədir və
iki rejimdə **eynidir** — fərqlənsə hesabat qruplaşdırması pozular. Push mətni də hardcoded
`★` yerinə tenant-ın `points_label`-ını işlədir.

**Panel artıq yalan demir.** P0.4-də dörd sahəyə qoyulmuş "tətbiqdə hələ işləmir" nişanı
(`NotAppliedBadge`) silindi — dördü də canlıdır. Yerinə **"Effektiv qayda"** xülasəsi gəldi və o,
POS-un işlətdiyi **həmin mühərriklə** hesablanır: `3 içki / 12.00 AZN → N ulduz`, minimum
bloklayırsa və ya bugün 2x günüdürsə əlavə qeyd, ilk alış və ən yüksək tier üçün ayrı sətirlər.
Panelin öz düsturu olsaydı P0.4-də təmizlədiyimiz "saxta vəd" problemi başqa formada geri
qayıdardı. Tier nərdivanı orada hələlik **yalnız oxunur** (redaktə P1.2); `save()` `tiers`
göndərmir — endpoint merge işlədiyi üçün nərdivan olduğu kimi qalır.

**P1.1 yoxlaması (2026-09-04).**

- `backend/tests/test_loyalty_accrual.py` — **24/24 keçir**. Ən vacibi
  `test_shipped_defaults_change_nothing_without_gates`: real defaultlarla + `weekday=6` +
  `is_first_purchase=True` + `tier_multiplier=1.5` nəticə hələ də **3 ulduz**, yəni köhnə davranış.
- **Python ↔ JS pariteti: 4000 hal, 0 fərq.** Seed sabit, dəyərlər qəsdən düşmən: `"abc"` /
  `True` / `-5` / `5000` dərəcələr, `"false"` / `"0"` / `"off"` / `None` keçidləri, `[0]` /
  `[8,-1]` / `"1,2"` gün massivləri, `None` / `""` / `"abc"` / `"123.456"` məbləğlər, açarsız və
  zibil tier sətirləri. Hər halda `earned`, `base`, `doubleDayApplied`, `tierBonus`,
  `firstPurchaseBonus`, `blockedByMinimum`, `capped`, `basis`, `describe()` mətni və
  `findTierMultiplier` tutuşdurulub. Bu paritet olmasa lokal rejim ilə canlı rejim fərqli sayardı.
- `npx tsc --noEmit -p tsconfig.json` → **33 xəta** = dəyişməyən baseline; toxunulan fayllarda
  (`CustomerAppPanel.tsx`, `src/api/pos.ts`, `src/lib/loyalty.ts`, `src/api/settings.ts`,
  `src/types/pos.ts`) sıfır xəta.
- `python3 -m compileall -q app tests` → OK.
- `lifetime_stars` `pos.py`-da **tək yerdə** mənimsənilir (`:1075`) — ikiqat sayma yoxdur; ona görə
  `test_customer_tier_system.py:228` (`42 = 40 + 2`) qapılar sönülü olduğu üçün qüvvədə qalır.
  `customer_program` həmişə dict-dir (`:727-728`-dəki mövcud `.get()` çağırışları bunu sübut edir),
  ona görə yeni `resolve_first_purchase_bonus(...)` / `.get("points_label")` çağırışları yeni
  `AttributeError` yolu açmır.
- **Bu mühitdə icra OLUNMAYAN:** `fastapi` və `pytest` quraşdırılmayıb, `npm run build` /
  `npm run test:smoke` isə `node_modules` darwin-arm64 olduğu üçün işləmir. Router səviyyəli
  testlər (`test_customer_tier_system.py`, `test_customer_birthday_reward.py`) CI-də yoxlanmalıdır.

**Toxunulan fayllar:** `backend/app/services/loyalty_accrual.py` (yeni),
`backend/tests/test_loyalty_accrual.py` (yeni), `backend/app/routers/pos.py`,
`backend/app/routers/operations.py`, `src/lib/loyalty.ts`, `src/api/pos.ts`,
`src/api/settings.ts`, `src/types/pos.ts`, `src/components/admin/CustomerAppPanel.tsx`.

**P1.2 — Tier redaktoru.** ✅ **KODLANDI (2026-09-04).** Panelə cədvəl: ad (3 dil), hədd, rəng,
endirim %, multiplier. Yazma yeri tək oldu — `app_settings["tiers"]`. `crm.ts:DEFAULT_TIERS`,
`HomeTab`/`ProfileTab` fallback-ları bu mənbədən oxuyur; `CRM_MEMBER_TYPES` **qəsdən** qaldı
(səbəb aşağıda). "Faydalar mətni" (`benefits`) də qəsdən əlavə edilmədi.

**P1.2a — defaultlar dilə görə tək mənbəyə yığıldı.** Əvvəl nərdivanın defaultu dörd yerdə
yaşayırdı (§4.2). Artıq JS tərəfdə **bir** yer var: `src/lib/loyalty.ts` →
`DEFAULT_LOYALTY_TIERS`, `MAX_LOYALTY_TIERS = 12`, `FALLBACK_TIER_COLOR` (= ən aşağı pillənin
rəngi), `fallbackTierLabel(lang)`, `cloneDefaultLoyaltyTiers()`. `crm.ts:16` indi sadəcə alias-dır,
`HomeTab.tsx:170` və `ProfileTab.tsx:77` isə eyni sabitləri import edir — əvvəl iki ekran
bir-biri ilə ziddiyyətli fallback rəng/ad işlədirdi. Python tərəfdə tək mənbə
`operations.py::DEFAULT_TIERS`-dir; `FALLBACK_TIER_COLOR` və `MAX_CUSTOMER_APP_TIERS` ondan
törəyir. `lib/loyalty.ts` bilərəkdən **asılılıqsızdır** (`decimal.js` yox) — yoxsa
`npm run build:customer` tək-fayl bundle-ına maliyyə modulları düşərdi.

**P1.2b — panel redaktoru.** Nərdivan bloku: sətir başına açar, 3 dil adı, hədd, rəng seçici,
multiplier, endirim %; sətir əlavə/sil/yuxarı-aşağı; "defaultlara qaytar"; sətir sayğacı
(`n / 12`). Üç şey bu bloku panelin qalanından fərqləndirir:

- **"Server nə saxlayacaq" ön baxışı.** Blokun altında `normCustomerAppTiers(tiers)`-in nəticəsi
  göstərilir — yəni admin save-dən **əvvəl** görür ki, sətirlər hədd üzrə sıralanacaq, ən aşağı
  pillə 0-a düşəcək, açarı boş sətir atılacaq.
- **Xəbərdarlıqlar, gizlətmə yox.** Təkrar açar (backend dedup **etmir**), boş açar, ən aşağı
  həddin 0 olmaması — hər biri ayrı bildiriş. Panel səhvi düzəltmir, göstərir.
- **Boş massiv heç vaxt göndərilmir.** `_norm_customer_app_tiers([])` defaultlara **qaytarır**,
  yəni GET uğursuz olub state boş qalsa və panel save etsə tenant-ın nərdivanı bir klikdə
  silinərdi. `save()` `tiers`-i yalnız `tiers.length > 0` olanda payload-a qoyur; PATCH merge
  üst-səviyyə açar granulyarlığında olduğu üçün göndərilməyən açar toxunulmamış qalır.

**P1.2c — `discount_percent` dürüst nişanlandı.** Sahə saxlanılır və normalizə olunur, amma
**heç bir kassa yolu onu oxumur** (endirim yığımı P1.6-dır). P0.4 disiplinini pozmamaq üçün
`NotAppliedBadge` yalnız **bu bir sahəyə** qaytarıldı — P1.1-də dörd qazanma sahəsindən silinmiş
nişanın yenidən görünən tək yeri. Sahəni tamamilə çıxarmaq alternativi rədd edildi: dəyər blobda
onsuz da mövcuddur (`DEFAULT_TIERS`-də `0.0`), gizlətsək admin onu redaktə edə bilməzdi, amma
P1.6-da səssizcə qüvvəyə minərdi.

**P1.2d — testlər və güzgü auditi.** Nərdivan **tək blobda** saxlanılır və beş yerdən oxunur:
`_norm_customer_app_tiers` (yazma), `_compute_tier` (tətbiqin gördüyü),
`loyalty_accrual.find_tier_multiplier` (kassanın işlətdiyi), və bunların JS güzgüləri
`settings.ts::normCustomerAppTiers` + `crm.ts::computeTier`. Hər güzgü **əl ilə yazılmış**
nüsxədir, ona görə drift avtomatik aşkarlanmır: lokal rejim ilə canlı rejim eyni tenant üçün
fərqli dəyər saxlaya/göstərə bilər. `backend/tests/test_customer_app_tiers.py` (yeni) normalizerin
hər qaydasını — nə atılır, nə kəsilir, nə çevrilir — və "göstərilən çarpan == işlənən çarpan"
invariantını yazıya alır.

**Ölçülmüş 8 real fərq — hamısı bağlandı.** Bunlar nəzəri deyil, paritet qoşqusunun tapdığı
fərqlərdir:

| # | Fərq | Nəticə (istifadəçi gözü ilə) | Düzəliş |
|---|---|---|---|
| 1 | `normText`/`normHex` truthiness: JS `0` / `false` dəyərini mətn sayırdı | Adı `0` olan pillə iki rejimdə fərqli adlanırdı | JS Python-a uyğunlaşdı (açara düşür) |
| 2 | Hədd: JS `Math.round`, Python `int(float(x))` | `150.7` → JS 151, Python 150 → sıra dəyişə bilirdi | JS `Math.trunc` |
| 3 | Float yuvarlaqlaşdırma: Python `round()` bank qaydası, JS `toFixed` yox | 200 001 dəyərdən **19 236-sı** fərqlənirdi | JS-ə `round4HalfEven()` |
| 4 | `multiplier: 0` → `float(x or 1)` 1 verirdi, accrual 0 sayırdı | Tətbiq ×1 göstərir, kassa qazanma vermir | İki tərəfdə `0` qanuni dəyər |
| 5 | `_norm_customer_app_tiers`-də sərt `maximum=10.0` | Hədd accrual-dan ayrıla bilərdi (üçüncü nüsxə) | `MAX_TIER_MULTIPLIER` import olundu |
| 6 | `_compute_tier` həddi **üç fərqli qayda** ilə oxuyurdu (sıralamada clamp-lı, müqayisədə xam, `next_threshold`-da xam) | Legacy/normalizasiyasız blobda tətbiq və panel fərqli pillə seçirdi; `int("300.5")` / `int([])` isə **exception atırdı** — oxu yolunda 500 | Yeni `_tier_threshold()` — oxuma **yazma qaydasının eynisi** |
| 7 | `progress_pct` mənfi ola bilirdi | Faiz birbaşa CSS eninə gedir — zolaq sıçrayırdı | İki tərəfdə 0..100 clamp |
| 8 | Mənfi ulduz balansı: accrual `_floor_int` ilə 0 sayır, oxucular xam işlədirdi | Bərabər hədli nərdivanda tətbiq birinci sətri (×1), kassa sonuncunu (×3) seçirdi | İki oxucuda da `max(0, …)` |

Əlavə olaraq `crm.ts::computeTier`-in `threshold()` köməkçisi `_norm_int`-in **bool rədd etməsini**
də təkrarladı (`Number(true)` 1 verir, Python bool-u "yoxdur" sayır) və 1e6 həddini aldı.

**Qəsdən edilməyənlər — səbəbi ilə:**

| Nə | Səbəb |
|---|---|
| `benefits` (faydalar mətni) sahəsi | Müştəri tətbiqində onu göstərən **heç bir yer yoxdur**. Göstərilməyən sahəni saxlamaq P0.4 disiplininin (nişansız ölü sahə olmasın) pozulmasıdır. Hədiyyə kataloqu (P1.3) gələndə faydaların təbii yeri orada olacaq |
| `CRM_MEMBER_TYPES`-in `tiers`-ə birləşdirilməsi | Bunlar **iki fərqli ox**dur: `tiers` ulduz sayına görə **avtomatik** qalxır, `CRM_MEMBER_TYPES` isə işçinin qeydiyyatda **əl ilə** verdiyi endirim kartıdır (`ikram` = 100%!). Birləşdirmə pul qərarıdır — P1.6/P2 |
| `main.py::_repair_customer_discounts` xəritəsi | Tier deyil, endirim mövzusu; üstəlik boot-da müştəri datasına yazır (§4.2) → P1.6 |
| `tier_multiplier_enabled` sönülü olanda panelin çarpanı göstərməsi | **Qəsdən asimmetriya** (P1.1b geriyə uyğunluq qapısı): kassa 1 işlədir, panel nərdivanın dəyərini göstərir. Ona görə panel keçidin vəziyyətini də göstərir, test isə bunu yazıya alır (`test_gate_off_means_no_tier_bonus`) |

**P1.2 yoxlaması (2026-09-04).**

- `backend/tests/test_customer_app_tiers.py` — **204 assertion, 0 uğursuz.** `pytest` bu mühitdə
  yoxdur, ona görə fayl mini-qoşqu ilə işlədildi: `loyalty_accrual` birbaşa `importlib`-lə yüklənir,
  `operations.py` isə `ast` ilə dilimlənib exec olunur (fastapi qaldırmadan **real** kod işləyir),
  `pytest.mark.parametrize` təqlid olunur. Fayl özü **CI-da** normal pytest ilə də keçməlidir.
- **Normalizer pariteti: 45 struktur halı + 200 001 dəyərlik süpürgə + 10 000 təsadüfi dəyər →
  0 fərq.** Süpürgə 0..10 aralığını 5 onluqlu addımla gəzir (çarpan sahəsinin aralığı), təsadüfi
  dəst isə bütün float ayarlarının aralıqlarını (endirim 0..100, dərəcə 0..1000, məbləğ 0..100000)
  sabit seed ilə vurur.
- **Oxu pariteti: 529 hal (nərdivan × ulduz kombinasiyası), üç qapı, 0 fərq.** Qapılar: (a)
  `_compute_tier` ↔ `crm.ts::computeTier` — `key`, `multiplier`, `current_threshold`,
  `next_threshold`, `progress_pct`; (b) xam tapıcı `find_tier_multiplier` ↔ `findTierMultiplier`;
  (c) **göstərilən == işlənən** — `_compute_tier(...)["multiplier"]` ↔
  `resolve_tier_multiplier(keçid açıq, find_tier_multiplier(...))`. Nərdivanlar qəsdən düşmən:
  normalizasiyasız, mənfi/onluq/bool/zibil hədlər, sıralanmamış, ən aşağısı 0 olmayan, bərabər
  hədli, təkrar açarlı. Ulduz dəstinə `-5` daxildir.
- `npx tsc --noEmit -p tsconfig.json` → **33 xəta** = dəyişməyən baseline. Toxunulan fayllarda
  yalnız `settings.ts(2148,7)` / `(2151,7)` `TS18048` — hər ikisi P1.2-dən **əvvəl də var idi**.
- `python3 -m compileall -q app tests` → OK.
- **Bu mühitdə icra OLUNMAYAN:** `npm run build` / `npm run test:smoke` (node_modules
  darwin-arm64 → esbuild "Exec format error"), `pytest`, `fastapi`. Router səviyyəli tier testi
  (`test_customer_tier_system.py`) CI-də yoxlanmalıdır.

**Toxunulan fayllar:** `backend/app/routers/operations.py`,
`backend/tests/test_customer_app_tiers.py` (yeni), `src/lib/loyalty.ts`, `src/api/crm.ts`,
`src/api/settings.ts`, `src/types/pos.ts`, `src/components/admin/CustomerAppPanel.tsx`,
`src/components/customer/HomeTab.tsx`, `src/components/customer/ProfileTab.tsx`.

**P1.3 — Hədiyyə kataloqu.** ✅ **KODLANDI (2026-09-05).** Tək "ad + hədd" cütü yerinə çoxsətirli
kataloq: hər sətirdə id, üç dildə ad və açıqlama, qiymət (xal), menyu məhsuluna bağlantı,
aktiv/deaktiv keçidi və stok limiti. Kataloq `customer_app_settings.rewards` blobunda yaşayır;
maksimum **20 sətir**, qiymət və stok həddi 1..1 000 000.

**Auditin ilkin fərziyyəsi düzəldildi.** Bu bənd əvvəl `HomeTab.tsx:704-707`-dəki "hardcoded
milestone nərdivanı"na istinad edirdi. O nərdivan P1.3-ə qədər **artıq yox idi**: **P0.6** üç
uydurma pilləni ("Çay / Espresso" 0.3×, "Cappuccino / Latte" 0.6×, "Böyük Qəhvə + Desert" 1.0×)
silmiş və yerində "kataloq gələndə nərdivan qayıdacaq" şərhini qoymuşdu. Yəni P1.3g mövcud
hardcoded nərdivanı **əvəz etmək** deyil, silinmiş nərdivanı **real kataloq datası üzərində geri
qaytarmaq** oldu.

**P1.3a — backend normalizer və defaultlar** (`operations.py:3107+`). `_norm_reward_id` (slug,
defis qalır, 32 simvol), `_norm_i18n_text` (üç dil, `ru`/`en` boş qalanda `az`-dan düşür),
`_norm_customer_app_rewards` (sətir təmizləmə, dedup, sıralama, limit). Yeni sabitlər:
`MAX_CUSTOMER_APP_REWARDS = 20`, `MAX_REWARD_POINTS_COST = MAX_REWARD_STOCK_LIMIT = 1 000 000`,
`LEGACY_REWARD_ID = "default-reward"`. **Default kataloq boşdur** — yeni tenant köhnə tək hədiyyə
ilə başlayır, ona görə heç bir tenant üçün miqrasiya lazım deyil.

İki qayda qəsdən `tiers`-dən **fərqlidir** və testlərdə kilidlənib:

| Qayda | `tiers` | `rewards` | Səbəb |
|---|---|---|---|
| Boş massiv | "defaultlara qaytar" | **"kataloq yoxdur"** (köhnə tək hədiyyə işləyir) | Əks semantika olmasa panel kataloqu heç vaxt boşalda bilməzdi |
| Təkrar açar/id | sadəcə xəbərdarlıq | **sətir atılır** (İLK qalır, ucuz olan deyil) | Verilmiş claim kodları `reward_id` ilə bağlanır; iki eyni id qalsa kod hansı sətrə aiddir bilinməz |

**P1.3b — JS güzgüsü.** `normCustomerAppRewards`, `resolveRewardCatalog`, `buildRewardWalletRows`
`src/lib/loyalty.ts`-də (`settings.ts`-də DEYİL) — `crm.ts` bu faylı `decimal.js`/`db_sim`/`client`
qaldırmadan import etməlidir, yoxsa `npm run build:customer` tək-fayl paketi finansı da içinə çəkir.

**P1.3c — sxem** (`models.py:597`, `alembic/versions/20260905_0001`, `main.py:1101`).
`reward_claims`-ə iki nullable sütun: `reward_id` (VARCHAR 32, indeksli) və `menu_item_id`
(VARCHAR 36). **FK yoxdur** — kataloq JSON blobundadır. `NULL` = kataloqdan əvvəl verilmiş köhnə
claim. `menu_item_id` claim sətrinə **köçürülür**: kataloq sətri sonradan silinsə də verilmiş kod
öz məhsulunu saxlayır.

**P1.3d — oxu yolu və claim.** `_reward_catalog` effektiv kataloqu qaytarır (boşdursa köhnə üç
ayarı **sintetik** `default-reward` sətrinə çevirir), `_reward_stock_used` stoku `RewardClaim`
sətirlərindən sayır (status PENDING və REDEEMED, yalnız `stock_limit > 0` olan sətirlər üçün),
`_reward_catalog_payload` isə `wallet.rewards`-u qurur. **Stok blobda saxlanılmır, hər dəfə
hesablanır** — limiti aşağı endirmək artıq verilmiş kodları ləğv etmir, sadəcə yenisini bağlayır.
`claim_customer_reward` artıq `reward_id` qəbul edir; boş gəlirsə ən ucuz açıq sətir seçilir.

**P1.3e — kassa (`pos.py:816`).** Claim sətri məhsula bağlıdırsa endirim səbətin ən ucuz sətrinə
deyil, **məhz o məhsula** düşür. Uyğunluq **ada görə** yoxlanılır, çünki `SaleItemIn`-də menyu
id-si yoxdur (offline replay-lər köhnə payload ilə gəlir) — fayldaki `Recipe`/`InventoryItem`
axtarışları da eyni konvensiyanı işlədir. Bağlı məhsul menyudan silinibsə köhnə davranışa (ən ucuz
sətir) düşülür: **kassir gözləyən kodu heç vaxt "yandırmamalıdır"**. Səbətdə tələb olunan məhsul
yoxdursa 400 və konkret mətn: «Bu hədiyyə «X» üçündür — səbətdə o məhsul yoxdur».

**P1.3f — panel redaktoru** (`CustomerAppPanel.tsx:1512`). Sətir başına: id (avtomatik `reward-N`),
3 dil adı, açıqlama, qiymət, menyu seçicisi, aktiv keçidi, stok limiti, sil/əlavə et. Kataloqun
"server nə saxlayacaq" ön baxışı (P0.4 disiplini) və üç xəbərdarlıq: aktiv sətir yoxdur,
`reward_threshold` ən ucuz aktiv sətirdən fərqlidir, 20 sətir həddi aşılıb. **Boş massiv də
göndərilir** (`tiers`-dən fərqli) — ona görə mühafizə `rewards.length` deyil, boolean
`rewardsLoaded`: GET uğursuz olanda PATCH kataloqu silməsin.

**P1.3g — müştəri nərdivanı** (`HomeTab.tsx:333, 833`). Sətirlər yalnız `wallet.rewards`-dandır;
uydurma pillə yoxdur. Sətir başına: qiymət + ad, bağlı məhsulun adı, «Bitdi» (stok 0), «son N»
(≤3), `×N` (bir dəfədən çox açıqdır), «N ulduz qaldı» və **öz "Al" düyməsi**. 5 sətirdən sonra
yerində açılır — `setActiveTab('stars')` **yoxdur**, çünki `CustomerTab`-da belə tab yoxdur
(`(tab: any) => void` tipi bunu tsc-dən gizlədirdi). Böyük "Tətbiq et" düyməsi **ən ucuz açıq**
sətri alır və birdən çox sətir olanda hansını aldığını yazır.

**P1.3h — testlər və paritet.** `backend/tests/test_customer_app_rewards.py` (yeni) normalizerin,
effektiv kataloqun və payload düsturunun hər qaydasını yazıya alır. `_reward_stock_used` DB tələb
etdiyi üçün onun nəticəsi `stock_used` dict-i kimi əl ilə verilir — payload düsturu elə bu dict-in
üstündə işləyir.

**Paritet: 0 real fərq.** P1.2-dən fərqli olaraq burada güzgü Python ilə **eyni sessiyada** eyni
spesifikasiyaya yazıldı, ona görə qoşqu drift tapmadı (P1.2-də 8 fərq çıxmışdı). Qoşqu bundan sonra
**reqressiya qapısıdır**. Paritet **çatmayan** üç hal sənədləşdirilib və fuzz hovuzundan çıxarılıb,
çünki düzəltmək bir dilin digərinin stringify qaydasını təqlid etməsini tələb edərdi:

| Zibil giriş | Python | JS | Nəticə |
|---|---|---|---|
| skalyar sahəyə dict/massiv (`id`, `menu_item_id`) | `str({'az':'A'})` → `"aza"` | `String({…})` → `"objectobject"` | sətir birində atılır, digərində qalır |
| `title`/`description` yerinə massiv | `"[1, 2]"` | `"1,2"` | fərqli ad |
| `active: []` / `{}` | `bool([])` → **False** | `Boolean([])` → **true** | sətir birində deaktiv |

Bunlar yalnız **korlanmış blob** ilə mümkündür (panel id-ni sətir, `active`-i checkbox, qiyməti
rəqəm yazır). **Boş massiv** isə hər iki dildə falsy/NaN verir — bu uyğunluq təsadüfi olmasın deyə
ayrıca adlı case-lərlə kilidlənib (`qiymət [] -> 10`, `stok [] -> 0`, `menu_item_id [] -> boş`).

**Qəsdən edilməyənlər — səbəbi ilə:**

| Nə | Səbəb |
|---|---|
| `wallet.next_reward_at` kataloqun ən ucuz sətrinə bağlanması | `pos.py` **hələ də** `stars // reward_threshold` ilə avtomatik pulsuz içki verir. `next_reward_at`-i kataloqa bağlasaq tətbiq bir rəqəm göstərər, kassa başqasını işlədər. Ona görə dəyər `reward_threshold` qalır, panel isə ən ucuz aktiv sətir fərqlənəndə **xəbərdarlıq** göstərir. Birləşdirmə P2-dir |
| `available_rewards`-ın mənasının dəyişməsi | Köhnə tətbiq versiyaları bu rəqəmi oxuyur: **ən ucuz sətirdən neçə dəfə** (max over rows). Yeni sayğac ayrı açardır — `unlocked_rewards` = açıq **fərqli** sətir sayı |
| Stokun bloba yazılması | Sayğac blobda olsa iki paralel claim onu üst-üstə yazar (`PATCH` bütün açarı əvəz edir, §3.1). Ona görə stok hər oxunuşda `RewardClaim`-lərdən sayılır |
| Kataloq sətrinə `benefits` mətni (P1.2d-dən köçən) | Kataloq sətrinin açıqlaması onsuz da üç dildədir və müştəri tətbiqində **görünür**; ayrıca "faydalar" sahəsi yenə göstərilməyən ölü sahə olardı |
| `cashback` rejimində claim yoxlamasının xal kifayətliliyini yoxlamaması | Mövcud (P1.3-dən əvvəlki) davranışdır: `cashback` rejimində balans manat kimi saxlanılır, claim isə ulduz həddi ilə müqayisə edir. Bu **ayrı** defektdir və endirim/valyuta qərarı tələb edir → **P1.6** |

**P1.3 yoxlaması (2026-09-05).**

- `backend/tests/test_customer_app_rewards.py` — **79 test halı, 0 uğursuz.** `pytest` bu mühitdə
  yoxdur, ona görə fayl mini-qoşqu ilə işlədildi: `operations.py` `ast` ilə dilimlənib exec olunur
  (fastapi qaldırmadan **real** kod işləyir), `loyalty_accrual` `importlib`-lə yüklənir,
  `pytest.mark.parametrize` təqlid edilir. Fayl özü **CI-da** normal pytest ilə də keçməlidir.
- **Paritet: 512 hal, 0 fərq.** Üç qapı: `_norm_customer_app_rewards` ↔ `normCustomerAppRewards`
  (57 adlı hal + 140 fuzz), `_reward_catalog` ↔ `resolveRewardCatalog` (14 + 140),
  `_reward_catalog_payload` ↔ `buildRewardWalletRows` (22 + 140). JS tərəf `src/lib/loyalty.ts`-dən
  kəsilib `npx tsc` ilə kompilyasiya olunur və `node` ilə eyni case-lərdə işlədilir. Fuzz hovuzu
  **sahə üzrə tipləşdirilmişdir** (yuxarıdaki cədvəl), seed sabitdir.
- `npx tsc --noEmit -p tsconfig.json` → **33 xəta** = dəyişməyən baseline. Toxunulan fayllarda
  yalnız `settings.ts(2164,7)` / `(2167,7)` `TS18048` (device authorization bloku) — hər ikisi
  P1.3-dən **əvvəl də var idi**.
- `python3 -m compileall -q app tests` → OK.
- **Bu mühitdə icra OLUNMAYAN:** `npm run build` / `npm run test:smoke` (node_modules
  darwin-arm64 → esbuild "Exec format error"), `pytest`, `fastapi`. Router səviyyəli claim testi
  (`test_customer_reward_claim_flow.py`) və `alembic upgrade head` CI-də yoxlanmalıdır.

**Toxunulan fayllar:** `backend/app/routers/operations.py`, `backend/app/routers/pos.py`,
`backend/app/models.py`, `backend/app/main.py`,
`backend/alembic/versions/20260905_0001_add_reward_claim_catalog_link.py` (yeni),
`backend/tests/test_customer_app_rewards.py` (yeni), `src/lib/loyalty.ts`, `src/api/crm.ts`,
`src/api/settings.ts`, `src/api/pos.ts`, `src/types/pos.ts`,
`src/components/admin/CustomerAppPanel.tsx`, `src/components/CustomerApp.tsx`,
`src/components/customer/HomeTab.tsx`.

**P1.4 — Push bildiriş idarəsi.** ✅ **KODLANDI (2026-09-05).** Əvvəl push tamamilə platforma
env-inə bağlı idi: tenant `onesignal_app_id` yaza bilmirdi (§3.6), göndərici `pos.py`-nin içində
qlobal açarlarla işləyirdi və **bütün exception-ları udurdu**. Ən pis hal səssiz idi — tenant öz
OneSignal app-ını yazsa SDK abunəliyi **onun** app-ında yaranır, server isə **platforma** app-ına
göndərirdi: OneSignal `invalid_player_ids` qaytarır, göndərici susur, ad günü schedulerindəki
`notified` sayğacı isə "cəhd"i uğur kimi sayırdı.

**P1.4a — saf nüvə** (`app/services/push_service.py`, yeni). `resolve_push_config` `app_id` və
REST açarını **bir mənbədən** götürür (ya tenant, ya platforma) — qarışıq cüt heç vaxt qurulmur;
tenant App ID var, açar boşdursa `source="none"` və `app_id=""` qaytarılır ki, panel "yarım
konfiqurasiya var" deyə aldanmasın. `resolve_client_app_id` SDK-nın init edəcəyi id-ni **eyni
prioritetlə** verir (fərqli olsa abunəlik bir app-da yaranıb göndərmə başqasına gedər).
`send_onesignal` `PushResult` qaytarır (`attempted` / `accepted` / `failed` ayrı) və **heç vaxt
atmır, heç vaxt yalan demir**: `skipped` uğur deyil, `transport` inyeksiya olunandır.
⚠️ REST açarı `customer_app_settings`-ə **yazılmır** — o blob hər müştəriyə qaytarılır; açar
ayrı `push_settings` açarındadır və `_can_view_sensitive_settings` maskası ilə qorunur
(`email_settings.resend_api_key` ilə eyni naxış). `PushDelivery` cədvəli (`models.py`,
`alembic/versions/20260905_0002`) hər göndərməni jurnala yazır — `as_log_dict` **token yazmır**,
yalnız maskalanmış say.

**P1.4b — seqment mühərriki** (`app/services/push_audience.py`, yeni). Beş seqment
(`all`, `new`, `dormant`, `tier`, `has_balance`) **tək** funksiyadadır, çünki ön baxış
(`/push/preview`) ilə real göndərmə (`/push/broadcast`) eyni süzgəci işlətməlidir — iki yerdə ayrı
yazılsa panel "412 alıcı" deyib 30 nəfərə göndərə bilər. Sayılar **pillə-pillə** qaytarılır
(`matched` → `with_token` → `undeliverable` → `recipients`), yəni tenant itkini görür. `days` heç
vaxt 0 olmur (boş sahə `new` → 30, qalanı → 60), çünki "0 gün" heç bir seqment üçün mənalı deyil.
DB sorğusu qəsdən router-dədir: `Customer`-də `last_visit` sütunu yoxdur, "yatmış" üçün son satış
`sales` üzərində qruplanır — modul ona görə `sqlalchemy` import etmir və test onu birbaşa çağırır.

**P1.4c — endpointlər** (`app/routers/operations.py`, `push_dispatch.py`). Altı yol:
`GET /customer-app/push/status` (konfiqurasiya + seqment kataloqu + limitlər + gündəlik sayğac),
`PATCH /customer-app/push/settings`, `POST /customer-app/push/preview`,
`POST /customer-app/push/test` (öz kartına), `POST /customer-app/push/broadcast`,
`GET /customer-app/push/history`. Açar dövriyyəsinin üç qaydası: cavab **rol-dan asılı olmayan
şəkildədir** (`..._set` bayrağı həmişə var), boş sətir açarı **silmir**
(silmək üçün `clear_onesignal_rest_api_key: true`), `__keep__` sentineli "dəyişmə" deməkdir.
`onesignal_app_id` `customer_app_settings`-də qalır — PATCH yalnız o bir açarı yazır.

**P1.4d — frontend cütləri** (`src/api/push_admin.ts`, `src/lib/push.ts`, `src/api/settings.ts`).
`_live` funksiyalar tenant almır (host header həll edir), lokal funksiyalar `tenant_id`-ni **sonda**
alır. `src/lib/push.ts` heç nə import etmir (tək-fayl müştəri bundle-ına girə bilsin) və Python
normalizerlərinin güzgüsüdür. Göndəricinin özü **qəsdən güzgülənmir**: REST açarı brauzerdən
OneSignal-a getməməlidir. Lokal rejim `status:'skipped'` sətri + açıq səbəb yazır və
`success:false` qaytarır (P0.7 dərsi: saxta uğur yoxdur) — `skipped` sətirlər gündəlik kvotanı
**yemir**.

**P1.4e — panel bloku** (`CustomerAppPanel.tsx`, 2183 → 2804 sətir). Bütün rəqəmlər, limitlər və
seqment kataloqu **tək** `/push/status` cavabındandır; `needs_days` / `needs_value` /
`needs_min_stars` bayraqları hansı sahənin göstərildiyini qərar verir, yəni serverə yeni seqment
əlavə etmək panel dəyişikliyi tələb etmir. Açar heç vaxt serverin cavabından doldurulmur, yalnız
yazılanda göndərilir. P0.4 boşluğu UI-da `pushSpecKey` **imzası** ilə bağlanır: köhnə seqmentin
sayı göndər düyməsinin yanında qala bilmir — imza köhnədirsə təsdiq dialoqu əvvəl yenidən ön baxış
alır. `broadcast_daily_limit === 0` **bağlıdır** (limitsiz deyil) və göndər düyməsi səbəbi
göstərir: master keçid → broadcast keçidi → konfiqurasiya → limit → boş mətn → boş seqment.

**P1.4f — testlər və paritet.** `backend/tests/test_push_service.py` (yeni, 161 assert) nüvəni
qıfıllayır: qarışıq cüt qurulmur, cavabın şəkli roldan asılı deyil, `send_onesignal` transport
partlayanda da atmır, `skipped` uğur sayılmır, `as_log_dict` token sızmır.
`backend/tests/test_push_audience.py` (yeni) seqment qaydalarını: sərhəd günü daxildir, heç vaxt
alış etməyən müştəri dərhal "yatmış" olmur, boş `tier` **heç kimi** seçmir (yoxsa "Gold-a göndər"
bütün bazaya gedər), `has_balance` `lifetime_stars` deyil `stars` oxuyur.
**Paritet artıq kodda təkrarlanmır:** `tests/fixtures/push_parity.json` tək mənbədir, iki icraçı
onu oxuyur — `backend/tests/test_push_parity.py` (68 hal) və `tests/push_parity.test.mjs`
(`npm run test:parity`, 14 test). Səbəb mətnləri də daxil olmaqla nəticələr hərfi müqayisə olunur,
yəni güzgünün sürüşməsi səssiz qala bilmir. Yeni hal əlavə edəndə yalnız JSON redaktə olunur.

<!-- __P14_CHUNK_3__ -->



**P1.5 — Kampaniya modelini gücləndir.** Mövcud forma yalnız saat + gün + faiz verir. Çatışmayan:
tarix aralığı (kampaniya bitmir!), istifadə limiti (ümumi və müştəri başına), hədəf seqment
(yeni müştəri / tier / yatmış müştəri), kanal (yalnız tətbiqdə / push da göndər), endirim tipi
(faiz / məbləğ / X al Y ödə / pulsuz məhsul).

**P1.6 — Endirim yığımı qaydası.** Bir ekranda: hansı endirimlər yığıla bilər, maksimum yekun
endirim həddi, `ikram` (100%) üçün təsdiq tələbi. §4.6 üçün.

### P2 — Konsolidasiya (birləşdirmə)

- **Kampaniya tək yerdə.** `TablesHappyHourPanel` ilə bu panelin kampaniya bloku birləşdirilsin.
  Eyni cədvələ yazdıqları üçün texniki maneə yoxdur — bir CRUD, iki yerdən link.
- **Filiallar buradan çıxsın.** Filial CRUD (`:817-903`) müştəri tətbiqi dizaynı deyil,
  əməliyyat ayarıdır. Ayarlar → yeni "Filiallar" bölməsinə keçsin, bu panel yalnız
  "hansı filiallar tətbiqdə görünsün" seçimini saxlasın.
- **Müştəriyə təsir edən səpələnmiş ayarlar bir araya gəlsin:** eko-stəkan endirimi
  (`sec-beverage`), feedback kuponu (`sec-qr` / `sec-feedback`), biznes adı və loqo
  (`sec-profile`) — heç olmasa bu panelə "oxu + keçid" kimi güzgülənsin.
- **Rəng sistemi ikiyə düşsün:** müştəri tətbiqi brendi (tenant seçir) və admin/POS token layeri.
  `HomeTab`-dakı hardcoded gradient birincidən qidalanmalıdır.

### P3 — Müşahidə olunabilirlik (indi 1/10)

Panel nə qədər düzgün olsa da, nəticəni görmək mümkün deyil. **Ön şərt:** §3.11-ə görə `points`
rejimində ledger yazılmır — yəni aşağıdaki metrikaların yarısı üçün əvvəlcə P1.1-dəki accrual
mühərriki `unit="points"` yazmalıdır. Hesabat ekranı ondan sonra mənalıdır.

Minimum dəst:

- Aktiv üzv sayı, bu ay qoşulan, yatmış (30/60/90 gün gəlməyən)
- Verilmiş vs istifadə edilmiş xal (`LoyaltyLedgerEntry` üzərindən), açıq öhdəlik məbləği
- Hədiyyə tələbləri: `PENDING` / `REDEEMED` sayı və orta müddət
- Kampaniya effekti: aktivasiya sayı, istifadə faizi, kampaniyalı vs kampaniyasız orta çek
- Push: göndərilən / açılan
- Ad günü: göndərilən bonus sayı (hazırda scheduler işləyir və ya işləmir — bilmək yolu yoxdur)

---

## 6. Nə yığışdırılmalıdır

| Element | Yer | Səbəb |
|---|---|---|
| 3 dizayn preseti (`rewards`/`cashback`/`playful`) | `:443-455` | Əsasən ölü sahələr yazır; real fərq yaratmır |
| `layout_preset` seçimi | branding bloku | Heç bir komponent oxumur |
| `reward_card_style` dropdown | branding bloku | Heç bir komponent oxumur |
| Filial CRUD | `:817-903` | Bu panelin mövzusu deyil — əməliyyat ayarıdır |
| `CRM_MEMBER_TYPES` lokal siyahısı | `:15` | Tier mənbəyinin 5 nüsxəsindən biri — amma **fərqli ox** (P1.2-də səbəbi ilə saxlanıldı) |
| 4 ayrı "Yadda saxla" düyməsi | `:642,683,805,893,953` | Üçü eyni `save()`-i çağırır — yalnız qarışıqlıq yaradır |
| Referral mətni | `HomeTab.tsx:191-204` | Arxasında sistem yoxdur |
| 2 saxta `surpriseMessages` vədi | `HomeTab.tsx` | Arxasında qayda yoxdur |
| `window.confirm` silmə dialoqları | `:212,284` | Layihənin `ConfirmModal`-ı var, istifadə edilməlidir |

**Bu siyahıdan nə oldu (2026-09-04).** `layout_preset`, `reward_card_style` və 3 preset
**silinmədi, real işlədildi** (P0.3-də səbəb yazılıb — preset 12 real sahə doldurur). Referral
mətni və 2 saxta vəd **silindi** (P0.6). `CRM_MEMBER_TYPES` **qalır** — P1.2-də aydın oldu ki, o,
nərdivanın nüsxəsi deyil, əl ilə verilən endirim oxudur (§4.2). Qalanı (filial CRUD-un yeri,
4 Save düyməsi, `window.confirm`) P1.4/P2-dədir.

**Qəsdən toxunulmayanlar — səbəbi ilə:**

| Nə | Səbəb |
|---|---|
| `server.js:90` `const iconSrc = '/logo.jpg'`, `scripts/gen_icons.py:14`, `public/logo.jpg` | PWA manifest ikonu platforma səviyyəsindədir; per-tenant manifest mexanizmi yoxdur. Ayrı iş — subdomain-ə görə manifest generasiyası tələb edir |
| `src/lib/customer_utils.ts` ölü kodu — `getWeatherInfo` (`:63-116`, heç yerdə import edilmir), `BARISTA_QUICK_PROMPTS` (`:7-11`), `getProductImage` (`:23-42`, hardcoded Unsplash URL-ləri) | İstifadə edilmir, yəni müştəriyə yalan demir. Təmizləmə P2-də, ayrı commit-də |
| İki panelin eyni `happy_hours` cədvəlinə yazması (`CustomerAppPanel` vs `TablesHappyHourPanel`) | Birləşdirmə P2-dir (§4.1); indi hər ikisi düzgün yazır, sadəcə bir-birini görmür |
| `birthday_bonus_stars` açarı | Bir buraxılışdan sonra tam çıxarılacaq — hazırda lazy migrasiya üçün güzgü kimi lazımdır (P0.2) |

---

## 7. Təklif olunan struktur

1003 sətirlik tək scroll yerinə alt-tablar. Hər tab öz save-i ilə, dirty-state göstəricisi ilə:

| Alt-tab | Nə var |
|---|---|
| **Brend & Görünüş** | Ad, loqo, hero başlıq/altbaşlıq/şəkil, rənglər, fon. Yalnız real işləyən sahələr. |
| **Loyallıq proqramı** | Rejim (ştamp / xal / cashback), earn qaydaları, hədd, tier redaktoru, hədiyyə kataloqu, ad günü |
| **Kampaniyalar** | Vahid CRUD (happy hour + tətbiq kampaniyası), tarix aralığı, limit, seqment, kanal |
| **Bildirişlər** | Push konfiqurasiyası, əl ilə göndərmə, planlaşdırma, tarixçə |
| **Qeydiyyat & Razılıq** | Axın tipi, razılaşma mətni, join QR, klub tipi + başlanğıc endirim |
| **Görünürlük** | Hansı tablar/bloklar tətbiqdə görünsün (QR, balans, tarixçə, AI Barista, AI Falçı, filiallar) |
| **Hesabat** | §P3-dəki metrikalar |

Struktur qaydaları: hər sahənin yanında "tətbiqdə nə dəyişir" izahı; işləməyən sahə panelə
düşməsin; ön baxış yalnız doğru olanı göstərsin; save-dən sonra "nə dəyişdi" xülasəsi.

---

## 8. Ən qısa yekun

Panel geniş görünür, amma **34 sahədən ~10-u tam ölü, ~6-sı yarımçıqdır**, hər save 3 sahəni
(`tiers`, `birthday_enabled`, `onesignal_app_id`) silir, ad günü bonusu heç vaxt işləyə bilməz,
`points` rejimində qazanma qaydaları konfiqurasiya oluna bilmir və ledger yazılmır, ön baxış isə
ölü sahələri işləyirmiş kimi göstərir. İşləyən tək tam zəncir `cashback` rejimidir.

Loyallıq bonusları, kampaniyalar və dizayn **bir yerdən idarə olunmur** — kampaniya 2 UI-da,
tier 5 yerdə, rəng 3 sistemdə yaşayır, real loyallıq qaydası isə `pos.py`-də hardcoded-dır.

İş sırası: **P0 (yalanları dayandır) → P1 (əsl nəzarətlər) → P2 (birləşdir) → P3 (hesabat).**
P0.1 (PATCH merge) tək başına 4 kritik tapıntını həll edir və digər hər şeyin ön şərtidir;
P1.1 (accrual mühərriki + points ledger) isə P3-ün ön şərtidir.

**2026-09-05 vəziyyəti: P0.1–P0.7 + P1.1 + P1.2 + P1.3 bitdi.** Panel artıq yalan demir — hər
saxlanan sahə ya real işləyir, ya "tətbiqdə hələ işləmir" nişanı daşıyır (indi belə tək sahə var:
tier `discount_percent` → P1.6); hər save mövcud açarları qoruyur; qazanma qaydaları ayarlardan
oxunur və `points` rejimində ledger yazılır; səviyyə nərdivanı paneldən redaktə olunur və
nərdivanın defaultu hər dildə **bir** yerdə yaşayır; hədiyyə isə tək "ad + hədd" cütü deyil,
**20 sətirə qədər kataloqdur** (qiymət, məhsul bağlantısı, stok limiti, aktiv/deaktiv, 3 dil) və
zəncirin beş həlqəsi — panel, `wallet.rewards`, claim, kassa endirimi, stok sayımı — onu oxuyur.
**Növbəti addım P1.4** — push idarəsi (§3.9): `onesignal_app_id` saxlanılır, amma paneldən
bildiriş göndərmək, planlaşdırmaq və tarixçəsinə baxmaq yolu yoxdur.

---

## Əlavə — istinad xəritəsi

> Sətir nömrələri **2026-09-03 vəziyyətinə** aiddir və P0 dəyişiklikləri onları sürüşdürdü.
> Simvol adı ilə axtarmaq daha etibarlıdır. P0-dan sonra **yox olmuş** istinadlar: hardcoded
> loqo, geofence koordinatları, milestone adları, 10 yuvalı sabit ştamp şəbəkəsi, hardcoded
> hero mətni — bunlar artıq ayarlardan gəlir. Yeni tək-mənbə nöqtələri: gün nömrələnməsi
> (`operations.py::create_happy_hour` → `now.weekday() + 1`), hədd normalizasiyası
> (`pos.py::_reward_threshold`, `src/lib/loyalty.ts::normalizeRewardThreshold`), ad günü
> bonusu (`operations.py::_canonical_birthday_bonus`, `settings.ts::canonicalBirthdayBonus`),
> tier nərdivanı (`operations.py::DEFAULT_TIERS` / `_tier_threshold`,
> `src/lib/loyalty.ts::DEFAULT_LOYALTY_TIERS`).

| Mövzu | Fayl:sətir |
|---|---|
| Panel | `src/components/admin/CustomerAppPanel.tsx:1-1003` |
| Save payload (34 açar) | `CustomerAppPanel.tsx:307-343` |
| PATCH endpoint (kök səbəb) | `backend/app/routers/operations.py:2964-3003` |
| Real xal məntiqi | `backend/app/routers/pos.py:705-730` |
| `program_mode` / cashback (işləyən yol) | `pos.py:698-699`, `:1030-1042` |
| Loyalty ledger yazıları (yalnız cashback + birthday) | `pos.py:1020`, `:1034`, `birthday_scheduler.py:176` |
| `DEFAULT_TIERS` (backend) | `operations.py:4206-4210` |
| Tier hesablanması | `operations.py:4429` |
| Tier tək mənbəyi (P1.2-dən sonra) | `operations.py::DEFAULT_TIERS` + `_tier_threshold`, `src/lib/loyalty.ts::DEFAULT_LOYALTY_TIERS` |
| Tier normalizer güzgüsü | `operations.py::_norm_customer_app_tiers` ↔ `settings.ts::normCustomerAppTiers` |
| Tier oxu güzgüsü | `operations.py::_compute_tier` ↔ `src/api/crm.ts::computeTier` |
| Tier testləri | `backend/tests/test_customer_app_tiers.py` |
| Boot-da müştəri endirimi təmiri (§4.2, P1.6) | `backend/app/main.py:723-751` |
| Reward threshold oxunuşu | `operations.py:4376`, `:4643` |
| Push app id ötürülməsi | `operations.py:3800`, `:4400` |
| Ad günü scheduler | `backend/app/services/birthday_scheduler.py:232` |
| Hardcoded hero | `src/components/customer/HomeTab.tsx:322-347` |
| Ştamp şəbəkəsi (10 yuva) | `HomeTab.tsx:515-530` |
| Milestone adları | `HomeTab.tsx:704-707` |
| Geofence koordinatları | `src/components/CustomerApp.tsx:1211-1213` |
| Hardcoded loqo | `CustomerApp.tsx:2216`, `HomeTab.tsx:301` |
| Kampaniya API (panel) | `src/api/settings.ts:2328-2367` |
| Kampaniya API (masalar) | `src/api/happy_hours.ts` |
| Ayarlar bölmə siyahısı | `src/components/admin/SettingsPanel.tsx:1419-1439` |
