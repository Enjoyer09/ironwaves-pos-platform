# Ofisiant üçün iRonWaves POS qısa istifadə kitabçası

Bu sənəd ofisiant üçündür. Məqsəd sadədir: masa aç, sifarişi yaz, mətbəxə göndər, hazır olanda servis et, axırda hesabı bağla.

Burada çox texniki söz yoxdur. Sistem nə istəyir, sən nə etməlisən, onu addım-addım yazmışıq.

---

## 1. POS nə üçündür?

`POS` əsasən al-apar və kassadan birbaşa satış üçündür.

Məsələn:

- müştəri gəldi, 1 kofe aldı
- masada oturmadı
- pulu yerində verdi

Bu halda `POS` istifadə olunur.

Masaya oturan müştəri üçün isə əsas yer `Masalar` bölməsidir.

Qısa yadda saxla:

- Al-apar satış: `POS`
- Masada oturan qonaq: `Masalar`
- Mətbəx işi: `KDS / Mətbəx`

---

## 2. POS-da al-apar satış necə edilir?

1. `POS` aç.
2. Məhsulu seç.
3. Məhsul səbətə düşür.
4. Miqdarı lazımdırsa artır və ya azalt.
5. Ödəniş növünü seç:
   - `Nəğd`
   - `Kart`
   - `Split`
6. `Ödənişi tamamla` bas.

Nümunə:

Müştəri 1 kofe alır.

1. `Kofe` seç.
2. `Nəğd` seç.
3. `Ödənişi tamamla` bas.

Bu qədər.

---

## 3. Split nədir?

`Split` o deməkdir ki, hesab bir neçə hissə ilə ödənir.

Nümunə:

Hesab `20 AZN`-dir.

- `5 AZN` nəğd
- `15 AZN` kart

Sistemdə:

1. `Split` seç.
2. Nəğd hissəni yaz.
3. Sistem qalan hissəni kart kimi hesablayır.
4. Təsdiqlə.

---

## 4. Masalar bölməsi nə üçündür?

Ofisiantın əsas yeri `Masalar`dır.

Burada sən:

- masa açırsan
- qonaq sayını yazırsan
- sifarişi vurursan
- mətbəxə göndərirsən
- hazır məhsulu servis edirsən
- hesabı alırsan
- masa təmizlənəndən sonra `Təmizlə` basırsan

---

## 5. Masa rəngləri nə deməkdir?

Masanın rənginə bax, çox şeyi oradan biləcəksən.

- Yaşıl: masa boşdur
- Sarı: masa rezervdir
- Qırmızı və ya bənövşəyi: masa doludur, hesab açıqdır
- Boz və ya təmizlik statusu: masa təmizlənməlidir

Əgər masa `Təmizlik` statusundadırsa, ora yeni qonaq oturtma.

Əvvəl masa fiziki təmizlənsin, sonra sistemdə `Təmizlə` bas.

---

## 6. Masa necə açılır?

1. `Masalar` bölməsinə gir.
2. Boş masaya bas.
3. Qonaq sayını yaz.
4. Depozit varsa depozitli qonaq sayını yaz.
5. `Masanı aç` bas.

Nümunə:

`Masa 1`-ə 3 nəfər oturdu.

- Qonaq sayı: `3`
- Hərəsindən depozit alınıbsa depozitli qonaq sayı: `3`
- `Masanı aç`

Əgər masa rezervdədirsə, sistem xəbərdarlıq edəcək. Belə masanı özbaşına açma.

---

## 7. Masaya sifariş necə yazılır?

Masa açıq olanda sağ tərəfdə sifariş paneli açılır.

Sən məhsulları seçirsən, onlar əvvəl `Göndərilməmişlər` siyahısına düşür.

Yəni hələ mətbəxə getməyib.

Addım-addım:

1. Açıq masaya bas.
2. `Yeni sifariş` bölməsini görəcəksən.
3. Məhsullara toxun.
4. Məhsullar `Göndərilməmişlər` siyahısına düşür.
5. Lazımdırsa `+`, `Azalt`, `Sil` et.
6. Hər şey düzdürsə, `Göndər` bas.

Nümunə:

Masa 1 istəyir:

- 2 dönər
- 1 kola

Sən:

1. `Dönər`ə 2 dəfə toxun.
2. `Kola`ya 1 dəfə toxun.
3. `Göndər` bas.

Bu sifariş mətbəxə `Raund 1` kimi gedir.

