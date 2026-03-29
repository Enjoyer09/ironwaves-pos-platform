# Wildcard Subdomain Deploy Guide

Bu sənəd `*.ironwaves.store` wildcard modeli ilə yeni tenant açmaq üçündür.

Nümunə tenant:

- `gyrospos.ironwaves.store`

Bu guide sizin hazır arxitekturaya uyğundur:

- eyni frontend service
- eyni backend service
- eyni Neon Postgres
- hər şirkət ayrıca `tenant_id` ilə ayrılır

## Qısa Məntiq

Siz yeni Railway app yaratmırsınız.

Siz yeni Neon database yaratmırsınız.

Siz bunları edirsiniz:

1. Railway frontend service-ə `*.ironwaves.store` wildcard domain əlavə edirsiniz
2. DNS provider-də wildcard CNAME yazırsınız
3. App içində yeni tenant yaradırsınız
4. Tenant smoke-test edirsiniz

## Arxitektura

- `www.ironwaves.store` = landing page
- `demo.ironwaves.store` = demo tenant
- `super.ironwaves.store` = əsas production tenant və ya əsas giriş nöqtəsi
- `gyrospos.ironwaves.store` = yeni müştəri tenant-ı
- `socialbee.ironwaves.store` = başqa tenant

## NeonDB-də Nə Edəcəksiniz

Hazırkı quruluşda Neon-da ayrıca heç nə etmirsiniz.

Yeni tenant üçün:

- yeni database yaratmırsınız
- yeni branch yaratmaq məcburi deyil
- mövcud `DATABASE_URL` qalır

Səbəb:

- sistem shared database multi-tenant modelidir
- tenant-lar `tenant_id` ilə ayrılır

Yalnız bunları yoxlayın:

- backend service-də `DATABASE_URL` hələ işləkdir
- backend deploy sağlamdır

## 1. Railway-də Wildcard Domain Qurulması

Frontend service üzərində edin.

Addımlar:

1. Railway layihəsini açın
2. frontend service-i seçin
3. `Settings` bölməsinə keçin
4. `Networking`
5. `Public Networking`
6. `+ Custom Domain`
7. domain kimi bunu yazın:

```text
*.ironwaves.store
```

8. Railway sizə 2 DNS dəyəri verəcək:
   - wildcard üçün CNAME
   - `_acme-challenge` üçün CNAME

Bu hissə vacibdir. Wildcard domain üçün Railway adətən iki ayrı CNAME istəyir.

## 2. DNS Provider-də Yazılacaq Record-lar

DNS panelinizdə bu record-ları yaradın.

Railway-in sizə göstərəcəyi target-ləri olduğu kimi istifadə edin.

Adətən məntiq belə olur:

### Record 1

- Type: `CNAME`
- Name/Host: `*`
- Target/Value: Railway-in verdiyi `....up.railway.app`

### Record 2

- Type: `CNAME`
- Name/Host: `_acme-challenge`
- Target/Value: Railway-in verdiyi `authorize.railwaydns.net` və ya Railway-in göstərdiyi ACME target

Qeyd:

- `_acme-challenge` record-u SSL üçün lazımdır
- əgər Cloudflare istifadə edirsinizsə, `_acme-challenge` proxied olmamalıdır
- Cloudflare-də bu record üçün boz bulud olmalıdır, narıncı yox

## 3. Railway-də Domain Verification

DNS yazıldıqdan sonra Railway-ə qayıdın.

Gözləyin:

- domain yanında yaşıl check çıxsın
- SSL aktiv olsun

Bu bir neçə dəqiqə də çəkə bilər, bəzən daha çox.

## 4. Backend üçün Əlavə Domain Lazımdırmı?

Xeyr, bu modeldə şərt deyil.

Backend:

- hazırkı Railway backend domain-i ilə qala bilər
- frontend onsuz da API-yə env və ya runtime config ilə gedir

