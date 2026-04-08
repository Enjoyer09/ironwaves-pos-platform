# iRonWaves POS User Handbook

## 1. Məhsul Haqqında

iRonWaves POS restoran, coffee shop, fast food, dönər və retail tipli obyektlər üçün hazırlanmış idarəetmə sistemidir. Sistem gündəlik satışı, masa xidmətini, mətbəx axınını, anbarı, maliyyəni, CRM-i və loyallıq proseslərini bir platformada birləşdirir.

Bu handbook-un məqsədi komandaya proqramdan düzgün və rahat istifadə etməyi öyrətməkdir.

## 2. Sistemdə Əsas Rollar

- `Kassir`
  kassada sürətli satış, ödəniş və çek axınını idarə edir
- `Ofisiant`
  masaları açır, masaya sifariş vurur, mətbəxdən gələn hazır sifarişləri izləyir
- `Mətbəx`
  gələn sifarişləri qəbul edir, hazırlayır, hazır olanları bildirir
- `Menecer`
  növbə, hesabat, istifadəçilər, xərc və proses nəzarətini edir
- `Admin / Super Admin`
  ayarlar, tenant, təhlükəsizlik, landing, QR menu və ümumi konfiqurasiya ilə işləyir

## 3. Gündəlik İş Axını

### 3.1. Günə başlamaq

Günə başlamaq üçün:

1. `Z-Hesabat` moduluna daxil olun
2. `Açılış hədəfi` yazın
3. pulun haradan gəldiyini seçin
4. `Günü Aç` düyməsini basın

### 3.2. Açılış mənbələri nə deməkdir

#### `Seyfdən tamamla`

Kassaya qoyduğunuz məbləğ seyfdən çıxır.

Nəticə:
- `cash` artır
- `safe` azalır

#### `Kartdan tamamla`

Kassaya qoyduğunuz məbləğ kart hesabından gəlir.

Nəticə:
- `cash` artır
- `card` azalır

#### `İnvestordan tamamla`

Kassaya pul investor tərəfindən verilir.

Nəticə:
- `cash` artır
- `investor borcu` yaranır

#### `Birbaşa kassaya yaz`

Bu seçim o deməkdir ki, kassada artıq fiziki pul var və siz onu sistemə yalnız açılış məbləği kimi yazırsınız.

Bu pul:
- borc deyil
- investor öhdəliyi deyil
- seyfdən transfer deyil
- karta aid deyil

Sadə dildə:
bu, “günə başlayanda kassada faktiki olaraq olan pul”dur.

## 4. POS Modulu

POS əsasən `al-apar` və birbaşa kassadan olan satışlar üçündür.

### 4.1. Satış etmək

1. məhsulları seçin
2. səbətə əlavə edin
3. ödəniş növünü seçin
4. `Ödənişi Tamamla`

### 4.2. Ödəniş növləri

- `Nəğd`
- `Kart`
- `Split`

### 4.3. Split ödəniş

`Split` ödənişdə kassir məbləğin bir hissəsini nağd, qalan hissəsini kart kimi bölə bilər.

Misal:
- hesab `20 AZN`
- müştəri `5 AZN` nağd verir
- qalan `15 AZN` kartla bağlanır

Sistem bunu avtomatik hesablayır.

## 5. Masalar Modulu

`Masalar` dine-in və ofisiant axını üçün nəzərdə tutulub.

### 5.1. Masa açmaq

1. `Masalar` moduluna daxil olun
2. boş masa seçin
3. qonaq sayını qeyd edin
4. ehtiyac varsa depozit yazın

### 5.2. Masaya sifariş vurmaq

1. masa detail-i açın
2. `POS-da sifariş yaz` düyməsini basın
3. sistem sizi POS-a keçirəcək
4. yuxarıda bu sifarişin hansı masa üçün olduğu görünəcək
5. məhsulları seçin
6. `Masaya Göndər` düyməsini basın

### 5.3. Masa sahibi

Masaya ilk sifarişi vuran staff həmin masanın sahibi olur. Hazırkı məntiqdə başqa staff eyni dolu masaya icazəsiz sifariş əlavə edə bilməz.

## 6. Mətbəx Ekranı (KDS)

KDS mətbəxin işlədiyi paneldir.

### 6.1. Mətbəx nə edir

1. yeni sifarişi görür
2. `Qəbul et`
3. hazırlayır
4. hazır olan məhsulları seçir
5. `Hazırdır`

### 6.2. Hazır sifariş bildirişi

Mətbəx `Hazırdır` etdikdən sonra hazır məhsul popup-u masa ilə işləyən staff-a göndərilir.

Bu popup:
- avtomatik görünür
- staff `OK` basana qədər qalır

