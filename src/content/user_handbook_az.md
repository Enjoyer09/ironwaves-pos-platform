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

`POS` əsasən `al-apar`, kassadan birbaşa satış və tez bağlanan sifarişlər üçündür.

Sadə qayda:
- masada oturmayan müştəri üçün `POS`
- masada oturan qonaq üçün `Masalar`

### 4.1. POS-da adi satış necə edilir

1. `POS` moduluna daxil olun
2. məhsulları seçin
3. məhsullar səbətə düşəcək
4. lazımdırsa `+` və `-` ilə miqdarı dəyişin
5. ödəniş növünü seçin
6. `Ödənişi tamamla`

Misal:

Müştəri al-apar üçün:
- `1 cappuccino`
- `1 su`

Siz:
1. `Cappuccino` seçirsiniz
2. `Su` seçirsiniz
3. ödəniş növünü məsələn `Nəğd` seçirsiniz
4. `Ödənişi tamamla` basırsınız

### 4.2. POS-da ödəniş növləri

- `Nəğd`
- `Kart`
- `Split`

### 4.3. Split ödəniş nədir

`Split` o deməkdir ki, hesab hissə-hissə bağlanır.

Misal:
- hesab `20 AZN`
- `5 AZN` nəğd
- `15 AZN` kart

Bu halda sistem bir hissəni nəğd, qalan hissəni kart kimi bağlayır.

### 4.4. POS-dan nə vaxt istifadə etməmək lazımdır

Əgər qonaq masada oturubsa və sifariş mətbəxə gedəcəksə, əsas axın `Masalar` modulundan idarə olunmalıdır.

Yəni:
- masa açmaq
- raund göndərmək
- göndərilmiş sifarişi düzəltmək
- servis izləmək
- hesab bağlamaq

bunların əsas yeri `Masalar`dır.

## 5. Masalar Modulu

`Masalar` restoran daxilində masa xidməti üçün əsas əməliyyat ekranıdır.

Bu hissədə ofisiant:
- masa açır
- qonaq sayını yazır
- sifarişi yazır
- mətbəxə göndərir
- servisə hazır məhsulları izləyir
- hesabı bağlayır
- masa təmizlənəndən sonra yenidən boşaldır

### 5.1. Masanın statusları

Masaya baxanda rəngi və vəziyyəti sizə çox şeyi deyir:

- `Boş` masa
  oturtmaq olar
- `Rezerv` masa
  əvvəl rezerv qaydasını yoxlayın
- `Açıq hesablı masa`
  qonaq içəridədir, sifariş/hesab açıqdır
- `Təmizlik`
  masa bağlanıb, təmizlənmədən yenidən açılmamalıdır

### 5.2. Masa necə açılır

1. `Masalar` moduluna keçin
2. boş masaya toxunun
3. `qonaq sayı` yazın
4. ehtiyac varsa `depozitli qonaq sayı` yazın
5. `Masanı aç` basın

Misal:

`Masa 4`-ə `3 nəfər` oturub.

Siz:
- qonaq sayı: `3`
- depozit yoxdursa: `0`
- `Masanı aç`

### 5.3. Masa sahibi nə deməkdir

Masaya ilk əməliyyatı edən staff həmin masanın sahibi olur.

Bu o deməkdir ki:
- həmin masa onun nəzarətindədir
- başqa staff masa detalını görə bilər
- amma owner deyilsə, müdaxilə məhdud ola bilər

Bu, qarışıqlığı və səhv sifarişi azaltmaq üçündür.

### 5.4. Masaya sifariş necə yazılır

Hazır sistemdə sifariş yazmaq üçün ayrıca POS-a keçmək əsas yol deyil.
Ofisiant masanı açandan sonra sağ tərəfdə sifariş paneli açılır.

Orada 2 əsas hissə var:
- `Yeni sifariş`
- `Göndərilməmişlər`

Addım-addım:

1. açıq masaya toxunun
2. sağ paneldə `Yeni sifariş` hissəsi açılacaq
3. məhsulları seçin
4. seçilən məhsullar `Göndərilməmişlər`ə düşəcək
5. lazımdırsa miqdar və ya seçimi düzəldin
6. `Göndər` basın

Misal:

`Masa 2` istəyir:
- `2 dönər`
- `1 ayran`
- `1 kartof`

Siz:
1. `Dönər` məhsuluna iki dəfə toxunursunuz
2. `Ayran` məhsuluna bir dəfə toxunursunuz
3. `Kartof` məhsuluna bir dəfə toxunursunuz
4. `Göndərilməmişlər` siyahısına baxırsınız
5. hər şey düzgündürsə `Göndər` basırsınız