Masa açıq qalır. Sonra əlavə sifariş yazmaq olar.

---

## 8. Raund nədir?

Raund mətbəxə bir dəfə göndərilən sifariş dəstidir.

Nümunə:

Birinci göndəriş:

- 2 dönər
- 1 kola

Bu `Raund 1` olur.

Sonra müştəri əlavə istəyir:

- 1 ayran
- 1 kartof

Bu da `Raund 2` olur.

Yəni masa eyni masadır, hesab eyni hesabdır, amma mətbəxə göndərişlər ayrı-ayrı tarixçə kimi qalır.

---

## 9. Göndərilməmişlər nədir?

`Göndərilməmişlər` hələ mətbəxə getməyən məhsullardır.

Burada rahat dəyişiklik edə bilərsən:

- `+` miqdarı artırır
- `Azalt` miqdarı azaldır
- `Sil` məhsulu siyahıdan çıxarır

Nümunə:

Səhvən 2 kola seçmisən, amma 1 kola lazımdır.

`Azalt` bas.

Əgər hələ `Göndər` basmamısansa, mətbəx bu məhsulu görmür. Ona görə burada düzəliş rahatdır.

---

## 10. Göndərilmişlər nədir?

`Göndərilmişlər` artıq mətbəxə gedən məhsullardır.

Burada artıq adi `Sil` yoxdur.

Çünki mətbəxə gedən məhsul izsiz silinməməlidir.

Bu hissədə statusa görə düymələr görünür:

- `Azalt`
- `Ləğv et`
- `Hesabdan sil`
- `İsraf`
- `Yenidən düzəlt`
- `Status tarixçəsi`

---

## 11. Mətbəxə gedən məhsulu azaltmaq

Əgər məhsul mətbəxə gedib, amma hələ hazır deyilsə, azaltmaq olar.

Amma bu adi silmə deyil. Sistem mətbəxə xəbər göndərir və tarixçədə saxlayır.

Nümunə:

2 dönər göndərmisən.

Müştəri deyir: “1 dənə olsun.”

Sən:

1. Göndərilmiş dönərin yanında `Azalt` bas.
2. Azaldılacaq miqdar: `1`
3. Səbəb tipi: `Müştəri fikrini dəyişdi`
4. Təsdiqlə.

Nəticə:

- mətbəxdə 1 dönər üçün `STOP / LƏĞV TƏLƏBİ` görünür
- qalan 1 dönər aktiv qalır
- sistem bunu tarixçədə saxlayır

---

## 12. Ləğv et nədir?

`Ləğv et` mətbəxə getmiş məhsulu tam dayandırmaq üçündür.

Nümunə:

1 dönər göndərilib.

Müştəri deyir: “İstəmirəm.”

Sən:

1. `Ləğv et` bas.
2. Səbəb tipi seç:
   - səhv daxil edilib
   - müştəri fikrini dəyişdi
   - dublikat sifariş
   - digər
3. Lazımdırsa qeyd yaz.
4. Təsdiqlə.

Nəticə:

- KDS-də mətbəxə `STOP / LƏĞV TƏLƏBİ` gedir
- item izsiz silinmir
- kim ləğv edib, nə vaxt ləğv edib, səbəb nədir, hamısı qalır

---

## 13. Hesabdan sil nədir?

`Hesabdan sil` o deməkdir ki, məhsul tarixçədə qalır, amma müştəridən pulu alınmır.

Nümunə:

Məhsul çox gecikib.

Manager deyir: “Bunu müştərinin hesabından sil.”

Sən:

1. `Hesabdan sil` bas.
2. Lazımdırsa manager şifrəsi yazılır.
3. Təsdiqlə.

Nəticə:

- item tarixçədə qalır
- hesabdan çıxılır
- auditdə görünür

---

## 14. İsraf nədir?

`İsraf` məhsulun istifadəyə getmədiyini göstərir.

Nümunələr:

- məhsul səhv hazırlanıb
- məhsul düşüb
- qonaq gedib
- mətbəx dublikat hazırlayıb

Sən:

1. `İsraf` bas.
2. Səbəb seç.
3. Lazımdırsa qeyd yaz.
4. Təsdiqlə.

Nəticə:

- item `İsraf` kimi qeyd olunur
- hesabdan çıxır
- auditdə qalır

---

## 15. Yenidən düzəlt nədir?

`Yenidən düzəlt` səhv gedən məhsulu yeni düzəlişlə mətbəxə göndərmək üçündür.

Nümunə:

Dönər mətbəxə gedib.

Amma qonaq deyir: “Soğansız olmalı idi.”

Sən:

1. Dönərin yanında `Yenidən düzəlt` bas.
2. Qeyd yaz: `soğansız`
3. Təsdiqlə.

Nəticə:

- köhnə item mətbəxdə “əvvəlkini hazırlama” kimi görünür
- yeni item `REMAKE / DÜZƏLİŞ` kimi mətbəxə gedir
- mətbəx yeni düzəliş sətrini hazırlayır

---

## 16. Hazır olmamış məhsulda nə etmək olar?

Əgər status:

- `SENT`
- `PREPARING`

olarsa, məhsul hələ tam hazır deyil.

Bu halda ofisiant düzəliş edə bilər:

- `Azalt`
- `Ləğv et`
- `Hesabdan sil`
- `İsraf`
- `Yenidən düzəlt`

Amma bu düzəlişlər izsiz olmur. Sistem hamısını qeyd edir və mətbəxə xəbər verir.

---

## 17. Hazır məhsulda nə etmək olar?

Əgər məhsul `READY` statusundadırsa, deməli mətbəx artıq onu hazır edib.

Bu mərhələdə adi edit yoxdur.

Bu zaman daha ciddi action-lar istifadə olunur:

- `Hesabdan sil`
- `İsraf`
- `Yenidən düzəlt`

Bəzi hallarda manager şifrəsi istənə bilər.

---

## 18. Servis bölməsi

Mətbəx məhsulu hazır edəndə, o `Servis` bölməsində görünür.

Sən məhsulu müştəriyə apardıqdan sonra:

`Servis edildi` bas.

Nümunə:

KDS dönəri hazır etdi.

Sən dönəri masaya apardın.

Sonra sistemdə `Servis edildi` bas.

Bu, məhsulun artıq qonağa verildiyini göstərir.

---

## 19. KDS nədir?

KDS mətbəxin ekranıdır.

Mətbəx burada görür:

- masa nömrəsi
- raund
- məhsul adı
- miqdar
- status
- ləğv və düzəliş siqnalları

Mətbəxdə əsas düymələr:

- `Başla`
- `Hazırdır`
- `Servis edildi`

---

## 20. KDS-də STOP görünsə nə etmək lazımdır?

Əgər KDS-də `STOP / LƏĞV TƏLƏBİ` görünsə:

- həmin məhsulu hazırlamağı dayandır
- ofisiant və ya manager təsdiqini gözlə
- kor-koranə `Hazırdır` basma

Bu o deməkdir ki, qonaq məhsuldan imtina edib və ya sifarişdə dəyişiklik var.

---

## 21. KDS-də REMAKE / DÜZƏLİŞ görünsə nə etmək lazımdır?

Bu o deməkdir:

- əvvəlki məhsulda səhv var
- yeni düzəliş sətri hazırlanmalıdır
- köhnə məhsul hazırlanmasın

Nümunə:

Köhnə sifariş: `Dönər`

Düzəliş: `Dönər soğansız`

Mətbəx:

- köhnəni saxlayır
- yeni `REMAKE / DÜZƏLİŞ` sətrini hazırlayır

---

## 22. Status tarixçəsi nədir?

`Status tarixçəsi` hər item-in keçmişini göstərir.

Burada görünür:

- kim dəyişib
- nə vaxt dəyişib
- əvvəlki status nə idi
- yeni status nə oldu
- səbəb nə idi
- miqdar dəyişibmi

Bu mübahisə olanda çox lazımlıdır.

Nümunə:

Qonaq deyir: “Mən ləğv etməmişdim.”

Manager `Status tarixçəsi`nə baxır və görür:

- kim ləğv edib
- saat neçə idi
- səbəb nə yazılıb

---

## 23. Anbar qaydası: mal nə vaxt qayıdır, nə vaxt zibilə gedir?

Bunu sadə yadda saxla:

Məhsul hələ mətbəxə getməyibsə, anbara heç nə olmur.

Çünki sistem o məhsulun reseptindəki malları hələ anbardan çıxmayıb.

### Göndərilməmiş məhsulu silsən

Məsələn:

- səhvən `Dönər` seçdin
- hələ `Göndər` basmamısan
- `Sil` basdın

Bu halda:

- mətbəx görmür
- anbar dəyişmir
- zibilə heç nə getmir

### Mətbəxə gedib, amma hazır olmayıbsa

Məsələn:

- `2 Dönər` mətbəxə göndərildi
- mətbəx hələ `Hazırdır` etməyib
- qonaq 1 dənəsindən imtina etdi

Sən `Azalt` və ya `Ləğv et` edirsən.

Bu halda:

- mətbəxə `STOP / LƏĞV TƏLƏBİ` gedir
- anbar dəyişmir
- çünki məhsul hələ hazır sayılmır

### İsraf seçsən

`İsraf` o deməkdir ki, məhsul artıq işlənib və zay oldu.

Məsələn:

- səhv hazırlanıb
- yerə düşüb
- qonaq gedib, məhsul artıq istifadə olunmur
- mətbəx artıq ona əmək və mal sərf edib

Bu halda:

- məhsul müştərinin hesabından çıxır
- reseptindəki mallar anbardan silinir
- sistem bunu auditdə `israf / zay` kimi saxlayır

Yəni `İsraf` basanda sistem bunu “zibilə getdi” kimi qəbul edir.

### Hesabdan sil nə deməkdir?

`Hesabdan sil` o deməkdir ki, məhsul tarixçədə qalır, amma müştəridən pulu alınmır.

Əgər məhsul artıq `READY` və ya `SERVED` olubsa:

- məhsul hazırlanmış sayılır
- müştəridən pulu alınmır
- amma resept malları anbardan silinir

Yəni pulsuz verdik, amma mal işlənib.

### Yenidən düzəlt nə deməkdir?

Əgər məhsul hələ hazır deyilsə:

- köhnə item dayandırılır
- yeni düzəliş item-i mətbəxə gedir
- köhnə item üçün anbar silinməyə bilər

Əgər məhsul artıq hazır idisə:

- köhnə məhsul zay kimi sayılır
- resept malları anbardan silinir
- yeni düzəliş item-i ayrıca hazırlanır və o da normal qaydada stokdan düşür

Qısa cümlə:

Hazırlanmayan səhv sifariş anbara təsir etmir. Hazırlanmış, zay olmuş və ya pulsuz verilmiş məhsul isə anbardan düşür.

---

## 24. Hesabı necə bağlamaq lazımdır?

Masa hesabı bağlamaq üçün:

1. Masanı aç.
2. `Hesabı al` bas.
3. Ödəniş növünü seç:
   - nəğd
   - kart
   - split
4. Məbləği yoxla.
5. Təsdiqlə.

Əgər depozit varsa, sistem onu nəzərə alır.

Əgər servis haqqı ayarda yazılıbsa, sistem onu da əlavə edir.

Nümunə:

- Sifariş cəmi: `20 AZN`
- Servis haqqı: `5%`
- Yekun: `21 AZN`
- Depozit: `10 AZN`
- Əlavə alınacaq: `11 AZN`

---

## 25. Masa bağlanandan sonra nə olur?

Hesab bağlananda masa `Təmizlik` statusuna keçir.

Bu o deməkdir:

- masa artıq ödənib
- amma yeni qonaq oturtmaq olmaz
- əvvəl masa fiziki təmizlənməlidir

Təmizlik bitəndən sonra:

`Təmizlə` bas.

Sonra masa yenidən boş olur.

---

## 26. Ofisiant üçün qızıl qaydalar

1. Masada oturan qonaq üçün `Masalar` bölməsindən işləyin.
2. Məhsulu seçəndən sonra `Göndər` basmağı unutmayın.
3. `Göndərilməmişlər` hələ mətbəxə getməyib, rahat düzəldə bilərsiniz.
4. `Göndərilmişlər` artıq mətbəxə gedib, izsiz silmək olmaz.
5. Müştəri fikrini dəyişsə, `Ləğv et` və ya `Azalt` istifadə edin.
6. Məhsul səhv gedibsə, `Yenidən düzəlt` istifadə edin.
7. Məhsul hazır olubsa, adi edit etməyin.
8. Mətbəxdə `STOP` görünürsə, həmin item-i hazırlamaq olmaz.
9. `İsraf` basırsınızsa, sistem bunu zay məhsul kimi anbardan çıxarır.
10. Hazırlanmış məhsulu `Hesabdan sil` edəndə müştəridən pul alınmır, amma mal anbardan düşür.
11. Hesab bağlanandan sonra masa təmizlənmədən yeni qonaq oturtmayın.
12. Şübhəli halda manager çağırın.

Ən vacib cümlə:

Mətbəxə gedən məhsul izsiz silinmir. Hər şey sistemdə qalır.
