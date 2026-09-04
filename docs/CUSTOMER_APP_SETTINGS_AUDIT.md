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

### 3.5 `tiers` oxunur, amma yazıla bilmir

`operations.py:4429` müştərinin tier-ini `app_settings.get("tiers") or DEFAULT_TIERS`-dən hesablayır,
tətbiq isə onu göstərir (`HomeTab.tsx:168-170`, `ProfileTab.tsx:75-77`). Amma `tiers` PATCH-in
`cleaned` dict-ində **yoxdur** → nə admin idarə edə bilir, nə də saxlanmış dəyər sağ qalır.

`DEFAULT_TIERS` (`operations.py:4206-4210` — bronze 0 / silver 100 / gold 300) bütün tenantlar
üçün hardcoded qalır. Üstəlik tier-in `multiplier` sahəsi (gold 1.5x) müştəriyə göndərilir amma
**heç bir accrual yerində tətbiq olunmur.**

### 3.6 Push per-tenant ölüdür

`onesignal_app_id` `operations.py:3800` və `:4400`-də müştəriyə göndərilir,
`CustomerApp.tsx:737-744` onunla OneSignal SDK-nı işə salır. Lakin PATCH dict-ində yoxdur →
həmişə `None` → **brauzer push abunəliyi hər tenant üçün ölüdür.** Server tərəfi qlobal env
açarlarına düşür (`core/config.py:105-106`), yəni push platforma səviyyəsində bir parametrdir və
tenant-ın heç bir nəzarəti yoxdur.

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

### 4.2 Tier nərdivanı 4 yerdə, hər biri fərqli

| Yer | Nə saxlayır | İdarə oluna bilir? |
|---|---|---|
| `CustomerAppPanel.tsx:9-16` `CRM_MEMBER_TYPES` | golden/platinum/elite/thermos/ikram/telebe + endirim % | Yox — hardcoded |
| `src/api/crm.ts:10` `DEFAULT_TIERS` | frontend fallback nərdivanı | Yox — hardcoded |
| `operations.py:4206-4210` `DEFAULT_TIERS` | bronze 0 / silver 100 / gold 300 + multiplier | Yox — hardcoded |
| `HomeTab.tsx:168` / `ProfileTab.tsx:75` | rəng + ad fallback-ları (bir-biri ilə ziddiyyətli) | Yox — hardcoded |

Beləliklə "müştəri hansı səviyyədədir, nə qazanır" sualının **dörd ayrı cavab mənbəyi** var və
`app_settings["tiers"]` — nəzərdə tutulan tək mənbə — §3.5-ə görə yazıla bilmir.

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
| `earn_rate_per_azn`, `min_purchase_for_earn`, `first_purchase_bonus`, `double_points_days` | **İşlət** — `pos.py` accrual-ını bu ayarlardan oxutmaq (P1.1) | P1.1-də qalır |
| `reward_threshold` | **İşlət** — `pos.py:718-720` və `HomeTab.tsx:515` hardcoded 10-u ayardan al | ✅ 4 oxuyucu bir açarda birləşdi |
| `reward_card_style` | ~~Çıxar~~ → **İşlət** | ✅ kartın radius/blur-una bağlandı |
| `layout_preset` | ~~Çıxar~~ → **Saxla, adını dürüstləşdir** | ✅ "Sürətli başlanğıc dəstləri" |
| `background_color`, `background_image_url` | **İşlət** (asan) | ✅ tətbiq gövdəsinin fonu |
| `hero_title`, `hero_subtitle` | **İşlət** — `HomeTab.tsx:322-347` hardcoded hero mətnini əvəz et | ✅ ayardan, köhnə mətn fallback |
| `tiers` multiplier | **İşlət və ya sil** — göndərilir, tətbiq olunmur | P1.1-ə keçirildi |

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

**P0.4 — Ön baxışı dürüstləşdir.** Ön baxış yalnız **real oxunan** sahələri render etməlidir.
İşləməyən sahənin yanında "tətbiqdə hələ tətbiq olunmur" nişanı olmalıdır. Tab bar-ın 4 emojisi
real tab siyahısı ilə uzlaşdırılmalıdır.

**P0.5 — Tenant sızmalarını təmizlə.** `/logo.jpg` + `alt="Emalathhana"` → `branding.logo_url`;
`logo_url` üçün panelə şəkil yükləmə inputu; `CAFE_LAT/CAFE_LNG` → default filialın
koordinatları (`list_branches_live` artıq mövcuddur); milestone adları və "pulsuz Latte"
mətni → `reward_name` / konfiqurasiya.