Nəticə:
bu sifariş mətbəxə ayrıca raund kimi gedir.

### 5.5. Raund nədir

Raund mətbəxə bir dəfəlik göndərilən sifariş dəstidir.

Misal:

`Raund 1`
- 2 dönər
- 1 ayran

10 dəqiqə sonra masa əlavə istəyir:

`Raund 2`
- 1 cola
- 1 kartof

Yəni:
- masa eynidir
- hesab eynidir
- amma göndərişlər tarixçə ilə ayrı görünür

Bu, həm mətbəxə, həm auditə, həm də ofisianta rahatlıq verir.

### 5.6. Göndərilməmişlər nədir

`Göndərilməmişlər` hələ mətbəxə getməyən məhsullardır.

Bu hissədə rahat dəyişiklik etmək olar:
- `+` artırır
- `Azalt` azaldır
- `Sil` tam çıxarır

Misal:

Səhvən `3 cola` seçmisiniz, amma masa `2 cola` istəyib.

Sadəcə:
- `Azalt` basın

Əgər hələ `Göndər` basılmayıbsa, mətbəx heç nə görməyəcək.

### 5.7. Göndərilmiş sifariş nədir

`Göndərilmişlər` artıq mətbəxə çatmış sifarişlərdir.

Burada normal `Sil` yoxdur.
Çünki mətbəxə gedən məhsul izsiz silinməməlidir.

Statusa görə bu əməliyyatlar görünə bilər:
- `Azalt`
- `Ləğv et`
- `Hesabdan sil`
- `İsraf`
- `Yenidən düzəlt`
- `Status tarixçəsi`

### 5.8. Səhv sifariş necə düzəldilir

Bu hissə çox vacibdir. Qayda belədir:

#### 1. Məhsul hələ göndərilməyibsə

Rahat düzəldin:
- `Azalt`
- `Sil`
- yenidən seçin

Misal:
- səhvən `1 ayran` yerinə `1 cola` seçmisiniz
- `Sil` basın
- sonra doğru məhsulu əlavə edin

#### 2. Məhsul göndərilib, amma hələ hazır deyil

Bu halda düzəliş etmək olar, amma artıq auditli şəkildə.

Misal 1:
`2 dönər` göndərmisiniz.
Qonaq deyir: “1 dənə olsun.”

Siz:
1. göndərilmiş item-də `Azalt` basırsınız
2. azaldılacaq miqdarı seçirsiniz
3. səbəbi qeyd edirsiniz

Nəticə:
- sistem bunu partial cancel kimi saxlayır
- mətbəx ekranında `STOP / LƏĞV TƏLƏBİ` görünür
- qalan item aktiv qalır

Misal 2:
Qeyd səhv yazılıb.
Məsələn `soğansız` olmalı idi, amma yazılmayıb.

Siz:
1. `Yenidən düzəlt` basırsınız
2. yeni qeydi yazırsınız

Nəticə:
- köhnə item “əvvəlkini hazırlama” məntiqi ilə işarələnir
- yeni düzəliş item-i ayrıca mətbəxə gedir

#### 3. Məhsul artıq hazırdırsa

Bu mərhələdə normal edit etməyin.

Artıq məhsul hazır sayılır.
Bu halda vəziyyətə görə:
- `Hesabdan sil`
- `İsraf`
- `Yenidən düzəlt`

istifadə olunur.

Misal:
Mətbəx dönəri hazır edib, amma müştəri qəbul etmir.

Bu zaman:
- ya manager qərarı ilə `Hesabdan sil`
- ya `İsraf`
- lazım olsa yenidən düzəliş sifarişi

### 5.9. Hesabdan sil nədir

Bu o deməkdir ki:
- məhsul tarixçədə qalır
- amma müştəridən onun pulu alınmır

Misal:
- məhsul çox gecikib
- manager deyir ki, bunu hesabdan çıxın

### 5.10. İsraf nədir

Bu o deməkdir ki məhsul:
- hazırlanıb
- amma istifadə olunmayıb
- və ya yararsız olub

Misallar:
- məhsul səhv hazırlanıb
- yerə düşüb
- masa imtina edib
- dublikat hazırlanıb

`İsraf` seçiləndə həm audit izi qalır, həm də anbar məntiqi buna uyğun işləyir.

### 5.11. Yenidən düzəlt nədir