## 7. Depozit Məntiqi

Masa açılışında depozit yazmaq mümkündür.

Depozit:
- satış gəliri deyil
- ayrıca öhdəlik kimi saxlanılır

Bu səbəbdən sistemdə `Aktiv masa depozit öhdəliyi` ayrıca görünür.

Masa bağlananda:
- depozit hesabda istifadə olunursa
- həmin öhdəlik azalır

## 8. Maliyyə Modulu

`Maliyyə` artıq sadə form ekranı deyil. Bu hissə menecer və kassir üçün ayrıca `maliyyə nəzarət mərkəzi` kimi işləyir.

Burada 3 əsas məntiq var:

- `Baxış`
  indi vəziyyət nədir?
- `Əməliyyat`
  indi nə yazmalıyam?
- `Maliyyə jurnalı`
  nə baş verib, kim yazıb, kim təsdiqləyib?

### 8.1. Default açılış: `Baxış`

`Maliyyə`yə girəndə əvvəl `Baxış` görünür.

Burada görünür:
- `Nağd kassa`
- `Bank/Kart`
- `Seyf`
- `Aktiv depozitlər`
- `Bugünkü net`
- `Uyğunlaşdırma fərqi`

Yuxarı hissədə həm də kritik xəbərdarlıqlar görünür:
- `Kassa uyğun deyil`
- `Təsdiq gözləyən əməliyyat var`
- `Transfer uğursuz oldu`
- `Investor qalığı gecikir`
- `Uyğunlaşdırma tamamlanmayıb`

Bu hissənin məqsədi budur:
ekrana baxan menecer bir neçə saniyədə vəziyyəti başa düşsün.

### 8.2. Sürətli əməliyyatlar

Yuxarıdakı `Sürətli əməliyyatlar` kartlarından birini seçəndə ayrıca iş sahəsi açılır.

Burada əsas düymələr var:
- `Mədaxil yaz`
- `Xərc yaz`
- `Daxili transfer`
- `Investor ödə`
- `Depozit əməliyyatı`
- `Uyğunlaşdırma başlat`
- `Düzəliş`

Vacib:
formlar default açıq qalmır.
Yalnız seçdiyiniz əməliyyat üçün uyğun sahələr görünür.

### 8.3. Mədaxil və xərc yazmaq

Bu hissə gündəlik operativ yazılar üçündür.

Misallar:
- `Xammal`
- `Kommunal`
- `Maaş`
- `İcarə`
- `Digər giriş`

Adətən bu sahələr doldurulur:
- mənbə hesabı
- kateqoriya
- subyekt
- məbləğ
- qeyd

Sadə qayda:
- pul daxil olursa `Mədaxil`
- pul çıxırsa `Xərc`

### 8.4. Daxili transfer

Bu əməliyyat gəlir və ya xərc deyil.
Sadəcə vəsaitin bir hesabdan digərinə keçməsidir.

Misallar:
- `Seyfdən Kassaya`
- `Kartdan Kassaya`
- `Kassadan Seyfə`

Böyük məbləğli transferlər sistem policy-sinə görə əvvəl `Təsdiq qutusu`na düşə bilər.

### 8.5. İnvestor ödənişi

Bu əməliyyatla:
- seçilmiş mənbədən pul çıxır
- investor borcu azalır

Sistem policy-sinə görə bu əməliyyat:
- ya birbaşa yazılır
- ya da əvvəl `Təsdiq qutusu`na göndərilir

Yəni menecer təsdiqləmədən balans dəyişməyə də bilər. Bu, nəzarət üçündür.

### 8.6. Uyğunlaşdırma

`Uyğunlaşdırma` kassadakı real pul ilə sistemdəki gözlənilən qalığın tutuşdurulmasıdır.

Burada görünür:
- `Gözlənilən`
- `Sayılmış`
- `Fərq`

Sonra siz:
- hesabı seçirsiniz
- sayılmış məbləği yazırsınız
- qeyd əlavə edirsiniz
- `Uyğunlaşdırmanı tamamla` basırsınız

Əgər fərq varsa, sistem onu ayrıca nəzarət siqnalı kimi saxlayır.

### 8.7. Təsdiq qutusu

`Təsdiq qutusu` riskli əməliyyatların qısa növbəsidir.

Buraya əsasən bunlar düşə bilər:
- investor ödənişi
- böyük transfer
- düzəliş əməliyyatı
- reversal

Menecer burada:
- əməliyyatı açır
- məbləğə baxır
- haradan hara getdiyini görür
- sonra `Təsdiqlə` və ya `Rədd et` edir

### 8.8. Maliyyə jurnalı

