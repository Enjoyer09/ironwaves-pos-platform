> **Status (2026-10-02): awaiting the accountant's answers. None of the section 5 answers has been given to the agent yet** (ask the owner whether the document was already sent).
> Until the answers arrive: do NOT change the simplified-tax base, the expense category map, or post the section 6 corrections.
> Original language: Azerbaijani (the accountant reads Azerbaijani). Do not translate the version that is sent to the accountant.

# Maliyyə v2 — mühasib üçün yoxlama sənədi

**Məqsəd:** yeni mühasibat nüvəsinin (baş kitab, GL) hesab xəritəsini, yazı qaydalarını və vergi məntiqini mühasib təsdiq etsin. Real tenantlar (Gyros, Daily Coffee) yeni sistemə yalnız bu sənəd təsdiqləndikdən sonra keçəcək.

**Sizdən istənilən:** hər bölmədə ✅ (düzgündür), ✏️ (düzəliş lazımdır, qeydlə) və ya ❓ (sual) qeyd edin. Ən vacib suallar **5-ci bölmədədir**.

---

## 1. Hesablar planı (Milli Hesablar Planı əsasında)

- Hər tenant üçün avtomatik yaradılır.
- "Başlıq" hesablara yazı getmir, yalnız onların subhesablarına yazılır.
- Sistem qaydaları hesab nömrəsinə deyil, hesabın **roluna** bağlıdır. Ona görə kod və ya ad dəyişsə də qaydalar pozulmur.

| Kod | Ad | Tip | Normal qalıq | Qeyd |
|---|---|---|---|---|
| 101 / 102 | Qeyri-maddi aktivlər — dəyəri / amortizasiya | Aktiv | D / K | |
| 111 / 112 | TTA — dəyəri / amortizasiya | Aktiv | D / K | |
| 201 | Material ehtiyatları | Aktiv | D | Anbar (xammal) |
| 205 | Mallar | Aktiv | D | |
| 211 | Alıcıların debitor borcları | Aktiv | D | |
| 218.1 | Verilmiş borclar (nisyə/borc) | Aktiv | D | köhnə sistemdə "debt" |
| 221.1 | POS kassası (nağd) | Aktiv | D | **mənfiyə düşə bilməz** |
| 221.2 | Seyf | Aktiv | D | **mənfiyə düşə bilməz** |
| 222 | Yolda olan pul köçürmələri | Aktiv | D | |
| 223.1 | Əsas bank hesabı (kart ödənişləri) | Aktiv | D | |
| 241 | Əvəzləşdirilən ƏDV | Aktiv | D | yalnız ƏDV rejimində |
| 244 / 245 | Verilmiş avanslar / Təhtəlhesab | Aktiv | D | |
| 301 | Nizamnamə kapitalı | Kapital | K | |
| 341 | Hesabat dövrünün xalis mənfəəti | Kapital | K | |
| 343 | Bölüşdürülməmiş mənfəət | Kapital | K | |
| 344 | Elan edilmiş dividendlər | Kapital | D | |
| 401 / 511 | Uzun / qısamüddətli bank kreditləri | Öhdəlik | K | |
| 521.1 | ƏDV öhdəliyi | Öhdəlik | K | |
| 521.2 | Sadələşdirilmiş vergi öhdəliyi | Öhdəlik | K | |
| 521.3 | Gəlir vergisi (əmək haqqından) | Öhdəlik | K | |
| 522 | Sosial sığorta öhdəlikləri | Öhdəlik | K | |
| 531 | Malsatan və podratçılara borclar | Öhdəlik | K | təchizatçı üzrə izlənir |
| 533 | İşçi heyətinə əmək haqqı borcları | Öhdəlik | K | |
| 538.1 | Təsisçi / investor borcu | Öhdəlik | K | köhnə sistemdə "investor" |
| 538.2 | Digər borc alınmış vəsaitlər | Öhdəlik | K | köhnə "Borc Alındı" |
| 538.9 | Aydınlaşdırılmamış məbləğlər (suspense) | Öhdəlik | K | köhnə "adjustment" |
| 543.1 | Müştəri depozitləri (masa/rezerv) | Öhdəlik | K | |
| 601.1 | Məhsul satışı (POS) | Gəlir | K | |
| 602 | Qaytarmalar və endirimlər | Gəlir (kontr) | D | |
| 611.1 | Kassa artığı | Gəlir | K | |
| 611.9 | Digər əməliyyat gəlirləri | Gəlir | K | |
| 701 | Satışın maya dəyəri | Xərc | D | |
| 711.1 | Bank / ekvayrinq komissiyası | Xərc | D | |
| 711.9 | Digər kommersiya xərcləri | Xərc | D | |
| 721.1 | Əmək haqqı | Xərc | D | |
| 721.2 | İcarə | Xərc | D | |
| 721.3 | Kommunal xərclər | Xərc | D | |
| 721.4 | İşçi yeməyi | Xərc | D | |
| 721.9 | Digər inzibati xərclər | Xərc | D | |
| 731.1 | Ehtiyat itkisi / silinmə | Xərc | D | |
| 731.2 | Kassa kəsiri | Xərc | D | |
| 731.3 | Sadələşdirilmiş vergi xərci | Xərc | D | |
| 731.4 | Cərimə və sanksiyalar | Xərc | D | |
| 751 | Maliyyə xərcləri | Xərc | D | |
| 901 | Cari mənfəət vergisi xərci | Xərc | D | |