Bu düymə məhsulun düzəlişlə yenidən hazırlanması üçündür.

Misal:
- burger göndərilib
- sonra məlum olur ki `pendirsiz` olmalıdır

Siz:
1. `Yenidən düzəlt` basırsınız
2. yeni qeydi yazırsınız

Nəticə:
- əvvəlki item ayrıca tarixçədə qalır
- yeni düzəliş item-i mətbəxə ayrıca gedir

### 5.12. Servis hissəsi

Mətbəx məhsulu `Hazırdır` etdikdən sonra məhsul `Servis` hissəsində görünür.

Ofisiant:
1. məhsulu masaya aparır
2. sonra sistemdə `Servis edildi` basır

Bu addım vacibdir, çünki sistem məhsulun artıq qonağa verildiyini buradan bilir.

### 5.13. Hesabı necə bağlamaq

Masa sonunda:
1. masa detalını açın
2. hesabı yoxlayın
3. lazım olsa split edin
4. ödənişi alın
5. hesabı bağlayın

Misal:

Masa hesabı `36 AZN`-dir.

Ödəniş:
- `20 AZN` nəğd
- `16 AZN` kart

Bu halda:
- `Split` ilə hissələri bölürsünüz
- sonra təsdiqləyirsiniz

### 5.14. Masa bağlanandan sonra nə olur

Hesab bağlanandan sonra masa avtomatik `Təmizlik` statusuna keçir.

Bu zaman:
- yeni müştəri dərhal açılmamalıdır
- əvvəl fiziki təmizlik edilməlidir
- sonra sistemdə `Təmizlə` basılmalıdır

## 6. Mətbəx Ekranı (KDS)

`KDS` mətbəxin işlədiyi əsas ekrandır.

Burada mətbəx görür:
- masa nömrəsi
- raund nömrəsi
- məhsul adı
- miqdar
- qeyd və düzəlişlər
- status

### 6.1. Mətbəxdə normal iş axını

1. yeni sifariş gəlir
2. mətbəx `Başla` basır
3. məhsul hazırlanır
4. hazır olanda `Hazırdır`
5. lazım olsa pickup/servis statusu görünür

### 6.2. KDS-də xüsusi siqnallar

#### `STOP / LƏĞV TƏLƏBİ`

Bu o deməkdir ki ofisiant göndərilmiş sifarişdə düzəliş edib və mətbəx diqqətli olmalıdır.

Misal:
- 2 dönər gedib
- sonra 1-i ləğv olunub

KDS-də bu ayrıca görünür.

#### `Yenidən düzəlt`

Bu o deməkdir ki əvvəlki item-də düzəliş olub və yenisi hazırlanmalıdır.

Misal:
- köhnə burger normal idi
- yenisi `pendirsiz` hazırlanmalıdır

#### `İsraf`

Bu məhsulun istifadə olunmadığını göstərir.

### 6.3. Hazır məhsul bildirişi

Mətbəx `Hazırdır` etdikdən sonra məsul ofisiant bunu masa ekranında görür.

Ofisiant məhsulu aparıb `Servis edildi` etdikdə zəncir tamamlanır.

## 7. Depozit Məntiqi

Depozit sadəcə alınan pul deyil.
Sistem onu ayrıca öhdəlik kimi saxlayır.

Bu o deməkdir ki depozit:
- satış gəliri deyil
- dərhal qazanc sayılmır
- hesab bağlananda istifadə olunur və ya ayrıca qaytarılır

### 7.1. Misal

`Masa 5` açılır.

- 3 nəfər oturur
- hər nəfər `5 AZN` depozit verir

Nəticə:
- kassada pul artır
- amma bu satış gəliri sayılmır
- `Aktiv masa depozit öhdəliyi` artır

Masa bağlananda:
- depozit hesabda istifadə olunursa, öhdəlik azalır
- qalan məbləğ ayrıca qaytarıla bilər

## 8. Maliyyə Modulu

`Maliyyə` modulu menecer üçün “pulun hardan gəlib-hara getdiyi” ekranıdır.

Sadə qayda:
- pul daxil olubsa: hansı hesab artdı?
- pul çıxıbsa: hansı hesab azaldı?
- fərq varsa: səbəb nədir və kim təsdiqləyib?

### 8.0. 3 dəqiqəlik sürətli başlanğıc