`Maliyyə jurnalı` audit hissəsidir.

Burada hər əməliyyat üçün görünür:
- tarix
- status
- əməliyyat növü
- hansı hesabdan hansı hesaba getdiyi
- məbləğ
- qeyd

Sətirə klikləyəndə detal açılır:
- debit / credit yazılışları
- audit tarixçəsi
- təsdiq tarixi
- reversal tarixçəsi

Bu hissə əsasən menecer, admin və audit nəzarəti üçündür.

### 8.9. Depozit və investor məntiqi

`Aktiv depozitlər` ayrıca öhdəlik kimi saxlanılır.
Yəni depozit satış gəliri kimi sayılmır.

`Investor borcu` da ayrıca izlənir.
Investor ödənişi yazılanda sistem:
- pul çıxışını yazır
- investor öhdəliyini azaldır

### 8.10. Menecer üçün qısa oxuma qaydası

Maliyyə moduluna girəndə bu ardıcıllıqla baxın:

1. yuxarı KPI kartlarına
2. kritik xəbərdarlıqlara
3. `Bugünkü pul axını`
4. `Nəzarət xülasəsi`
5. `Təsdiq qutusu`
6. lazım olsa `Maliyyə jurnalı`

Əgər ekranda qırmızı xəbərdarlıq varsa, əvvəl onu yoxlayın, sonra yeni əməliyyat yazın.

## 9. X-Hesabat

`X-Hesabat` növbə bağlanmadan ara yoxlamadır.

Operator kassadakı real məbləği sayır və sistemdəki `olmalı kassa` ilə tutuşdurur.

Əgər fərq varsa:
- `Kassa Artığı`
- və ya `Kassa Kəsiri`
yaranır

## 10. Z-Hesabat

`Z-Hesabat` günün rəsmi bağlanışıdır.

### 10.1. Z-Hesabatda görünən əsas rəqəmlər

- `Növbə Açılışı`
- `Kassa hərəkətləri giriş`
- `Kassa hərəkətləri çıxış`
- `Olmalı kassa`
- `Faktiki bağlanış`
- `Bağlanış fərqi`
- `Bu növbədə toplanan depozit`
- `Aktiv depozit öhdəliyi`

### 10.2. Nə üçün vacibdir

Bu panel:
- kassanın düzgün sayılıb-sayılmadığını
- növbənin sağlam bağlanıb-bağlanmadığını
- maliyyə risklərinin olub-olmadığını
göstərir

## 11. Smen Təhvili

Növbə dəyişəndə:

1. `Smeni Təhvil Ver`
2. təhvil alacaq istifadəçini seçin
3. faktiki nağdı yazın
4. təhvil verin

Digər istifadəçi:
1. daxil olur
2. `Qəbul Et`
3. fərqi təsdiqləyir

## 12. Dashboard

`Dashboard` menecer və admin üçün əsas qərar panelidir.

Bu ekranın məqsədi təkcə rəqəm göstərmək deyil. Burada sistem sizə “indi nə problem var və hara baxmaq lazımdır?” sualına cavab verir.

### 12.1. Critical Alert Bar

Dashboard-un ən yuxarısında `Critical Alert Bar` var.

Burada kritik xəbərdarlıqlar görünür:

- `Kassa fərqi`
- `Offline satışlar`
- `Mətbəx gecikməsi`
- `Void / İsraf` nəzarəti
- `Satış və ledger fərqi`
- `Kritik stok`

Hər alert-in yanında action düyməsi var.

Misal:

- `Kassa fərqi var` görürsünüzsə, `Review` basıb `Finance` panelinə keçin
- `Mətbəxdə gecikmə var` görürsünüzsə, `Mətbəxi aç` və ya `Masalara keç` düyməsi ilə əməliyyata baxın
- `Kritik stok` görürsünüzsə, `Anbara keç` basın

Alert-i müvəqqəti gizlətmək üçün `x` düyməsi istifadə olunur.

### 12.2. KPI Strip

Dashboard-un yuxarı hissəsində əsas göstərici kartları var:

- `Bu gün satış`
- `Aktiv masalar`
- `Açıq check`
- `Avg ticket`
- `Kitchen load`
- `Cash fərqi`

Bu kartlar böyük rəqəmlərlə göstərilir ki, menecer bir baxışda vəziyyəti başa düşsün.

Kartlara klik edəndə uyğun modula keçid olur:

- satış kartı → `Analytics`
- masa kartı → `Masalar`
- cash fərqi → `Finance`

### 12.3. Live Sales

`Live Sales` son satışları göstərir.

Burada görünür:

- kim satış edib
- saat neçə olub
- ödəniş növü nədir
- məbləğ nə qədərdir

