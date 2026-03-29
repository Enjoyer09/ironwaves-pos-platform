# Tenant Smoke-Test Checklist

Bu checklist multi-tenant sızma risklərini praktik şəkildə yoxlamaq üçündür.

## Hazırlıq

- 2 ayrı tenant istifadə edin.
- Nümunə:
  - `demo.ironwaves.store`
  - `socialbee.ironwaves.store`
- Hər tenant üçün ayrıca admin və staff hesabı olsun.

## 1. Branding Ayrılığı

- Hər subdomain-i ayrıca açın.
- Logo, company name və website hər tenant-da fərqli görünməlidir.
- Login ekranında tenant branding qarışmamalıdır.

## 2. Session Ayrılığı

- Eyni brauzerdə bir tenant-a login olun.
- Sonra başqa subdomain açın.
- İkinci tenant birincinin datasını avtomatik göstərməməlidir.
- `super_admin` ilə tenant switch etdikdə səhifə yeni tenant datası ilə yenilənməlidir.

## 3. Menu / Inventory Ayrılığı

- Tenant A-da yeni menu item yaradın.
- Tenant B-də həmin məhsul görünməməlidir.
- Tenant A-da inventory dəyişin.
- Tenant B-nin stok rəqəmləri dəyişməməlidir.

## 4. Finance Ayrılığı

- Tenant A-da finance entry yaradın.
- Tenant B-də həmin entry görünməməlidir.
- Tenant A-da transfer və investor əməliyyatı edin.
- Tenant B balansları dəyişməməlidir.

## 5. Analytics / Reports Ayrılığı

- Tenant A-da test satış edin.
- Tenant B analytics və Z-report hissəsində bu satış görünməməlidir.
- Tenant A-da shift açın.
- Tenant B-də shift statusu təsirlənməməlidir.

## 6. Refund / Void Ayrılığı

- Tenant A satışına VOID və ya partial refund edin.
- Tenant B finance və analytics rəqəmləri dəyişməməlidir.

## 7. CRM / Loyalty Ayrılığı

- Tenant A-da müştəri və ya loyalty kart yaradın.
- Tenant B-də həmin kart və ya müştəri görünməməlidir.
- Loyalty endirimi yalnız kartın aid olduğu tenant-da işləməlidir.

## 8. Public Receipt Mənfi Testi

- Tenant A-da satış edin və receipt linkini açın.
- Eyni `receipt id/code + token` ilə Tenant B subdomain-də açmağa çalışın.
- Receipt açılmamalıdır.
- Yalnız düzgün tenant/subdomain-də açılmalıdır.

## 9. Offline Mənfi Testi

- Tenant A-da interneti kəsib offline sale yaradın.
- Sonra Tenant B-yə keçin.
- Pending sync sayı və offline satış Tenant B-də görünməməlidir.
- İnternet qayıdanda satış yalnız Tenant A-ya sync olunmalıdır.

## 10. Super Admin Switch Testi

- `super_admin` ilə daxil olun.
- Header-dən tenant dəyişin.
- Menu, finance, analytics, tables və branding hamısı yeni tenant-a uyğun yenilənsin.
- Köhnə tenantdan qalan cart, popup və ya stats görünməməlidir.

## Keçdi Saymaq Üçün Minimum Şərt

- Tenant A datasi Tenant B-də görünmür.
- Public receipt yanlış subdomain-də açılmır.
- Offline sale yanlış tenant-a sync olunmur.
- `super_admin` switch sonrası köhnə tenant state qalmır.