1. `Baxış` tabında `Nağd`, `Kart`, `Seyf`, `Aktiv depozit` rəqəmlərinə baxın.
2. `Alert` varsa əvvəl onu açın, səbəbi görün.
3. `Pending approval` varsa əməliyyatı təsdiq/rədd edin.
4. Gün içində bir dəfə `X-Hesabat`, gün sonunda `Z-Hesabat` edin.

Bu 4 addımı etsəniz, gündəlik maliyyə idarəsi nəzarətdə olur.

### 8.1. Maliyyə ekranını necə oxumaq

`Baxış` tabında əvvəlcə bunlara baxın:
1. `Nağd kassa`
2. `Bank/Kart`
3. `Seyf`
4. `Aktiv depozitlər`
5. `Bugünkü net`

Sonra xəbərdarlıqları oxuyun:
- `Kassa uyğun deyil`
- `Təsdiq gözləyən əməliyyat var`
- `Uyğunlaşdırma tamamlanmayıb`

Əgər qırmızı xəbərdarlıq varsa, əvvəl onu həll edin.

### 8.2. Sürətli əməliyyatlar (hansı düymə nə üçündür)

- `Mədaxil yaz`: kassa/kart/seyfə real pul daxil olur
- `Xərc yaz`: hesabdan pul çıxır (xammal, kommunal, maaş və s.)
- `Daxili transfer`: hesablar arası hərəkət (gəlir/xərc deyil)
- `Investor ödə`: investor borcunu azaltmaq üçün ödəniş
- `Depozit əməliyyatı`: depozit öhdəliyi ilə bağlı hərəkətlər
- `Uyğunlaşdırma`: sistem məbləği ilə faktiki sayımı tutuşdurma
- `Düzəliş`: yalnız əsaslandırılmış fərq düzəlişləri üçün

Qısa seçim qaydası:
- Pul real olaraq kassaya gəlibsə: `Mədaxil yaz`
- Pul kassadan çıxıbsa: `Xərc yaz`
- Sadəcə hesablar arası yer dəyişibsə: `Daxili transfer`
- Investor borcu qaytarılırsa: `Investor ödə`

### 8.3. Praktik ssenarilər

#### A) Xərc yazmaq

Misal: təchizatçıya `40 AZN` ödənilib.
1. `Xərc yaz`
2. mənbə hesabı: `Kassa`
3. kateqoriya: `Xammal`
4. məbləğ: `40`
5. `Yadda saxla`

#### B) Daxili transfer

Misal: seyfdən kassaya `100 AZN`.
1. `Daxili transfer`
2. `Seyf -> Kassa`
3. məbləğ `100`
4. təsdiq et

Qeyd: bu əməliyyat gəlir sayılmır.

#### C) Investor ödənişi

Misal: investor borcundan `200 AZN` qaytarılır.
1. `Investor ödə`
2. mənbə hesabını seç (`Kassa/Kart/Seyf`)
3. məbləği yaz
4. təsdiqlə

Bəzi məbləğlər policy-yə görə `Təsdiq qutusu`na düşə bilər.

### 8.4. Uyğunlaşdırma (Reconciliation)

Bu hissədə 3 rəqəm vacibdir:
- `Expected` (sistemin gözlədiyi)
- `Counted` (faktiki saydığınız)
- `Variance` (fərq)

Fərq `0` deyilsə:
1. əvvəl əməliyyat tarixçəsini yoxlayın
2. sonra səbəbi qeyd edib uyğunlaşdırma yaradın
3. lazım olsa rəhbər təsdiqi ilə düzəliş edin

### 8.5. Təsdiq qutusu

Aşağıdakı əməliyyatlar burada gözləyə bilər:
- böyük transfer
- investor ödənişi
- reversal
- cash adjustment

Qərar:
- `Təsdiq et` → əməliyyat post olunur
- `Rədd et` → əməliyyat bağlanır, audit izi qalır

### 8.6. Maliyyə jurnalı (Audit üçün)

Hər sətirdə görünür:
- tarix/saat
- status (`pending_approval`, `posted`, `rejected`, `reversed`)
- mənbə hesab → hədəf hesab
- məbləğ
- qeyd

Sətir detalında görünür:
- debit/credit maliyyə yazılışları
- audit log tarixçəsi
- təsdiq edən istifadəçi
- reversal bağlantıları

### 8.7. Menecer üçün 1 dəqiqəlik gündəlik yoxlama

1. `Baxış` kartları
2. qırmızı/sarı alert-lər
3. `Təsdiq qutusu`
4. `Maliyyə jurnalı`nda son 10 əməliyyat
5. `X-Hesabat` və gün sonunda `Z-Hesabat`