Yəni yeni tenant üçün ayrıca backend domain açmaq məcburi deyil.

## 5. Yeni Tenant Yaradılması

İndi `super_admin` ilə sistemə daxil olun.

Yeni tenant yaratmaq üçün bu məlumatları hazırlayın:

- Company name: `Gyros POS`
- Slug: `gyrospos`
- Domain: `gyrospos.ironwaves.store`
- Admin username: məsələn `gyros_admin`
- Admin password: güclü şifrə

Əgər UI içində tenant create ekranı varsa, ordan yaradın.

Əgər sonradan API ilə yaratmaq lazım olsa, backend bunu dəstəkləyir.

Sistem tenant yaratdıqda bunları edəcək:

- tenant qeydini yaradacaq
- `tenant_domains` xəritəsinə domain yazacaq
- default menu yaradacaq
- default masa yaradacaq
- default inventory yaradacaq
- default recipes yaradacaq
- admin user yaradacaq

## 6. Tenant Yaradıldıqdan Sonra Yoxlama

Brauzerdə açın:

- `https://gyrospos.ironwaves.store`

Yoxlayın:

1. login ekranı açılır
2. branding düzgün gəlir
3. yeni admin ilə login olur
4. demo və ya başqa tenant datası görünmür
5. menu/inventory default data ilə gəlir

## 7. İlk Branding Ayarları

`gyrospos` tenant-a girəndən sonra bunları doldurun:

- company name
- logo
- website
- receipt footer
- QR base URL
- email settings
- print settings

Bu hissələr tenant-a görə ayrıca saxlanır.

## 8. İlk Smoke Test

Bu fayla baxın:

- [TENANT_SMOKE_TEST_CHECKLIST.md](/Users/admin/ironwaves-pos-platform/TENANT_SMOKE_TEST_CHECKLIST.md)

Ən vacib minimum test:

1. `gyrospos`-da məhsul yaradın
2. `super` və ya başqa tenant-da görünmədiyini yoxlayın
3. `gyrospos`-da satış edin
4. finance və analytics yalnız həmin tenant-da görünsün
5. public receipt başqa tenant subdomain-də açılmasın

## 9. Ən Səhvsiz İş Sırası

Bu sıra ilə edin:

1. Railway frontend service-də wildcard domain əlavə edin
2. DNS-də 2 CNAME yazın
3. Railway verification gözləyin
4. `super_admin` ilə daxil olun
5. `gyrospos.ironwaves.store` tenant-ını yaradın
6. `gyrospos.ironwaves.store` açın
7. smoke test edin

## 10. Sizə Lazım Olmayan Şeylər

Bu mərhələdə bunları etməyin:

- ayrıca yeni Railway project açmaq
- ayrıca yeni frontend service açmaq
- ayrıca yeni backend service açmaq
- Neon-da ayrıca yeni database yaratmaq

Bunlar yalnız siz hər müştəriyə tam ayrı infrastruktur vermək istəsəniz lazım olar.

## 11. Problem Olsa İlk Yoxlanacaq Şeylər

Əgər `gyrospos.ironwaves.store` açılmırsa:

1. Railway-də wildcard domain verified-dirmi
2. DNS-də `*` CNAME düzgündürmü
3. `_acme-challenge` düzgündürmü
4. frontend service həqiqətən deploy olunubmu
5. tenant record içində domain düzgün `gyrospos.ironwaves.store` yazılıbmı

Əgər login açılır amma data gəlmirsə:

1. tenant yaradılıb?
2. `tenant_domains` mapping yazılıb?
3. backend `get_tenant` host-dan düzgün tenant tapır?

## 12. Nümunə Data

`gyrospos` üçün mənim tövsiyəm:

- Company name: `Gyros POS`
- Slug: `gyrospos`
- Domain: `gyrospos.ironwaves.store`
- Admin username: `gyros_admin`
- Admin password: güclü və ayrıca saxlanılan şifrə