Dashboard real-time yenilənir və əlavə olaraq təxminən hər 15 saniyədə auto-refresh edir.

### 12.4. Top məhsullar

Bu blok seçilmiş tarix aralığında ən çox satılan məhsulları göstərir.

Menecer buradan görə bilər:

- hansı məhsul daha çox gedir
- hansı məhsul üçün stok daha diqqətlə izlənməlidir
- kampaniya və menyu qərarları üçün hansı məhsullar önə çıxır

### 12.5. Open checks

`Open checks` hazırda açıq hesabı olan masaları göstərir.

Burada görünür:

- masa adı
- qonaq sayı
- açıq check məbləği
- masa statusu

Bu blokdan `Masalara keç` düyməsi ilə birbaşa masa panelinə keçmək olar.

### 12.6. Cash Control

`Cash Control` kassa nəzarəti üçündür.

Burada görünür:

- `Expected`
- `Actual cash`
- `Gap`
- `Kart`
- `Depozit öhdəliyi`

Əgər `Gap` sıfırdan fərqlidirsə, kassa sayımı və finance ledger yoxlanmalıdır.

### 12.7. Staff performance

Bu blok personal performansını göstərir.

Burada görünür:

- kassir / staff adı
- satış sayı
- ümumi satış məbləği
- orta çek

Bu, gün sonu performans və nəzarət üçün istifadə olunur.

### 12.8. Alerts breakdown

Bu blok alert-ləri qruplaşdırır:

- `Kritik`
- `Warning`
- `Info`

Əgər backend finance audit snapshot-ları varsa, burada son audit qeydləri də görünür.

`Maliyyə nəzarətinə keç` düyməsi ilə `Finance` panelinə keçmək olar.

### 12.9. Dashboard-u necə oxumaq lazımdır?

Gündəlik menecer axını belə olsun:

1. əvvəl `Critical Alert Bar`-a baxın
2. sonra KPI kartlarda satış, masa və kassa vəziyyətini yoxlayın
3. `Open checks` ilə açıq masalara baxın
4. `Cash Control`-da kassa fərqini yoxlayın
5. `Staff performance` ilə personal satışını izləyin
6. alert varsa, yanındakı action düyməsi ilə uyğun modula keçin

Qısa qayda:

Dashboard-da qırmızı və sarı alert varsa, əvvəl onu yoxlayın. Sonra satış və performans rəqəmlərinə baxın.

## 13. Analytics

`Analytics` paneli satış performansını göstərir.

Burada adətən izlənilir:
- ümumi gəlir
- nağd satış
- kart satış
- top məhsullar
- gross profit

Əgər satış rəqəmi ilə ledger satış rəqəmi uyğun gəlmirsə, sistem warning göstərə bilər.

## 14. Logs

`Logs` sistem tarixçəsini göstərir.

Burada artıq ayrıca:
- `Maliyyə auditləri`
filter-i də var

Bu hissədə sistemin gördüyü risklər saxlanılır:
- `sales vs ledger fərqi`
- `investor mismatch`
- `shift cash gap`
- `deposit risk`

## 15. QR Menu

QR Menu ilə:
- müştəri QR skan edir
- login olmadan menyunu açır
- məhsul adı, qiymət, şəkil və təsviri görür

Bu funksiya hər tenant üçün ayrıca qurula bilər.

## 16. CRM və Loyallıq

Sistem CRM axınını da dəstəkləyir:
- QR üzvlük kartları
- rewards
- cashback
- kampaniyalar
- customer app

## 17. Menecer üçün gündəlik yoxlama siyahısı

Hər gün bunlara baxmaq tövsiyə olunur:

1. `Dashboard`
2. `Finance`
3. `Z-Hesabat`
4. `Analytics`
5. `Logs > Maliyyə auditləri`

## 18. Tövsiyə olunan gündəlik axın

1. Günü aç
2. Kassanı yoxla
3. POS və masalarla satışı apar
4. Mətbəx statuslarını izləyin
5. Gün içində lazım olduqda `X-Hesabat`
6. Növbə dəyişirsə `Smeni Təhvil Ver`
7. Gün sonunda `Z-Hesabat`
8. Maliyyə və dashboard warning-lərinə bax

## 19. Əsas Qayda

Bu sistemdə üç şey bir-birindən ayrı düşünülməlidir:

- `Satış gəliri`
- `Daxili transfer`
- `Borclu/öhdəlikli pul`

Yəni:
- hər kassaya girən pul gəlir deyil
- hər pul çıxışı xərc deyil
- hər məbləğ satışla bağlı deyil

Sistemin məqsədi bunları qarışdırmamaqdır.