### 8.8. Edilməməli olanlar

- `Pending` statuslu əməliyyatı “bitmiş” saymaq olmaz.
- Səbəbsiz `Düzəliş` (adjustment) etmək olmaz.
- Fərq böyükdürsə approval gözləmədən bağlama etməyin.
- Investor ödənişini jurnalda `posted` görmədən yekun hesablamayın.

## 9. X-Hesabat

`X-Hesabat` növbə bağlanmadan ara yoxlamadır.

Operator kassadakı real məbləği sayır və sistemdəki `olmalı kassa` ilə tutuşdurur.

Əgər fərq varsa:
- `Kassa Artığı`
- və ya `Kassa Kəsiri`
yaranır

Qeyd:
- policy threshold-dan böyük fərq birbaşa post olmaya bilər, `pending approval` yarana bilər.
- məqsəd “fərqi gizlətmək” yox, səbəbi auditlə yazmaqdır.

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

### 10.3. Z-Hesabat bağlanış qaydası (praktik)

1. faktiki kassanı sayın
2. `actual cash` sahəsinə yazın
3. varsa `wage` məbləğini düzgün yazın
4. depozit öhdəliyi açıqdırsa:
   - əvvəl masa/depozit axınında bağlayın
   - və ya qaydaya uyğun `allow_open_deposit_close` ilə bağlayın
5. bağlayışdan sonra fərq və depozit qalığını yenidən yoxlayın

Vacib:
- Z-Hesabatdan sonra növbə rəqəmləri audit üçün saxlanır (`actual`, `declared`, `variance`, `closing cash`).

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

Qeyd:
- böyük fərq varsa `accept` zamanı adjustment birbaşa post olmaq əvəzinə `pending approval` yarada bilər.
- bu, kassir riskini azaltmaq üçündür.

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
- `Satış və maliyyə yazılışı fərqi`
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

Əgər `Gap` sıfırdan fərqlidirsə, kassa sayımı və maliyyə yazılışları yoxlanmalıdır.

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

Əgər satış rəqəmi ilə maliyyə yazılışı rəqəmi uyğun gəlmirsə, sistem xəbərdarlıq göstərə bilər.

## 14. Logs

`Logs` sistem tarixçəsini göstərir.

Burada artıq ayrıca:
- `Maliyyə auditləri`
filter-i də var

Bu hissədə sistemin gördüyü risklər saxlanılır:
- `satış və maliyyə yazılışı fərqi`
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

## 20. CI Troubleshooting (Backend Test Fail üçün)

Əgər GitHub Actions-da `Backend Checks` qırılırsa, bu ardıcıllıqla yoxlayın:

1. Yalnız ən son commit run-una baxın (`main` branch).
2. `Backend Checks > Debug tested commit and finance snippets` addımını açın.
3. `GITHUB_SHA` ilə local `git rev-parse --short HEAD` eyni olmalıdır.
4. `backend/pytest.ini` içində bu sətir görünməlidir:
   - `asyncio_default_fixture_loop_scope = function`
5. `backend/app/routers/reports.py` debug hissəsində bu guard görünməlidir:
   - `if not hasattr(db, "query")`
6. Köhnə failed run-u `Re-run` etməyin; yeni commit ilə yeni run başladın.

Tez diaqnostika üçün lokal komandalar:

```bash
cd /Users/admin/ironwaves-pos-platform
git branch --show-current
git rev-parse --short HEAD
git rev-parse --short origin/main
grep -n 'asyncio_default_fixture_loop_scope = function' backend/pytest.ini
grep -n 'if not hasattr(db, "query")' backend/app/routers/reports.py
```

## 21. Son Dəyişikliklər (Changelog Snapshot)

Son sabitləşdirmələr:

- `reports.py`: staff shift setting helper-lərində FakeDB-safe guard əlavə olundu (`query/add` olmayan test session-lar üçün).
- `ci.yml`: debug addımı genişləndirildi (`pytest.ini`, `reports.py`, finance snippet-lər loga çıxır).
- `ci.yml`: backend pytest çalışması explicit loop-scope ilə işə düşür:
  - `python -m pytest -o asyncio_default_fixture_loop_scope=function`
- `Recipes`: AI resept axını inventory fallback + Affogato üçün məcburi packaging qaydaları ilə sərtləşdirildi.
- `Recipes UI`: `Yadda saxla` düyməsi disabled səbəbini tooltip ilə daha dəqiq göstərir (AI auto-save mesajı daxil).