---

## 2. Köhnə sistemin kateqoriyaları → yeni hesablar

Tarixi data (aprel–sentyabr 2026, 9 000+ əməliyyat) bu xəritə ilə köçürülüb. Yeni daxil edilən xərclər də eyni xəritə ilə yazılır.

| Köhnə kateqoriya | Yeni hesab | Mühasib qərarı |
|---|---|---|
| Maaş / Əmək haqqı | 721.1 Əmək haqqı | |
| Kommunal | 721.3 Kommunal | |
| İcarə | 721.2 İcarə | |
| Staff Benefit | 721.4 İşçi yeməyi | |
| Bank Komissiyası | 711.1 Bank komissiyası | |
| **Xammal** (alış anında xərcə yazılan) | **701 Satışın maya dəyəri** | ❓ doğrudurmu? |
| Cərimə | 731.4 | |
| Anbar İtkisi | 731.1 | |
| Digər Xərc və tanınmayan kateqoriyalar | 721.9 Digər inzibati | |
| Satış (Nağd / Kart) | 601.1 Satış | |
| Digər Giriş | 611.9 Digər gəlir | |
| Borc Alındı | tarixi datada 611.9 (köhnə sistem gəlir kimi yazıb), **yeni yazılarda 538.2 öhdəlik** | ❓ |
| Təsisçi İnvestisiyası | 538.1 Təsisçi borcu | ❓ yoxsa 301 Nizamnamə kapitalı? |

---

## 3. Yazı qaydaları (nümunələr)

**Kart satışı 50 ₼, bank komissiyası 2%, maya dəyəri 12 ₼** (bir yazı):

| Hesab | Debit | Kredit |
|---|---|---|
| 223.1 Bank | 49.00 | |
| 711.1 Bank komissiyası | 1.00 | |
| 601.1 Satış | | 50.00 |
| 701 Maya dəyəri | 12.00 | |
| 201 Ehtiyat | | 12.00 |

**Endirimli satış:** gəlir endirimdən əvvəlki məbləğlə 601.1-ə, endirim 602-yə yazılır. Xalis gəlir = alınan məbləğ.

**ƏDV rejimi (18%, qiymətə daxil):** 118 ₼ satış → 601.1 Kt 100.00, 521.1 Kt 18.00. Alışda ödənilən ƏDV → 241 Dt.

**Sadələşdirilmiş rejim:** satışdan heç nə ayrılmır. Ayın sonunda: 731.3 Dt / 521.2 Kt = gəlir bazası × faiz. Yenidən hesablanarsa yalnız fərq yazılır.

**Digər əməliyyatlar:**

| Əməliyyat | Yazı |
|---|---|
| Masa depoziti alındı | Kassa və ya Bank Dt / 543.1 Kt |
| Depozit hesaba tətbiq olundu | 543.1 Dt / 601.1 Kt |
| Depozit Z-də gəlirə keçirildi (müştəri gəlmədi) | 543.1 Dt / 601.1 Kt (ƏDV rejimində ƏDV ayrılır) |
| Kassa artığı | 221.1 Dt / 611.1 Kt |
| Kassa kəsiri | 731.2 Dt / 221.1 Kt |
| Kassadan maaş | 721.1 Dt / 221.1 Kt |
| Qismən qaytarma | 602 Dt (+ ƏDV rejimində 521.1 Dt) / Kassa və ya Bank Kt |
| Satışın ləğvi, mal anbara qaytarılır | tam storno, ləğv günü tarixi ilə |
| Satışın ləğvi, mal qaytarılmır | storno + 731.1 Dt / 201 Kt (maya dəyəri silinir) |
| Mal alışı borca | 201 Dt / 531 Kt |
| Təchizatçıya ödəniş | 531 Dt / Kassa və ya Bank Kt |
| Hesablar arası köçürmə | alan hesab Dt / göndərən hesab Kt, komissiya 711.1-ə |
| Borc alındı | Kassa Dt / 538.2 Kt |
| Borc verildi | 218.1 Dt / Kassa Kt |
| İnvestordan vəsait | Kassa Dt / 538.1 Kt |
| İnvestora ödəniş | 538.1 Dt / Kassa Kt |

