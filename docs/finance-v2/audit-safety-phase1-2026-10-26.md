# Maliyyə auditi — birinci təhlükəsizlik paketi

Tarix: 26 oktyabr 2026. Baza commit: `1d2cce57`. Branch: `codex/finance-audit-safety-phase1`.

İstək: 25 oktyabr maliyyə auditinin tətbiqinə başlamaq; tenantların təxminən 90 dəqiqə sonra işə başlayacağını nəzərə alaraq müştəri məlumatlarını qorumaq.

## Production sərhədi

Bu iş yalnız lokal branch və sintetik test bazalarında hazırlanıb. Railway-də deploy, production SQL, tenant rejimi/hesabat mənbəyi dəyişikliyi, tarixi balans düzəlişi və schema migration edilməyib. `main` branch-ə push edilməyib. Bu paket production-da quraşdırılmış hesab edilmir; production-da aşkar edilmiş boşluqlar hələ mövcud ola bilər.

Bu paket yeni cədvəl, sütun və ya data migration tələb etmir. Keçmiş əməliyyatları, əvvəlcədən yaradılmış təsdiq sorğularını və maliyyə tarixçəsini yenidən yazmır. Yeni yoxlamalar gələcək manual əməliyyatların yaradılması/təsdiqi zamanı işləyir.

## Dəyişikliklər

### F01: birbaşa transferdə təsdiqdən yayınma

`/finance/transfer` tenantın serverdəki cari təsdiq siyasətini yoxlayır. Təsdiq tələb olunan məbləğ üçün HTTP 409 qaytarır və pul hərəkəti yaratmır. Mövcud UI böyük transferləri artıq jurnal/təsdiq yoluna göndərir; köhnəlmiş siyasətlə işləyən klient yenilənmə tələb edən mesaj görür.

Məbləğ siyasət yoxlanmazdan əvvəl qəpiyə yuvarlaqlaşdırılır. Məsələn 499.999 → 500.00: 500 həddi bu yolla keçilə bilmir. Böyük transferi bu endpoint-də avtomatik təsdiq sorğusuna çevirməmək qəsdən seçilib: komissiyanın ayrıca təsdiqi (F10) həll olunmamış əlavə parçalanmış sorğular yaratmırıq.

### F02: manual əməliyyatların balans nəzarəti

Ortaq manual kapasite yoxlaması xərc, daxili transfer, kassa/uyğunlaşdırma düzəlişi və depozit qaytarılması/azad edilməsi üçün cash/card/safe çıxışlarını əhatə edir. Hesablar sabit kod sırası ilə kilidlənir; cari legacy jurnal qalığı oxunur. Yoxlama həm sorğu yaradılarkən, həm də təsdiqdən əvvəl təkrarlanır.

Gözləyən sorğular pulu rezerv etmir. İki sorğu əvvəlcədən yaradıla bilər, amma birincinin ödənişindən sonra vəsait çatmırsa ikinci təsdiqlənmir. Uğursuz təsdiq əvvəlki pending statusu və metadata-nı saxlayır, əlavə pul yazılışı yaratmır. İnvestor qaytarılmasının mövcud borc+vəsait yoxlaması saxlanılıb.

Yoxlama manual API sərhədindədir. Ümumi posting servisinə qlobal mənfi-balans qadağası əlavə edilməyib: POS qaytarması, tarixçənin əks yazılışı və GL migration fərqli müqavilələrə malikdir. `legacy` və `dual` sintetik tenantlarda sınaqdan keçirilib. GL-only manual pul düzəlişlərinin legacy ilə uzlaşdırılması ayrıca nəzərdən keçirilməlidir; bu paket mühasibat arxitekturasını dəyişmir.

### F03: etibarlı uyğunlaşdırma snapshot-u

Server hesabı kilidləyib gözlənilən qalığı özü jurnaldan oxuyur. Klientin göndərdiyi gözlənilən məbləğ cari balansla uyğun gəlmirsə HTTP 409 qaytarır və uyğunlaşdırma qeydi yaratmır. Uyğun gəlirsə serverdən oxunmuş məbləğ saxlanır. Sayılmış məbləğdən yaranan fərq qeyd edilir; uyğunlaşdırma özlüyündə pul köçürmür.

## Yoxlamalar

- Yeni SQLite regressiya matrisi: **48 keçdi**. Düzəlişdən əvvəl eyni matrisdə **42 uğursuz, 6 keçən** vardı.
- Manual maliyyə, əvvəlki kritik düzəlişlər, locking və GL dual axınlarından seçilmiş dəst: **99 keçdi**.
- Bütün backend dəsti: **1290 keçdi, 4 uğursuz, 36 skipped**.
- Lokal PostgreSQL 18 üzərində bütün inteqrasiya dəsti: **35 keçdi**; bunun **8-i yeni paralellik sınağıdır**.
- `git diff --check`: keçdi.

Yeni PostgreSQL sınaqları həm legacy, həm dual tenantda eyni pulun iki dəfə xərclənməsinin qarşısını, iki təsdiqin cari balansı görməsini, yazılışla paralel sayımın köhnə snapshot-u rədd etməsini və əks istiqamətli transferlərin sabit kilid sırasını yoxlayır. Dual variantlarda shadow sync-dən sonra reconciliation da yoxlanır.

Dörd uğursuz backend testi əvvəlki auditdə də olan `test_push_schedule_api.py` testləridir. Onlar 12 oktyabr 2026 tarixini gələcək vaxt kimi sabitləşdirir; cari 26 oktyabrda tarix validasiyası gözlənilən başqa xətadan əvvəl işləyir. Bu paketdə dəyişdirilməyib. 36 skipped-in 8-i yeni PG sınaqlarının SQLite işə salınmasında ötürülməsidir; hamısı ayrıca PG run-da keçir.

PostgreSQL test bazası ayrıca `iw-finance-phase1-pg-20261026` konteynerində, yalnız localhost-a açılmış təsadüfi portda yaradıldı. Staging/production dump istifadə edilmədi. Köhnə migration zənciri boş bazadan tam bootstrap etmir: əvvəl legacy model sxemi yaradılıb `20260905_0002` qeyd edildi, sonra finance migration-ları `20261002_0001`-ə qədər tətbiq olundu (GL trigger-ləri daxil), digər test cədvəlləri metadata ilə yaradıldı. Bu, production üçün sıfırdan migration rehearsal-u deyil. Bu paketin özü migration əlavə etmir.

Yoxlama logları lokal `outputs/finance-safety-phase1-2026-10-26/` qovluğundadır.

## Növbəti paketlər və buraxılış

1. F10: transfer və komissiyanın bir server sənədi və atomik təsdiq kimi hazırlanması; F09: tenant üzrə təkrar sorğu qorunması. Ayrı regressiya və PG sınaqları tələb edir.
2. F04–F07: təsnifat, təchizatçı pul axını, legacy balans və Bakı vaxtı. Tarixi məlumatı yenidən yazmadan oxuma/yazma qaydalarını ayırmaq; keçmiş düzəlişləri ayrıca razılaşdırmaq.
3. F08, F11–F20: etibarlı yüklənmə/xəta vəziyyətləri, tam və təhlükəsiz ixrac, səhifələmə, qarşı tərəf və mobil UI/UX.

Buraxılış üçün konkret paket review-dan keçməli, ayrıca bərpa edilə bilən backup təsdiqlənməli və iş saatına təsiri nəzərə alınaraq vaxt seçilməlidir. Production balanslarının dəyişdirilməsi, tenant rejimlərinin keçidi və tarixçə düzəlişləri bu lokal işin tərkib hissəsi deyil.