**P0.6 — Yerinə yetirilməyən vədləri sil.** Referral mətnini (`HomeTab.tsx:191-204`) və
`surpriseMessages`-dəki 2 saxta vədi çıxar — ya da onları real qayda ilə əvəzlə. Hazırda
bunlar kassada mübahisə mənbəyidir.

**P0.7 — Lokal rejim səssiz uğursuzluğunu düzəlt.** `create_campaign_live` lokal rejimdə
saxta `id` qaytarır; ya `db_sim` üzərində real yazsın, ya da UI aydın şəkildə
"backend tələb olunur" desin.

### P1 — Çatışmayan tək-mənbə nəzarətləri

**P1.1 — Konfiqurasiya edilə bilən accrual mühərriki.** `pos.py:705-730`-dakı hardcoded məntiqi
ayarlardan oxuyan tək funksiyaya çıxar (`loyalty_service.compute_accrual(settings, cart, customer)`).
Dəstəklənməli rejimlər:

- `stamp` — hazırkı davranış: n ədəd "qəhvə tipli" məhsul = 1 hədiyyə (hədd ayardan)
- `points_per_azn` — `earn_rate_per_azn` × məbləğ, `min_purchase_for_earn` filtri ilə
- `cashback` — faizlə balans (**hazırda işləyən tək rejim** — `pos.py:1030-1042`)

Tier `multiplier`, `double_points_days`, `first_purchase_bonus` bu tək funksiyada tətbiq olunur —
başqa heç yerdə. Nəticə **hər rejimdə** `LoyaltyLedgerEntry`-yə yazılmalıdır (`unit="points"`
daxil olmaqla — §3.11), yoxsa hesabat üçün data yaranmır.

**P1.2 — Tier redaktoru.** Panelə cədvəl: ad, hədd, rəng, endirim %, multiplier, faydalar mətni.
Yazma yeri tək olsun — `app_settings["tiers"]`. `CRM_MEMBER_TYPES`, `crm.ts:DEFAULT_TIERS`,
`operations.py:DEFAULT_TIERS` bu mənbədən oxusun (hardcoded siyahılar silinsin).

**P1.3 — Hədiyyə kataloqu.** Hazırda "hədiyyə" tək bir ad + hədd sahəsidir. Real ehtiyac:
bir neçə hədiyyə (ad, lazım olan xal, məhsul bağlantısı, aktiv/deaktiv, stok limiti) —
`HomeTab.tsx:704-707`-dəki hardcoded milestone nərdivanı elə bunun əl ilə yazılmış versiyasıdır.

**P1.4 — Push bildiriş idarəsi.** `onesignal_app_id` per-tenant yazıla bilsin (P0.1 ilə həll
olunur), üstəgəl panelə: bildiriş göndər (seqment seçimi ilə), planlaşdırılmış kampaniya
bildirişi, göndərilmə tarixçəsi. Hazırda push tamamilə platforma env-inə bağlıdır və tenant
heç nə edə bilmir.

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
| `CRM_MEMBER_TYPES` lokal siyahısı | `:9-16` | Tier mənbəyinin 4 nüsxəsindən biri |
| 4 ayrı "Yadda saxla" düyməsi | `:642,683,805,893,953` | Üçü eyni `save()`-i çağırır — yalnız qarışıqlıq yaradır |
| Referral mətni | `HomeTab.tsx:191-204` | Arxasında sistem yoxdur |
| 2 saxta `surpriseMessages` vədi | `HomeTab.tsx` | Arxasında qayda yoxdur |
| `window.confirm` silmə dialoqları | `:212,284` | Layihənin `ConfirmModal`-ı var, istifadə edilməlidir |

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
tier 4 yerdə, rəng 3 sistemdə yaşayır, real loyallıq qaydası isə `pos.py`-də hardcoded-dır.

İş sırası: **P0 (yalanları dayandır) → P1 (əsl nəzarətlər) → P2 (birləşdir) → P3 (hesabat).**
P0.1 (PATCH merge) tək başına 4 kritik tapıntını həll edir və digər hər şeyin ön şərtidir;
P1.1 (accrual mühərriki + points ledger) isə P3-ün ön şərtidir.

---

## Əlavə — istinad xəritəsi

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