**Nəzarət qaydaları:**
- Bağlı aya yazı getmir.
- Post olunmuş yazı dəyişdirilə və silinə bilməz, düzəliş yalnız storno ilə olur.
- Yaradan şəxs öz yazısını təsdiqləyə bilməz.
- Kassa və seyf mənfiyə düşə bilməz.

---

## 4. Vergi rejimi (tenant özü seçir)

| Rejim | Faiz | Sistem nə edir |
|---|---|---|
| Sadələşdirilmiş | tenant daxil edir (2%, 5% …) | aylıq hesablama: baza × faiz → 731.3 / 521.2 |
| ƏDV | tenant daxil edir (default 18%) | hər satışdan ƏDV ayrılır, alışda 241 əvəzləşdirilir |
| Azad | — | vergi yazısı yoxdur |

- Rejim dəyişikliyi yalnız **gələcək ayın 1-dən** qüvvəyə minir.
- Keçmiş aylar yenidən hesablanmır.

---

## 5. Təsdiq tələb edən suallar

1. **Sadələşdirilmiş verginin bazası.** Hazırda baza ayın bütün gəlir hesablarının xalis qalığıdır: 601.1 satış, çıxılsın 602 endirim/qaytarma, üstəgəl 611.1 kassa artığı, üstəgəl 611.9 digər gəlir.
   - Kassa artığı bazaya daxil olmalıdırmı?
   - Digər gəlir bazaya daxil olmalıdırmı?
   - İşçi yeməyinin satış dəyəri (bax 2-ci sual) bazaya daxil olmalıdırmı?
2. **İşçi yeməyi.** Limit daxilində pulsuz verilən yemək satış dəyəri ilə yazılır: 721.4 Dt / 601.1 Kt, ƏDV-siz. Bu, sadələşdirilmiş vergi bazasını artırır. Doğrudurmu, yoxsa yalnız maya dəyəri ilə xərcə yazılmalıdır?
3. **Qaytarmada bank komissiyası.** Bank ilkin komissiyanı geri qaytarmır deyə komissiyanı geri yazmırıq. Doğrudurmu?
4. **Kassadan maaş.** Brüt məbləğlə 721.1-ə yazılır. Gəlir vergisi və sosial sığorta tutulmaları (521.3, 522) ayrıca əmək haqqı prosesində olmalıdır. Hazırda sistemdə belə proses yoxdur. Necə aparılsın?
5. **Çatdırılma platformaları (Wolt/Bolt).** Sifariş tam məbləğlə 223.1-ə yazılır, platformanın komissiyası isə hesablaşma zamanı ayrıca yazılmalıdır. Hesablaşma 222 "Yolda olan pul köçürmələri" üzərindən aparılsınmı?
6. **Xammal alışı.** Birbaşa xərcə yazılan alış 701 Maya dəyərinə köçürülüb. 201 Material ehtiyatları + silinmə yanaşması daha doğrudurmu?
7. **Təsisçi vəsaiti.** 538.1 Təsisçi borcu kimi saxlanılır. Bəzi hallarda bu 301 Nizamnamə kapitalı olmalıdırmı?
8. **Saxlanılan depozit** (müştəri gəlmədi): 601.1 Satış, yoxsa 611.9 Digər gəlir?

---

## 6. Köçürmə zamanı tapılan və düzəliş tələb edən qalıqlar

Köhnə sistemdən olduğu kimi köçürülüb. Mühasib qərarı ilə yeni sistemdə düzəliş yazısı ilə bağlanacaq.

| Tenant | Məsələ | Məbləğ |
|---|---|---|
| Gyros | Təsdiqlənməmiş "X-report difference" (22.08.2026). Kitabdakı kassa şişirdilmiş ola bilər. | 27 039.35 ₼ |
| Gyros | Mənfi seyf qalığı | −2 400.00 ₼ |
| Gyros | Aydınlaşdırılmamış məbləğlər (538.9) | 1 319.30 ₼ |
| Daily Coffee | Mənfi seyf qalığı | −847.40 ₼ |
| Daily Coffee | Mənfi anbar qalığı. Mal alışları tam yazılmayıb. | −2 830.68 ₼ |
| Daily Coffee | Mənfi verilmiş borclar | −43.00 ₼ |
| Daily Coffee | Aydınlaşdırılmamış məbləğlər (538.9) | 384.70 ₼ |
| Daily Coffee | "Borc Alındı" gəlir kimi yazılıb | 40.00 ₼ |

**Mühasibdən lazım olan:** hər sətir üçün düzəliş yazısının hesabları və ya "olduğu kimi saxla" qərarı.

---

## 7. Təsdiq

| | Ad, soyad | Tarix | İmza |
|---|---|---|---|
| Mühasib | | | |
| Sahibkar | | | |
