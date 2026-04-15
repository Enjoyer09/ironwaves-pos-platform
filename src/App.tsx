import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAppStore } from './store';
import { i18n, tx } from './i18n';
import PinLogin from './components/PinLogin';
import POS from './components/POS';
import KDS from './components/KDS';
import AdminPanel from './components/AdminPanel';
import TablesPage from './components/TablesPage';
import PublicReceipt from './components/PublicReceipt';
import PublicMenu from './components/PublicMenu';
import CustomerApp from './components/CustomerApp';
import LandingPage from './components/LandingPage';
import { LogOut, Wifi, WifiOff, Languages, RotateCcw, Maximize2, Minimize2, BookOpen, ChevronLeft, ChevronRight, X } from 'lucide-react';
import VirtualKeyboard from './components/VirtualKeyboard';
import { seedDatabase } from './lib/seeder';
import ToastOverlay from './components/ToastOverlay';
import { get_business_profile, get_business_profile_live } from './api/settings';
import { get_settings, get_settings_live } from './api/settings';
import AppErrorBoundary from './components/AppErrorBoundary';
import { logUiError } from './lib/logger';
import { getPendingOfflineSalesCount, syncPendingOfflineSales } from './lib/offline';
import { probeInternet } from './lib/connectivity';
import { get_unread_staff_notifications_live, mark_staff_notification_read_live, mark_staff_notifications_read_live } from './api/reports';
import { getActiveTenantId, getResolvedTenantIdFromHost } from './lib/tenant';
import { get_low_stock_items } from './api/inventory';
import { list_tenants, type TenantRecord } from './api/tenants';
import { clearDBCache } from './lib/db_sim';
import { authApi } from './api/auth';
import { isPerfDebugEnabled, type PerfEvent } from './lib/perf';

type AdminView =
  | 'dashboard'
  | 'analytics'
  | 'menu'
  | 'finance'
  | 'inventory'
  | 'crm'
  | 'customerapp'
  | 'posbuilder'
  | 'recipes'
  | 'ai'
  | 'settings'
  | 'notes'
  | 'logs'
  | 'database'
  | 'zreport'
  | 'combos'
  | 'landing'
  | 'tenants';

type ModuleKey =
  | 'pos'
  | 'tables'
  | 'kds'
  | 'zreport'
  | 'finance'
  | 'inventory'
  | 'combos'
  | 'dashboard'
  | 'analytics'
  | 'logs'
  | 'crm'
  | 'customerapp'
  | 'posbuilder'
  | 'ai'
  | 'menu'
  | 'recipes'
  | 'tenants'
  | 'notes'
  | 'settings'
  | 'landing'
  | 'database';

type GuideStep = {
  title: string;
  description: string;
  actionLabel?: string;
  actionModule?: ModuleKey;
};

type GuideContent = {
  moduleDescription: string;
  steps: GuideStep[];
};

type HoverGuideState = {
  module: ModuleKey;
  x: number;
  y: number;
};

const getGuideContent = (lang: 'az' | 'ru' | 'en'): Record<ModuleKey, GuideContent> => ({
  pos: {
    moduleDescription: tx(lang, 'POS: sifarişin yaradılması və ödənişin tamamlanması üçün əsas iş sahəsi.', 'POS: основное рабочее место для создания заказа и завершения оплаты.', 'POS: main workspace to create orders and complete payment.'),
    steps: [
      { title: tx(lang, '1) Məhsul seçin', '1) Выберите товар', '1) Select product'), description: tx(lang, 'Kateqoriyadan məhsulu seçib səbətə əlavə edin.', 'Выберите товар из категории и добавьте в корзину.', 'Pick items from categories and add to cart.') },
      { title: tx(lang, '2) Səbəti tamamlayın', '2) Подготовьте корзину', '2) Prepare cart'), description: tx(lang, 'Müştəri, endirim və qeydi bu mərhələdə daxil edin.', 'На этом этапе укажите клиента, скидку и примечание.', 'Set customer, discount, and notes here.') },
      { title: tx(lang, '3) Ödənişi bağlayın', '3) Закройте оплату', '3) Close payment'), description: tx(lang, 'Nağd, kart və ya bölünmüş ödənişlə satışı bitirin.', 'Завершите продажу наличными, картой или split-оплатой.', 'Finalize sale using cash, card, or split payment.') },
    ],
  },
  tables: {
    moduleDescription: tx(lang, 'Masalar: zal axını və masa hesablarının idarəsi.', 'Столы: управление залом и счетами столов.', 'Tables: floor flow and table bill management.'),
    steps: [
      { title: tx(lang, '1) Masa açın', '1) Откройте стол', '1) Open table'), description: tx(lang, 'Yeni masa yaradın və ya mövcud masanı aktiv edin.', 'Создайте новый стол или активируйте существующий.', 'Create a new table or activate an existing one.') },
      { title: tx(lang, '2) Sifarişi göndərin', '2) Отправьте заказ', '2) Send order'), description: tx(lang, 'Sifarişi mətbəxə göndərib statusu izləyin.', 'Отправьте заказ на кухню и следите за статусом.', 'Send order to kitchen and track status.') },
      { title: tx(lang, '3) Hesabı bağlayın', '3) Закройте счет', '3) Close bill'), description: tx(lang, 'Masa hesabını POS ödənişinə yönləndirib tamamlayın.', 'Передайте счет стола в POS и завершите оплату.', 'Route table bill to POS and complete payment.') },
    ],
  },
  kds: {
    moduleDescription: tx(lang, 'Mətbəx ekranı: sifarişlərin hazırlanma statusuna nəzarət.', 'Кухонный экран: контроль статусов приготовления заказов.', 'Kitchen screen: monitor order preparation statuses.'),
    steps: [
      { title: tx(lang, '1) Yeni sifarişləri götürün', '1) Возьмите новые заказы', '1) Pick new orders'), description: tx(lang, 'Yeni daxil olan sifarişləri hazırlığa qəbul edin.', 'Примите новые заказы в приготовление.', 'Move incoming orders into preparation.') },
      { title: tx(lang, '2) Statusu yeniləyin', '2) Обновите статус', '2) Update status'), description: tx(lang, 'Hazırlanır və hazır statuslarını vaxtında dəyişin.', 'Своевременно обновляйте статусы готовки.', 'Update preparing/ready statuses on time.') },
      { title: tx(lang, '3) Servisə ötürün', '3) Передайте в сервис', '3) Hand over to service'), description: tx(lang, 'Hazır sifarişləri servis komandasına ötürün.', 'Передайте готовые позиции сервисной команде.', 'Pass ready items to service staff.') },
    ],
  },
  zreport: {
    moduleDescription: tx(lang, 'Z-Hesabat: gün sonu kassa və satış yekunu.', 'Z-Отчет: итог дня по кассе и продажам.', 'Z-Report: end-of-day cash and sales summary.'),
    steps: [
      { title: tx(lang, '1) Gün aralığını yoxlayın', '1) Проверьте период', '1) Check period'), description: tx(lang, 'Hesabat tarixini dəqiq seçin.', 'Точно выберите дату отчета.', 'Pick exact report date.') },
      { title: tx(lang, '2) Bölmələri seçin', '2) Выберите секции', '2) Select sections'), description: tx(lang, 'Çekdə görünəcək hissələri ayarlardan idarə edin.', 'Управляйте секциями чека через настройки.', 'Control receipt sections from settings.') },
      { title: tx(lang, '3) Çap/ixrac edin', '3) Печать/экспорт', '3) Print/export'), description: tx(lang, 'Audit üçün hesabatı çap edin və ya ixrac edin.', 'Печатайте или экспортируйте отчет для аудита.', 'Print/export report for auditing.') },
    ],
  },
  finance: {
    moduleDescription: tx(lang, 'Maliyyə: cashflow, transfer, təsdiq və ledger nəzarəti.', 'Финансы: контроль cashflow, переводов, утверждений и ledger.', 'Finance: control cashflow, transfers, approvals, and ledger.'),
    steps: [
      { title: tx(lang, '1) Overview-ə baxın', '1) Проверьте Overview', '1) Review overview'), description: tx(lang, 'KPI və kritik xəbərdarlıqları yoxlayın.', 'Проверьте KPI и критические предупреждения.', 'Check KPIs and critical alerts.') },
      { title: tx(lang, '2) Quick action seçin', '2) Выберите quick action', '2) Pick quick action'), description: tx(lang, 'Mədaxil, xərc, transfer və ya investor əməliyyatı açın.', 'Откройте приход, расход, перевод или инвестор-операцию.', 'Start income/expense/transfer/investor operation.') },
      { title: tx(lang, '3) Audit tabına keçin', '3) Перейдите в аудит', '3) Move to audit'), description: tx(lang, 'Jurnal və approval tarixçəsini ayrıca izləyin.', 'Отслеживайте журнал и историю approvals отдельно.', 'Review ledger and approval history separately.') },
    ],
  },
  inventory: {
    moduleDescription: tx(lang, 'Anbar: xammal, limit və hərəkətlərin idarəsi.', 'Склад: управление ингредиентами, лимитами и движениями.', 'Inventory: manage ingredients, limits, and stock movements.'),
    steps: [
      { title: tx(lang, '1) İlk anbar məhsulu yaradın', '1) Создайте первый складской товар', '1) Create first stock item'), description: tx(lang, 'Ad, vahid, limit və ilkin qalığı daxil edin.', 'Введите название, единицу, лимит и стартовый остаток.', 'Enter name, unit, limit, and initial quantity.') },
      { title: tx(lang, '2) Hərəkətləri qeyd edin', '2) Фиксируйте движения', '2) Record movements'), description: tx(lang, 'Mədaxil və sərf əməliyyatlarını sənədləşdirin.', 'Документируйте приход и расход.', 'Document stock-in and consumption.') },
      { title: tx(lang, '3) Reseptlə bağlantını yoxlayın', '3) Проверьте связь с рецептами', '3) Check recipe linkage'), description: tx(lang, 'Xammal reseptlərdə düzgün istifadə olunurmu izləyin.', 'Проверьте корректное использование ингредиентов в рецептах.', 'Ensure ingredients are linked correctly in recipes.'), actionLabel: tx(lang, 'Reseptə keç', 'Перейти в рецепты', 'Go to recipes'), actionModule: 'recipes' },
    ],
  },
  combos: { moduleDescription: tx(lang, 'Kombo paketlər və aksiyalar üçün idarə paneli.', 'Панель для комбо-наборов и акций.', 'Panel for combo bundles and campaigns.'), steps: [{ title: tx(lang, '1) Kombo yarat', '1) Создайте комбо', '1) Create combo'), description: tx(lang, 'Menyu məhsullarını bir paketdə birləşdirin.', 'Объедините позиции меню в один пакет.', 'Bundle menu items into one offer.') }, { title: tx(lang, '2) Qiyməti təyin et', '2) Установите цену', '2) Set price'), description: tx(lang, 'Komboya ayrıca satış qiyməti verin.', 'Задайте отдельную цену для комбо.', 'Assign a dedicated combo price.') }, { title: tx(lang, '3) POS-da test et', '3) Протестируйте в POS', '3) Test in POS'), description: tx(lang, 'Kombonun POS-da düzgün çıxdığını yoxlayın.', 'Проверьте отображение комбо в POS.', 'Verify combo appears correctly in POS.'), actionLabel: tx(lang, 'POS-a keç', 'Перейти в POS', 'Go to POS'), actionModule: 'pos' }] },
  dashboard: { moduleDescription: tx(lang, 'Dashboard: operativ göstəricilər və xəbərdarlıqlar.', 'Dashboard: оперативные метрики и предупреждения.', 'Dashboard: operational metrics and alerts.'), steps: [{ title: tx(lang, '1) KPI-ləri yoxla', '1) Проверьте KPI', '1) Check KPIs'), description: tx(lang, 'Satış və performans göstəricilərinə baxın.', 'Просмотрите показатели продаж и производительности.', 'Review sales and performance metrics.') }, { title: tx(lang, '2) Alert-ləri oxu', '2) Просмотрите alerts', '2) Read alerts'), description: tx(lang, 'Kritik xəbərdarlıqları öncə emal edin.', 'Сначала обработайте критические предупреждения.', 'Handle critical alerts first.') }, { title: tx(lang, '3) Modullara keçid et', '3) Перейдите в модули', '3) Jump to modules'), description: tx(lang, 'Dashboard-dan birbaşa uyğun modula keçin.', 'Переходите из dashboard напрямую в нужный модуль.', 'Navigate directly to the right module from dashboard.') }] },
  analytics: { moduleDescription: tx(lang, 'Analitika: satış, trend və gəlirlilik analizi.', 'Аналитика: анализ продаж, трендов и доходности.', 'Analytics: sales, trend, and profitability analysis.'), steps: [{ title: tx(lang, '1) Tarix seç', '1) Выберите период', '1) Select date range'), description: tx(lang, 'Müqayisə üçün düzgün aralıq təyin edin.', 'Задайте корректный период для сравнения.', 'Set correct period for comparison.') }, { title: tx(lang, '2) Satış cədvəlini yoxla', '2) Проверьте таблицу продаж', '2) Review sales table'), description: tx(lang, 'Anomaliya və düzəliş ehtiyacını müəyyən edin.', 'Определите аномалии и необходимость корректировок.', 'Find anomalies and needed corrections.') }, { title: tx(lang, '3) Qərar çıxar', '3) Примите решение', '3) Make decisions'), description: tx(lang, 'Menyu, qiymət və kampaniya qərarlarını data ilə verin.', 'Принимайте решения по меню, ценам и акциям на основе данных.', 'Make menu/pricing decisions based on data.') }] },
  logs: { moduleDescription: tx(lang, 'Loglar: backend/UI hadisə və xətaların monitorinqi.', 'Логи: мониторинг backend/UI событий и ошибок.', 'Logs: monitor backend/UI events and errors.'), steps: [{ title: tx(lang, '1) Filtr et', '1) Фильтруйте', '1) Filter'), description: tx(lang, 'Modul və zaman aralığına görə daraldın.', 'Сужайте по модулю и времени.', 'Filter by module and time range.') }, { title: tx(lang, '2) Kök səbəbi tap', '2) Найдите первопричину', '2) Find root cause'), description: tx(lang, 'UI freeze və failed fetch səbəblərini birləşdirin.', 'Свяжите причины UI freeze и failed fetch.', 'Correlate UI freeze and failed fetch causes.') }, { title: tx(lang, '3) Yüklə/Paylaş', '3) Скачать/поделиться', '3) Download/share'), description: tx(lang, 'Audit üçün logları ixrac edin.', 'Экспортируйте логи для аудита.', 'Export logs for auditing.') }] },
  crm: { moduleDescription: tx(lang, 'CRM: müştəri kartı və loyallıq idarəsi.', 'CRM: управление клиентскими картами и лояльностью.', 'CRM: customer card and loyalty management.'), steps: [{ title: tx(lang, '1) Müştəri əlavə et', '1) Добавьте клиента', '1) Add customer'), description: tx(lang, 'Kart növü və əlaqə məlumatını daxil edin.', 'Укажите тип карты и контакты.', 'Enter card type and contact info.') }, { title: tx(lang, '2) Bonus balansını izlə', '2) Следите за бонусами', '2) Track bonuses'), description: tx(lang, 'Satışla bonusların uyğunluğunu yoxlayın.', 'Проверьте синхронизацию бонусов с продажами.', 'Verify bonus sync with sales.') }, { title: tx(lang, '3) Segmentləşdir', '3) Сегментируйте', '3) Segment customers'), description: tx(lang, 'Kampaniyalar üçün aktiv müştəri qrupları yaradın.', 'Создайте активные клиентские сегменты для кампаний.', 'Create active customer segments for campaigns.') }] },
  customerapp: { moduleDescription: tx(lang, 'Customer App: müştəri self-service və QR təcrübəsi.', 'Customer App: self-service и QR опыт клиента.', 'Customer App: customer self-service and QR experience.'), steps: [{ title: tx(lang, '1) Linki yoxla', '1) Проверьте ссылку', '1) Check link'), description: tx(lang, 'Müştəri app linkinin düzgün açıldığını test edin.', 'Проверьте открытие ссылки customer app.', 'Test that customer app link opens correctly.') }, { title: tx(lang, '2) Profil axınını yoxla', '2) Проверьте поток профиля', '2) Test profile flow'), description: tx(lang, 'Qoşulma və bonus ekranlarını yoxlayın.', 'Проверьте onboarding и бонусные экраны.', 'Review onboarding and rewards screens.') }, { title: tx(lang, '3) CRM sinxronunu təsdiq et', '3) Подтвердите CRM синхронизацию', '3) Confirm CRM sync'), description: tx(lang, 'Dəyişikliklər CRM-də görünməlidir.', 'Изменения должны отражаться в CRM.', 'Changes should appear in CRM.') }] },
  posbuilder: { moduleDescription: tx(lang, 'POS Builder: POS görünüş və axın konfiqurasiyası.', 'POS Builder: настройка вида и потока POS.', 'POS Builder: configure POS layout and flow.'), steps: [{ title: tx(lang, '1) Layout seç', '1) Выберите layout', '1) Choose layout'), description: tx(lang, 'Biznes tipinizə uyğun görünüş seçin.', 'Выберите макет под тип бизнеса.', 'Choose layout matching business type.') }, { title: tx(lang, '2) Sahələri tənzimlə', '2) Настройте поля', '2) Tune fields'), description: tx(lang, 'Səbət, məhsul və ödəniş bloklarını optimallaşdırın.', 'Оптимизируйте блоки корзины, товаров и оплаты.', 'Optimize cart/product/payment blocks.') }, { title: tx(lang, '3) Canlı test et', '3) Тестируйте вживую', '3) Test live'), description: tx(lang, 'Dəyişiklikləri real sifariş ssenarisi ilə yoxlayın.', 'Проверьте изменения на реальном сценарии заказа.', 'Validate changes on a live order scenario.'), actionLabel: tx(lang, 'POS-a keç', 'Перейти в POS', 'Go to POS'), actionModule: 'pos' }] },
  ai: { moduleDescription: tx(lang, 'AI Menecer: əməliyyat tövsiyələri və risk siqnalları.', 'AI Менеджер: операционные рекомендации и сигналы риска.', 'AI Manager: operational recommendations and risk signals.'), steps: [{ title: tx(lang, '1) Tövsiyələri oxu', '1) Прочитайте рекомендации', '1) Read suggestions'), description: tx(lang, 'Ən yüksək təsirli təklifləri əvvəl emal edin.', 'Сначала обработайте советы с высоким эффектом.', 'Prioritize high-impact suggestions.') }, { title: tx(lang, '2) Task-a çevir', '2) Превратите в задачу', '2) Convert to task'), description: tx(lang, 'Uyğun təklifləri komandaya tapşırıq edin.', 'Преобразуйте полезные рекомендации в задачи.', 'Turn useful recommendations into tasks.') }, { title: tx(lang, '3) Nəticəni ölç', '3) Измерьте результат', '3) Measure outcome'), description: tx(lang, 'Dashboard/analytics ilə effektini ölçün.', 'Измерьте эффект через dashboard/analytics.', 'Measure impact in dashboard/analytics.') }] },
  menu: {
    moduleDescription: tx(lang, 'Menyu: məhsul yaratma, redaktə və deaktiv etmə.', 'Меню: создание, редактирование и деактивация позиций.', 'Menu: create, edit, and deactivate items.'),
    steps: [
      { title: tx(lang, '1) İlk menu item yaradın', '1) Создайте первый menu item', '1) Create first menu item'), description: tx(lang, 'Ad, qiymət və kateqoriya daxil edib əlavə edin.', 'Введите название, цену и категорию и добавьте товар.', 'Enter name, price, category and add item.') },
      { title: tx(lang, '2) Reseptə bağlayın', '2) Привяжите рецепт', '2) Link recipe'), description: tx(lang, 'Məhsul yaradıldıqdan sonra resept moduluna keçin.', 'После создания товара перейдите в модуль рецептов.', 'After creation, move to recipes module.'), actionLabel: tx(lang, 'Reseptə keç', 'Перейти в рецепты', 'Go to recipes'), actionModule: 'recipes' },
      { title: tx(lang, '3) Sil/deaktiv et', '3) Удалить/деактивировать', '3) Delete/deactivate'), description: tx(lang, 'Köhnə məhsulları səbət ikonundan deaktiv edin.', 'Деактивируйте старые позиции через иконку корзины.', 'Deactivate old items using trash icon.') },
    ],
  },
  recipes: {
    moduleDescription: tx(lang, 'Resept: menyu məhsulunu anbar xammalına bağlayır.', 'Рецепты: связывают меню-позиции с ингредиентами склада.', 'Recipes: link menu items with inventory ingredients.'),
    steps: [
      { title: tx(lang, '1) Məhsul seçin', '1) Выберите товар', '1) Select item'), description: tx(lang, 'Soldakı menyudan məhsul seçib resepti açın.', 'Выберите позицию слева и откройте рецепт.', 'Pick item from menu list and open recipe.') },
      { title: tx(lang, '2) Xammal əlavə edin', '2) Добавьте ингредиенты', '2) Add ingredients'), description: tx(lang, 'Anbar məhsulu və miqdar daxil edin.', 'Добавьте складской ингредиент и количество.', 'Add stock ingredient and quantity.') },
      { title: tx(lang, '3) Anbarı tamamlayın', '3) Дозаполните склад', '3) Complete inventory'), description: tx(lang, 'Çatışmayan xammal üçün anbara keçin.', 'Перейдите на склад для отсутствующих ингредиентов.', 'Go to inventory for missing ingredients.'), actionLabel: tx(lang, 'Anbara keç', 'Перейти на склад', 'Go to inventory'), actionModule: 'inventory' },
    ],
  },
  tenants: { moduleDescription: tx(lang, 'Tenantlər: multi-tenant idarəetmə paneli.', 'Тенанты: панель управления multi-tenant.', 'Tenants: multi-tenant administration panel.'), steps: [{ title: tx(lang, '1) Tenant siyahısını yoxla', '1) Проверьте список тенантов', '1) Review tenants list'), description: tx(lang, 'Aktiv tenant statuslarını təsdiqləyin.', 'Подтвердите статусы активных тенантов.', 'Verify active tenant statuses.') }, { title: tx(lang, '2) Domeni yoxla', '2) Проверьте домен', '2) Verify domain'), description: tx(lang, 'Subdomain yönləndirməsi düzgün olmalıdır.', 'Проверьте корректность subdomain маршрутизации.', 'Ensure subdomain routing is correct.') }, { title: tx(lang, '3) Silmə əməliyyatı ehtiyatla', '3) Удаление осторожно', '3) Delete carefully'), description: tx(lang, 'Silmədən öncə backup və bağlı modulları yoxlayın.', 'Перед удалением проверьте backup и связанные модули.', 'Check backups and linked modules before delete.') }] },
  notes: { moduleDescription: tx(lang, 'Qeydlər: daxili əməliyyat qeydləri üçün sahə.', 'Заметки: место для внутренних операционных записей.', 'Notes: area for internal operational notes.'), steps: [{ title: tx(lang, '1) Qeyd yaz', '1) Напишите заметку', '1) Write note'), description: tx(lang, 'Qısa, ölçülə bilən və icra yönümlü qeyd daxil edin.', 'Пишите короткие и actionable заметки.', 'Write concise and actionable notes.') }, { title: tx(lang, '2) Saxla', '2) Сохраните', '2) Save'), description: tx(lang, 'Qeydlər siyahısında dərhal görünəcək.', 'Заметка сразу появится в списке.', 'Note appears immediately in the list.') }, { title: tx(lang, '3) Təmizlə', '3) Очистите', '3) Clean up'), description: tx(lang, 'Köhnə qeydləri redaktə edin və silin.', 'Редактируйте и удаляйте устаревшие заметки.', 'Edit/delete outdated notes.') }] },
  settings: { moduleDescription: tx(lang, 'Ayarlar: sistem, rol və inteqrasiya davranışları.', 'Настройки: поведение системы, ролей и интеграций.', 'Settings: system, role, and integration behaviors.'), steps: [{ title: tx(lang, '1) Profili tənzimlə', '1) Настройте профиль', '1) Configure profile'), description: tx(lang, 'Şirkət adı, logo və əlaqə məlumatını yeniləyin.', 'Обновите название, логотип и контакты.', 'Update company name, logo, contacts.') }, { title: tx(lang, '2) Rol icazələrini yoxla', '2) Проверьте роли', '2) Review role permissions'), description: tx(lang, 'Modul girişlərinin rola görə uyğunluğunu yoxlayın.', 'Проверьте доступ модулей по ролям.', 'Validate module access per role.') }, { title: tx(lang, '3) Ayarı test et', '3) Протестируйте', '3) Test settings'), description: tx(lang, 'Saxladıqdan sonra qısa smoke test edin.', 'После сохранения выполните короткий smoke test.', 'Run a quick smoke test after saving.') }] },
  landing: { moduleDescription: tx(lang, 'Landing Studio: satış səhifəsi məzmunu və vizual idarəsi.', 'Landing Studio: управление контентом и визуалом продающей страницы.', 'Landing Studio: manage marketing page content and visuals.'), steps: [{ title: tx(lang, '1) Hero mətnini yenilə', '1) Обновите Hero текст', '1) Update hero text'), description: tx(lang, 'Başlıq və alt başlıqda əsas dəyər təklifini yazın.', 'Опишите ценностное предложение в заголовке и подзаголовке.', 'Set core value proposition in heading/subheading.') }, { title: tx(lang, '2) Ekran görüntülərini seç', '2) Выберите скриншоты', '2) Select screenshots'), description: tx(lang, 'POS/KDS/Maliyyə UI screenshot-larını istifadə edin.', 'Используйте скриншоты POS/KDS/Финансы.', 'Use POS/KDS/Finance screenshots.') }, { title: tx(lang, '3) Canlıya yayımla', '3) Опубликуйте', '3) Publish live'), description: tx(lang, 'Dəyişikliyi publish edib saytda yoxlayın.', 'Опубликуйте изменения и проверьте сайт.', 'Publish changes and verify on site.') }] },
  database: { moduleDescription: tx(lang, 'Baza: backup/restore və texniki servis əməliyyatları.', 'База: backup/restore и техобслуживание.', 'Database: backup/restore and maintenance operations.'), steps: [{ title: tx(lang, '1) Backup alın', '1) Создайте backup', '1) Create backup'), description: tx(lang, 'Restore və silmədən əvvəl backup məcburidir.', 'Перед restore и удалением backup обязателен.', 'Backup is mandatory before restore/delete.') }, { title: tx(lang, '2) Restore yoxlaması edin', '2) Проверьте restore', '2) Validate restore'), description: tx(lang, 'JSON struktur və admin doğrulamasını yoxlayın.', 'Проверьте JSON-структуру и admin валидацию.', 'Validate JSON structure and admin verification.') }, { title: tx(lang, '3) Post-restore test', '3) Post-restore тест', '3) Post-restore test'), description: tx(lang, 'Menyu/CRM/Maliyyə məlumatlarını müqayisə edin.', 'Сверьте данные меню/CRM/финансов после restore.', 'Cross-check menu/CRM/finance data after restore.') }] },
});

export default function App() {
  const { user, access_token, logout, lang, setLang, hasHydrated, notify, switchTenantContext, applySessionUser } = useAppStore();
  const activeTenant = getActiveTenantId();
  const safeLang = (lang === 'az' || lang === 'ru' || lang === 'en') ? lang : 'az';
  const t = i18n[safeLang];
  const hasValidUser = Boolean(
    user &&
    typeof user.username === 'string' &&
    typeof user.role === 'string' &&
    typeof access_token === 'string' &&
    access_token.length > 8
  );

  useEffect(() => {
    try {
      seedDatabase();
    } catch (error) {
      console.error('Seed database failed:', error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const prepareField = (field: HTMLInputElement | HTMLTextAreaElement) => {
      if (!field.classList.contains('neon-input')) return;
      const inputType = field instanceof HTMLInputElement ? String(field.type || '').toLowerCase() : 'textarea';
      const inputMode = field instanceof HTMLInputElement ? String(field.inputMode || '').toLowerCase() : '';
      if (
        field instanceof HTMLInputElement &&
        !field.dataset.virtualKeyboardMode &&
        (inputType === 'number' || inputType === 'tel' || inputMode === 'numeric' || inputMode === 'decimal')
      ) {
        field.dataset.virtualKeyboardMode = 'numeric';
      }

      const originalPlaceholder = field.getAttribute('data-original-placeholder') || field.getAttribute('placeholder') || '';
      if (originalPlaceholder && !field.getAttribute('data-original-placeholder')) {
        field.setAttribute('data-original-placeholder', originalPlaceholder);
      }
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        prepareField(target);
      }
    };

    document.addEventListener('focusin', onFocusIn);

    return () => {
      document.removeEventListener('focusin', onFocusIn);
    };
  }, []);

  useEffect(() => {
    if (!hasValidUser || !user?.tenant_id) return;
    void get_business_profile_live(user.tenant_id).catch(() => {});
    void get_settings_live(user.tenant_id).catch(() => {});
  }, [hasValidUser, user?.tenant_id]);

  const hostMode = useMemo(() => {
    if (typeof window === 'undefined') return 'app';
    const host = window.location.host.toLowerCase();
    if (host === 'www.ironwaves.store' || host === 'ironwaves.store') return 'landing';
    return 'app';
  }, []);

  const currentHost = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return String(window.location.host || '').trim().toLowerCase().split(':')[0];
  }, []);

  const mappedTenantFromHost = useMemo(() => getResolvedTenantIdFromHost(currentHost), [currentHost]);

  const [sessionChecking, setSessionChecking] = useState(false);
  const [readyPopup, setReadyPopup] = useState<any | null>(null);

  useEffect(() => {
    if (!hasValidUser) return;
    let cancelled = false;
    const shouldBlockForTenantMismatch =
      Boolean(mappedTenantFromHost) &&
      String(mappedTenantFromHost || '') !== String(user?.tenant_id || '');
    if (shouldBlockForTenantMismatch) setSessionChecking(true);
    const syncSession = async () => {
      try {
        const me = await authApi.me();
        if (!me || cancelled) return;
        const nextRole = String(me.role || '');
        const nextTenant = String(me.tenant_id || '');
        if (nextRole !== String(user?.role || '') || nextTenant !== String(user?.tenant_id || '')) {
          applySessionUser({
            username: String(me.username || user?.username || ''),
            role: nextRole,
            tenant_id: nextTenant,
          });
        }
      } catch {
        if (!cancelled) {
          logout();
        }
      } finally {
        if (!cancelled) setSessionChecking(false);
      }
    };
    void syncSession();
    return () => {
      cancelled = true;
    };
  }, [hasValidUser, user?.role, user?.tenant_id, user?.username, applySessionUser, logout, mappedTenantFromHost]);

  const [currentModule, setCurrentModule] = useState<ModuleKey>('pos');
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);
  const [quickGuideOpen, setQuickGuideOpen] = useState(false);
  const [quickGuideStepIndex, setQuickGuideStepIndex] = useState(0);
  const [hoverGuide, setHoverGuide] = useState<HoverGuideState | null>(null);
  const [lowStockModal, setLowStockModal] = useState<Array<{ name: string; stock_qty: string; min_limit: string; unit: string }> | null>(null);
  const [availableTenants, setAvailableTenants] = useState<TenantRecord[]>([]);
  const [tenantSwitching, setTenantSwitching] = useState(false);
  const [businessProfileVersion, setBusinessProfileVersion] = useState(0);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [perfEvents, setPerfEvents] = useState<PerfEvent[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const offlineCountRef = useRef(0);
  const pendingOfflineInFlightRef = useRef(false);
  const notificationInFlightRef = useRef(false);
  const businessProfileUpdateTimerRef = useRef<number | null>(null);
  const settingsUpdateTimerRef = useRef<number | null>(null);

  const publicReceiptParams = useMemo(() => {
    if (typeof window === 'undefined') return { receiptId: '', token: '' };
    const params = new URLSearchParams(window.location.search);
    return {
      receiptId: params.get('r') || params.get('receipt') || params.get('sale_id') || '',
      token: params.get('t') || params.get('token') || '',
    };
  }, []);

  const publicPathname = useMemo(() => {
    if (typeof window === 'undefined') return '/';
    return String(window.location.pathname || '/');
  }, []);

  const customerAppParams = useMemo(() => {
    if (typeof window === 'undefined') return { cardId: '', token: '' };
    const params = new URLSearchParams(window.location.search);
    return {
      cardId: params.get('id') || '',
      token: params.get('t') || params.get('token') || '',
      join: params.get('join') === '1',
    };
  }, []);

  const defaultUiVisibility = { staff_show_tables: true, manager_show_tables: true, staff_show_kitchen: true };
  const defaultInventorySettings = { default_critical_threshold: 5, unit_options: ['kq', 'qram', 'litr', 'ml', 'ədəd', 'metr'] };
  const defaultRoleModules = {
    staff: ['pos', 'tables', 'kds', 'zreport'],
    manager: ['pos', 'tables', 'kds', 'zreport', 'dashboard', 'finance', 'inventory', 'combos', 'analytics', 'logs', 'crm', 'customerapp', 'ai', 'menu', 'recipes'],
    kitchen: ['kds'],
  };

  const appConfig = useMemo(() => {
    if (!hasValidUser) {
      return {
        profile: { logo_url: '' },
         settings: { ui_visibility: defaultUiVisibility, role_modules: defaultRoleModules, inventory_settings: defaultInventorySettings },
      };
    }
    try {
      return {
        profile: get_business_profile(user?.tenant_id || activeTenant) || { logo_url: '' },
          settings: get_settings(user?.tenant_id || activeTenant) || { ui_visibility: defaultUiVisibility, role_modules: defaultRoleModules, inventory_settings: defaultInventorySettings },
      };
    } catch (e) {
      console.error('App settings/profile init failed:', e);
      return {
        profile: { logo_url: '' },
          settings: { ui_visibility: defaultUiVisibility, role_modules: defaultRoleModules, inventory_settings: defaultInventorySettings },
      };
    }
  }, [hasValidUser, user?.tenant_id, businessProfileVersion, settingsVersion]);

  const profile = appConfig.profile;
  const settings = appConfig.settings;
  const profileWebsiteHost = useMemo(() => {
    const raw = String(profile?.website || '').trim().toLowerCase();
    if (!raw) return '';
    return raw.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  }, [profile?.website]);

  const uiVisibility = settings?.ui_visibility || defaultUiVisibility;
  const idleLogoutMinutes = Math.max(0, Number(settings?.session_settings?.idle_logout_minutes || 0));
  const virtualKeyboardEnabled = settings?.session_settings?.virtual_keyboard_enabled !== false;
  const roleModules = settings?.role_modules || null;
  const safeRoleModules = {
    staff: Array.isArray(roleModules?.staff) ? roleModules!.staff : defaultRoleModules.staff,
    manager: Array.isArray(roleModules?.manager)
      ? Array.from(new Set([...roleModules!.manager, 'dashboard']))
      : defaultRoleModules.manager,
    kitchen: Array.isArray(roleModules?.kitchen) ? roleModules!.kitchen : defaultRoleModules.kitchen,
  };

  useEffect(() => {
    const handleOpenTableInPos = () => setCurrentModule('pos');
    window.addEventListener('open-table-in-pos', handleOpenTableInPos as EventListener);
    return () => {
      window.removeEventListener('open-table-in-pos', handleOpenTableInPos as EventListener);
    };
  }, []);

  useEffect(() => {
    const handleTableOrderSent = () => setCurrentModule('tables');
    window.addEventListener('table-order-sent', handleTableOrderSent as EventListener);
    return () => {
      window.removeEventListener('table-order-sent', handleTableOrderSent as EventListener);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    let timerId: number | null = null;

    const refreshConnectivity = async () => {
      const browserSignal = typeof navigator !== 'undefined' ? navigator.onLine : true;
      if (!browserSignal) {
        if (mounted) setIsOnline(false);
        return;
      }
      const realOnline = await probeInternet();
      if (mounted) setIsOnline(realOnline);
    };
    const scheduleNext = () => {
      if (!mounted) return;
      const intervalMs = document.visibilityState === 'visible' ? 60000 : 180000;
      timerId = window.setTimeout(() => {
        if (document.visibilityState === 'visible') {
          void refreshConnectivity();
        }
        scheduleNext();
      }, intervalMs);
    };

    const handleOnline = () => {
      void refreshConnectivity();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if (document.visibilityState === 'visible') {
      void refreshConnectivity();
    }
    scheduleNext();

    return () => {
      mounted = false;
      if (timerId) window.clearTimeout(timerId);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!isOnline || !user?.tenant_id) return;
    syncPendingOfflineSales(user.tenant_id).then((result) => {
      if (result.synced > 0) {
        notify('success', tx(safeLang, `${result.synced} offline satış sinxron olundu`, `${result.synced} офлайн продаж синхронизировано`, `${result.synced} offline sales synced`));
      }
      if ((result.failed || 0) > 0) {
        notify('error', tx(safeLang, `${result.failed} offline satış göndərilə bilmədi`, `${result.failed} офлайн продаж не удалось отправить`, `${result.failed} offline sales failed to sync`));
      }
    });
  }, [isOnline, user?.tenant_id]);

  useEffect(() => {
    if (!user?.tenant_id) {
      setPendingOfflineCount(0);
      return;
    }

    let mounted = true;
    let timerId: number | null = null;
    const refreshPending = async () => {
      if (pendingOfflineInFlightRef.current) return;
      pendingOfflineInFlightRef.current = true;
      try {
        const count = await getPendingOfflineSalesCount(user.tenant_id as string);
        if (mounted && offlineCountRef.current !== count) {
          offlineCountRef.current = count;
          setPendingOfflineCount(count);
        }
      } finally {
        pendingOfflineInFlightRef.current = false;
      }
    };
    const scheduleNext = () => {
      if (!mounted) return;
      const intervalMs = document.visibilityState === 'visible' ? 45000 : 150000;
      timerId = window.setTimeout(() => {
        if (document.visibilityState === 'visible') void refreshPending();
        scheduleNext();
      }, intervalMs);
    };

    void refreshPending();
    scheduleNext();

    const onVisibility = () => {
      if (!document.hidden) void refreshPending();
    };
    window.addEventListener('focus', onVisibility);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      mounted = false;
      if (timerId) window.clearTimeout(timerId);
      window.removeEventListener('focus', onVisibility);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user?.tenant_id]);

  useEffect(() => {
    if (!hasValidUser) return;
    if (!idleLogoutMinutes) return;

    let timeoutId: number | null = null;
    const timeoutMs = idleLogoutMinutes * 60 * 1000;

    const resetTimer = () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        notify('info', tx(safeLang, 'İnaktivlik səbəbilə sistemdən çıxış edildi', 'Вы вышли из системы из-за неактивности', 'You were signed out due to inactivity'));
        logout();
      }, timeoutMs);
    };

    const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((eventName) => window.addEventListener(eventName, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      events.forEach((eventName) => window.removeEventListener(eventName, resetTimer as EventListener));
    };
  }, [hasValidUser, idleLogoutMinutes, logout, notify, safeLang]);

  useEffect(() => {
    if (!hasValidUser || !user?.tenant_id || !user?.username) return;
    let cancelled = false;
    let timerId: number | null = null;
    const pollNotifications = async () => {
      if (notificationInFlightRef.current || document.visibilityState !== 'visible') return;
      notificationInFlightRef.current = true;
      try {
        const unread = await get_unread_staff_notifications_live(user.tenant_id, user.username);
        if (cancelled || unread.length === 0) return;
        const readyNotification = unread.find((n) => String(n.meta?.status || '') === 'READY');
        if (readyNotification) {
          setReadyPopup((prev: any) => prev || readyNotification);
        }
        const nonReady = unread.filter((n) => String(n.meta?.status || '') !== 'READY');
        nonReady.slice(0, 2).forEach((n) => {
          notify('info', `${n.title}: ${n.message}`);
        });
        if (nonReady.length > 0) {
          await mark_staff_notifications_read_live(user.tenant_id, user.username);
        }
      } catch (e: any) {
        logUiError(user?.tenant_id || activeTenant, 'app-shell', e?.message || 'Failed to load staff notifications');
      } finally {
        notificationInFlightRef.current = false;
      }
    };
    const scheduleNext = () => {
      if (cancelled) return;
      const intervalMs = document.visibilityState === 'visible' ? 45000 : 180000;
      timerId = window.setTimeout(() => {
        void pollNotifications();
        scheduleNext();
      }, intervalMs);
    };
    const onVisibility = () => {
      if (!document.hidden) void pollNotifications();
    };

    void pollNotifications();
    scheduleNext();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (timerId) window.clearTimeout(timerId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [hasValidUser, user?.tenant_id, user?.username, notify, activeTenant]);

  useEffect(() => {
    const onKeyboardVisibility = (event: Event) => {
      const detail = (event as CustomEvent<{ visible?: boolean; height?: number }>).detail || {};
      const nextInset = detail.visible ? Math.max(0, Number(detail.height || 0)) : 0;
      setKeyboardInset(nextInset);
    };
    window.addEventListener('virtual-keyboard-visibility', onKeyboardVisibility as EventListener);
    return () => {
      window.removeEventListener('virtual-keyboard-visibility', onKeyboardVisibility as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!hasValidUser || !user?.tenant_id || !user?.username) return;
    const role = String(user.role || '').toLowerCase();
    if (role !== 'admin') return;
    const onceKey = `low_stock_popup_seen_${user.tenant_id}_${user.username}`;
    if (sessionStorage.getItem(onceKey) === '1') return;

    try {
      const threshold = Number(settings?.inventory_settings?.default_critical_threshold ?? 5);
      const lows = get_low_stock_items(user.tenant_id, threshold);
      if (lows.length > 0) {
        setLowStockModal(
          lows.map((l: any) => ({
            name: String(l.name || '-'),
            stock_qty: String(l.stock_qty ?? '0'),
            min_limit: String(l.min_limit ?? threshold),
            unit: String(l.unit || ''),
          }))
        );
      }
      sessionStorage.setItem(onceKey, '1');
    } catch {
      sessionStorage.setItem(onceKey, '1');
    }
  }, [hasValidUser, user?.tenant_id, user?.username, user?.role, settings?.inventory_settings?.default_critical_threshold]);

  useEffect(() => {
    const tenant = user?.tenant_id || activeTenant;
    const onWindowError = (event: ErrorEvent) => {
      logUiError(tenant, 'window-error', event.message || 'Unknown window error', {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    };
    const onUnhandled = (event: PromiseRejectionEvent) => {
      logUiError(tenant, 'unhandled-rejection', String(event.reason || 'Unhandled rejection'));
    };

    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandled);
    return () => {
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandled);
    };
  }, [user?.tenant_id]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;
    const tenant = user?.tenant_id || activeTenant || 'tenant_default';
    let lastReportedAt = 0;
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        const now = Date.now();
        if (now - lastReportedAt < 8000) return;
        const entries = list.getEntries() || [];
        const heavy = entries.find((entry: any) => Number(entry.duration || 0) >= 180);
        if (!heavy) return;
        lastReportedAt = now;
        logUiError(tenant, 'ui-freeze', 'Long task detected on main thread', {
          duration_ms: Math.round(Number((heavy as any).duration || 0)),
          name: String((heavy as any).name || 'longtask'),
        });
      });
      observer.observe({ entryTypes: ['longtask'] as any });
    } catch {
      // longtask observer might be unavailable on some browsers
    }
    return () => {
      try {
        observer?.disconnect();
      } catch {
        // no-op
      }
    };
  }, [user?.tenant_id, activeTenant]);

  const sessionRole = String(user?.role || '').toLowerCase();
  const selectedTenantId = String(user?.tenant_id || activeTenant || 'tenant_default');
  const moduleTenantKey = `${selectedTenantId}:${String(user?.username || 'guest')}`;

  useEffect(() => {
    if (!hasValidUser || sessionRole !== 'super_admin') {
      setAvailableTenants([]);
      return;
    }
    let cancelled = false;
    const loadTenants = async () => {
      try {
        const rows = await list_tenants();
        if (cancelled) return;
        setAvailableTenants(
          (rows || [])
            .filter((row) => String(row?.tenant_id || '').trim())
            .sort((a, b) =>
              String(a.company_name || a.slug || a.tenant_id).localeCompare(
                String(b.company_name || b.slug || b.tenant_id),
              ),
            ),
        );
      } catch (error: any) {
        if (!cancelled) {
          setAvailableTenants([]);
          logUiError(selectedTenantId, 'tenant-switcher', error?.message || 'Failed to load tenants');
        }
      }
    };
    void loadTenants();
    return () => {
      cancelled = true;
    };
  }, [hasValidUser, sessionRole, selectedTenantId]);

  const handleTenantSwitch = (nextTenantId: string) => {
    const safeTenantId = String(nextTenantId || '').trim();
    if (!safeTenantId || safeTenantId === selectedTenantId) return;
    setTenantSwitching(true);
    try {
      clearDBCache();
      switchTenantContext(safeTenantId);
      sessionStorage.removeItem(`low_stock_popup_seen_${selectedTenantId}_${user?.username || ''}`);
      sessionStorage.removeItem(`low_stock_popup_seen_${safeTenantId}_${user?.username || ''}`);
    } catch (error: any) {
      setTenantSwitching(false);
      notify('error', error?.message || 'Tenant keçidi alınmadı');
      return;
    }
    window.setTimeout(() => {
      window.location.reload();
    }, 120);
  };

  const moduleButtons: Array<{ key: ModuleKey; label: string; manager?: boolean; adminOnly?: boolean; superAdminOnly?: boolean }> = [
    { key: 'pos', label: t.modules.pos },
    { key: 'tables', label: t.modules.tables },
    { key: 'kds', label: t.modules.kds },
    { key: 'dashboard', label: t.modules.dashboard, manager: true },
    { key: 'finance', label: t.modules.finance, manager: true },
    { key: 'analytics', label: t.modules.analytics, manager: true },
    { key: 'zreport', label: t.modules.zreport },
    { key: 'inventory', label: t.modules.inventory, manager: true },
    { key: 'menu', label: t.modules.menu, manager: true },
    { key: 'recipes', label: t.modules.recipes, manager: true },
    { key: 'logs', label: t.modules.logs, manager: true },
    { key: 'crm', label: t.modules.crm, manager: true },
    { key: 'customerapp', label: t.modules.customerapp, manager: true },
    { key: 'posbuilder', label: t.modules.posbuilder, manager: true },
    { key: 'notes', label: t.modules.notes, adminOnly: true },
    { key: 'database', label: t.modules.database, adminOnly: true },
    { key: 'settings', label: t.modules.settings, adminOnly: true },
    { key: 'landing', label: (t.modules as any).landing || tx(safeLang, 'Landing Studio', 'Landing Studio', 'Landing Studio'), superAdminOnly: true },
    { key: 'ai', label: t.modules.ai, manager: true },
    { key: 'tenants', label: t.modules.tenants, superAdminOnly: true },
  ];

  const canAccess = (key: ModuleKey) => {
    const role = sessionRole;
    const definition = moduleButtons.find((item) => item.key === key);
    if (definition?.superAdminOnly) return role === 'super_admin';
    if (role === 'super_admin') return true;
    if (role === 'admin') return true;

    if (safeRoleModules) {
      if (role === 'manager') return safeRoleModules.manager.includes(key);
      if (role === 'staff') return safeRoleModules.staff.includes(key);
      if (role === 'kitchen') return safeRoleModules.kitchen.includes(key);
    }

    if (role === 'kitchen') {
      return key === 'kds';
    }

    if (role === 'manager') {
      if (['settings', 'database', 'notes'].includes(key)) return false;
      if (key === 'tables') return uiVisibility.manager_show_tables;
      return true;
    }

    // staff/cashier default access
    if (role === 'staff') {
      if (key === 'pos') return true;
      if (key === 'tables') return uiVisibility.staff_show_tables;
      if (key === 'kds') return uiVisibility.staff_show_kitchen;
      if (key === 'zreport') return true;
      return false;
    }

    return key === 'pos';
  };

  const visibleModules = moduleButtons.filter((m) => canAccess(m.key));
  const resolvedModule = visibleModules.find((m) => m.key === currentModule)?.key || visibleModules[0]?.key || 'pos';
  const guideMap = getGuideContent(safeLang);
  const activeGuide = guideMap[resolvedModule];
  const handleModuleHover = (module: ModuleKey, event: React.MouseEvent<HTMLButtonElement>) => {
    if (!quickGuideOpen || typeof window === 'undefined') return;
    const tooltipWidth = 320;
    const tooltipHeight = 132;
    const nextX = Math.min(window.innerWidth - tooltipWidth - 12, event.clientX + 14);
    const nextY = Math.min(window.innerHeight - tooltipHeight - 12, event.clientY + 14);
    setHoverGuide({
      module,
      x: Math.max(12, nextX),
      y: Math.max(12, nextY),
    });
  };

  const visibleModuleKeys = visibleModules.map((m) => m.key).join('|');
  const shouldHoldForTenantResolution = Boolean(
    hasValidUser &&
    currentHost &&
    currentHost !== 'localhost' &&
    currentHost !== '127.0.0.1' &&
    mappedTenantFromHost &&
    String(mappedTenantFromHost || '') !== String(user?.tenant_id || ''),
  );

  useEffect(() => {
    const onBusinessProfileUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ tenant_id?: string }>).detail;
      const eventTenant = String(detail?.tenant_id || '');
      const currentTenant = String(user?.tenant_id || activeTenant || '');
      if (!eventTenant || !currentTenant || eventTenant === currentTenant) {
        if (businessProfileUpdateTimerRef.current) window.clearTimeout(businessProfileUpdateTimerRef.current);
        businessProfileUpdateTimerRef.current = window.setTimeout(() => {
          setBusinessProfileVersion((prev) => prev + 1);
        }, 180);
      }
    };
    window.addEventListener('business-profile-updated', onBusinessProfileUpdated as EventListener);
    return () => {
      if (businessProfileUpdateTimerRef.current) window.clearTimeout(businessProfileUpdateTimerRef.current);
      window.removeEventListener('business-profile-updated', onBusinessProfileUpdated as EventListener);
    };
  }, [user?.tenant_id, activeTenant]);

  useEffect(() => {
    const onSettingsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ tenant_id?: string }>).detail;
      const eventTenant = String(detail?.tenant_id || '');
      const currentTenant = String(user?.tenant_id || activeTenant || '');
      if (!eventTenant || !currentTenant || eventTenant === currentTenant) {
        if (settingsUpdateTimerRef.current) window.clearTimeout(settingsUpdateTimerRef.current);
        settingsUpdateTimerRef.current = window.setTimeout(() => {
          setSettingsVersion((prev) => prev + 1);
        }, 180);
      }
    };
    window.addEventListener('settings-updated', onSettingsUpdated as EventListener);
    return () => {
      if (settingsUpdateTimerRef.current) window.clearTimeout(settingsUpdateTimerRef.current);
      window.removeEventListener('settings-updated', onSettingsUpdated as EventListener);
    };
  }, [user?.tenant_id, activeTenant]);

  useEffect(() => {
    if (!isPerfDebugEnabled()) return;
    const onPerf = (event: Event) => {
      const detail = (event as CustomEvent<PerfEvent>).detail;
      if (!detail) return;
      setPerfEvents((prev) => [detail, ...prev].slice(0, 8));
    };
    window.addEventListener('app-perf', onPerf as EventListener);
    return () => {
      window.removeEventListener('app-perf', onPerf as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (hostMode === 'landing') {
      document.title = 'iRonWaves POS';
      return;
    }
    const companyName = String(profile?.company_name || '').trim();
    document.title = companyName || 'iRonWaves POS';
  }, [hostMode, profile?.company_name]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const syncFullscreen = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    syncFullscreen();
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen);
    };
  }, []);

  useEffect(() => {
    if (!visibleModules.find((m) => m.key === currentModule)) {
      setCurrentModule(visibleModules[0]?.key || 'pos');
    }
  }, [sessionRole, currentModule, visibleModuleKeys]);

  useEffect(() => {
    setQuickGuideStepIndex(0);
  }, [resolvedModule]);

  useEffect(() => {
    if (!hasValidUser || !user?.tenant_id || !user?.username) return;
    const seenKey = `quick_guide_seen_${user.tenant_id}_${user.username}`;
    if (localStorage.getItem(seenKey) === '1') return;
    setQuickGuideOpen(true);
    setQuickGuideStepIndex(0);
    localStorage.setItem(seenKey, '1');
  }, [hasValidUser, user?.tenant_id, user?.username]);

  useEffect(() => {
    if (!quickGuideOpen && hoverGuide) setHoverGuide(null);
  }, [quickGuideOpen, hoverGuide]);

  useEffect(() => {
    if (safeLang !== lang) {
      setLang(safeLang);
    }
  }, [lang, safeLang, setLang]);

  const enterFullscreen = async () => {
    try {
      if (typeof document === 'undefined') return;
      const root = document.documentElement;
      if (!document.fullscreenElement) {
        await root.requestFullscreen();
      }
    } catch {
      notify('error', tx(safeLang, 'Tam ekran açıla bilmədi', 'Не удалось открыть полный экран', 'Failed to enter fullscreen'));
    }
  };

  const exitFullscreen = async () => {
    try {
      if (typeof document === 'undefined') return;
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      notify('error', tx(safeLang, 'Tam ekrandan çıxmaq alınmadı', 'Не удалось выйти из полного экрана', 'Failed to exit fullscreen'));
    }
  };

  if (!hasHydrated) {
    return (
      <div className="metal-app flex min-h-screen items-center justify-center text-slate-300">
        <div className="metal-panel rounded-xl px-6 py-4 text-sm">Sistem yüklənir...</div>
      </div>
    );
  }

  // Public receipt route should not redirect to login even if token is missing/invalid.
  if (publicReceiptParams.receiptId) {
    return <PublicReceipt receiptId={publicReceiptParams.receiptId} token={publicReceiptParams.token} />;
  }

  if (publicPathname === '/menu' || publicPathname === '/menu/') {
    return <PublicMenu />;
  }

  if (customerAppParams.join || (customerAppParams.cardId && customerAppParams.token)) {
    return <CustomerApp cardId={customerAppParams.cardId} token={customerAppParams.token} joinMode={customerAppParams.join} />;
  }

  if (hostMode === 'landing') {
    return <LandingPage />;
  }

  if (!hasValidUser) {
    return <PinLogin />;
  }

  if (sessionChecking || shouldHoldForTenantResolution) {
    return (
      <div className="metal-app flex min-h-screen items-center justify-center text-slate-300">
        <div className="metal-panel rounded-xl px-6 py-4 text-sm">{tx(safeLang, 'Tenant yoxlanır...', 'Проверка тенанта...', 'Checking tenant...')}</div>
      </div>
    );
  }

  const safeUser = user as NonNullable<typeof user>;
  const hostTenantMismatch = Boolean(
    currentHost &&
    currentHost !== 'localhost' &&
    currentHost !== '127.0.0.1' &&
    mappedTenantFromHost &&
    mappedTenantFromHost !== String(safeUser.tenant_id || ''),
  );
  const unknownForeignHost = Boolean(
    currentHost &&
    currentHost !== 'localhost' &&
    currentHost !== '127.0.0.1' &&
    !mappedTenantFromHost &&
    profileWebsiteHost &&
    currentHost !== profileWebsiteHost,
  );

  if (hostTenantMismatch || unknownForeignHost) {
    return (
      <div className="metal-app flex min-h-screen items-center justify-center px-4 text-slate-100">
        <div className="metal-panel w-full max-w-xl rounded-3xl p-8 text-center">
          <h1 className="text-2xl font-black">{tx(safeLang, 'Tenant tapılmadı', 'Тенант не найден', 'Tenant not found')}</h1>
          <p className="mt-3 text-sm text-slate-300">
            {tx(
              safeLang,
              'Bu ünvanda aktiv restoran workspace tapılmadı. Əgər bu subdomain sizə məxsusdursa, tenant qurulmasının və ya domen yönləndirilməsinin yoxlanması üçün bizimlə əlaqə saxlayın.',
              'По этому адресу не найден активный ресторанный workspace. Если этот субдомен принадлежит вам, свяжитесь с нами для проверки tenant-а или маршрута домена.',
              'No active restaurant workspace was found for this address. If this subdomain belongs to you, contact us so we can verify tenant provisioning or domain routing.',
            )}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button onClick={() => window.location.reload()} className="neon-btn px-4 py-3">
              {tx(safeLang, 'Yenilə', 'Обновить', 'Refresh')}
            </button>
            <a
              href="mailto:abbas@laptopmarket.az"
              className="rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-5 py-3 font-semibold text-cyan-50"
            >
              {tx(safeLang, 'E-poçt: abbas@laptopmarket.az', 'E-mail: abbas@laptopmarket.az', 'Email: abbas@laptopmarket.az')}
            </a>
            <a
              href="tel:+994552999282"
              className="glossy-gold rounded-xl px-5 py-3 font-bold text-slate-900"
            >
              {tx(safeLang, 'Əlaqə: +99455 299-92-82', 'Контакт: +99455 299-92-82', 'Contact: +99455 299-92-82')}
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="metal-app flex h-[100dvh] min-h-[100dvh] overflow-hidden font-sans text-slate-100 selection:bg-yellow-300/30">
      <ToastOverlay />
      {lowStockModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
          <div className="metal-panel w-full max-w-2xl rounded-2xl border border-amber-400/40 p-5">
            <h3 className="mb-2 text-xl font-bold text-amber-300">⚠️ Kritik Anbar Xəbərdarlığı</h3>
            <p className="mb-4 text-sm text-slate-300">Aşağıdakı mallar kritik stok həddindədir.</p>
            <div className="max-h-72 overflow-auto rounded-xl border border-slate-700/70">
              <table className="w-full text-sm">
                <thead className="bg-slate-800/70 text-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left">Məhsul</th>
                    <th className="px-3 py-2 text-left">Qalıq</th>
                    <th className="px-3 py-2 text-left">Kritik Hədd</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStockModal.map((row, idx) => (
                    <tr key={`${row.name}_${idx}`} className="border-t border-slate-700/70">
                      <td className="px-3 py-2 text-slate-100">{row.name}</td>
                      <td className="px-3 py-2 text-rose-300">{row.stock_qty} {row.unit}</td>
                      <td className="px-3 py-2 text-slate-300">{row.min_limit} {row.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end">
              <button className="glossy-gold rounded-xl px-5 py-2 font-semibold" onClick={() => setLowStockModal(null)}>
                Bağla
              </button>
            </div>
          </div>
        </div>
      )}
      {readyPopup && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4">
          <div className="metal-panel w-full max-w-lg rounded-2xl p-5">
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">{tx(safeLang, 'Hazır sifariş', 'Готовый заказ', 'Ready order')}</div>
            <h3 className="mt-2 text-2xl font-bold text-slate-100">{readyPopup.title}</h3>
            <p className="mt-2 text-sm text-slate-300">{readyPopup.message}</p>
            {Array.isArray(readyPopup.meta?.ready_items) && readyPopup.meta.ready_items.length > 0 ? (
              <div className="mt-4 rounded-xl border border-emerald-300/30 bg-emerald-400/10 p-4">
                <div className="mb-2 text-sm font-semibold text-emerald-100">{tx(safeLang, 'Hazır olanlar', 'Готовые позиции', 'Ready items')}</div>
                <div className="space-y-2">
                  {readyPopup.meta.ready_items.map((item: string, idx: number) => (
                    <div key={`${item}_${idx}`} className="rounded-lg bg-black/15 px-3 py-2 text-sm text-emerald-50">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="mt-5 flex justify-end">
              <button
                className="glossy-gold rounded-xl px-5 py-2 font-semibold"
                onClick={async () => {
                  try {
                    await mark_staff_notification_read_live(readyPopup.id);
                  } catch {
                    // ignore read failures for UI continuity
                  }
                  setReadyPopup(null);
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      <div
        className="flex-1 flex flex-col relative overflow-hidden"
        style={{ paddingBottom: keyboardInset > 0 ? `${keyboardInset}px` : undefined }}
      >
        <div className="border-b border-slate-700/40 px-4 py-4 md:px-6 shrink-0 z-20 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-yellow-400 text-[#111827] rounded-xl flex items-center justify-center shrink-0 font-black overflow-hidden">
                {profile?.logo_url ? (
                  <img src={profile.logo_url} alt="logo" className="h-full w-full object-cover" />
                ) : (
                  <span className="font-bold text-lg">SB</span>
                )}
              </div>
              <div>
                <p className="font-semibold leading-tight">{profile?.company_name || 'iRonWaves POS'}</p>
                  <p className="text-xs text-slate-400">{safeUser.username} / {safeUser.role}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {sessionRole === 'super_admin' && availableTenants.length > 0 && (
                <label className="flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-100">
                  <span className="hidden md:inline">{tx(safeLang, 'Tenant', 'Тенант', 'Tenant')}</span>
                  <select
                    value={selectedTenantId}
                    onChange={(event) => handleTenantSwitch(event.target.value)}
                    disabled={tenantSwitching}
                    className="min-w-[180px] bg-transparent text-sm font-medium text-cyan-50 outline-none"
                  >
                    {availableTenants.map((tenant) => (
                      <option key={tenant.tenant_id} value={tenant.tenant_id} className="bg-slate-900 text-slate-100">
                        {tenant.company_name || tenant.slug || tenant.tenant_id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isOnline ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-200 shadow-sm animate-pulse'
              }`}>
                {isOnline ? <Wifi size={16} /> : <WifiOff size={16} />}
                <span>{isOnline ? t.online : t.offline}</span>
              </div>
              {pendingOfflineCount > 0 && (
                <div className="flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-400/10 px-3 py-1.5 text-sm font-medium text-amber-200">
                  <span>{pendingOfflineCount}</span>
                  <span>{tx(safeLang, 'gözləyən sync', 'ожидает синхронизации', 'pending sync')}</span>
                </div>
              )}
              <button
                onClick={() => window.location.reload()}
                className="neon-btn px-3 py-2"
                title="Yenilə"
              >
                <RotateCcw size={16} />
                <span className="hidden sm:inline">{t.refresh}</span>
              </button>
              <button
                onClick={() => setQuickGuideOpen((prev) => !prev)}
                className="neon-btn px-3 py-2"
                title={tx(safeLang, 'Cari modul üçün quick guide', 'Quick guide для текущего модуля', 'Quick guide for current module')}
              >
                <BookOpen size={16} />
                <span className="hidden sm:inline">{tx(safeLang, 'Quick Guide', 'Quick Guide', 'Quick Guide')}</span>
              </button>
              <button
                onClick={() => setLang(safeLang === 'az' ? 'ru' : safeLang === 'ru' ? 'en' : 'az')}
                className="neon-btn px-3 py-2"
              >
                <Languages size={16} />
                <span>{safeLang.toUpperCase()}</span>
              </button>
              {!isFullscreen ? (
                <button
                  onClick={() => void enterFullscreen()}
                  className="neon-btn px-3 py-2"
                  title={tx(safeLang, 'Tam ekran', 'Полный экран', 'Fullscreen')}
                >
                  <Maximize2 size={16} />
                  <span className="hidden sm:inline">{tx(safeLang, 'Tam ekran', 'Полный экран', 'Fullscreen')}</span>
                </button>
              ) : (
                <button
                  onClick={() => void exitFullscreen()}
                  className="neon-btn-active px-3 py-2"
                  title={tx(safeLang, 'Tam ekrandan çıx', 'Выйти из полного экрана', 'Exit fullscreen')}
                >
                  <Minimize2 size={16} />
                  <span className="hidden sm:inline">{tx(safeLang, 'Tam ekrandan çıx', 'Выйти из полного экрана', 'Exit fullscreen')}</span>
                </button>
              )}
              <button
                onClick={logout}
                className="neon-btn-active px-3 py-2"
              >
                <LogOut size={16} />
                <span>{t.logout}</span>
              </button>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-3 overflow-x-auto pb-2">
            {visibleModules.map((item) => (
                <button
                  key={item.key}
                  onClick={() => setCurrentModule(item.key)}
                  className={`${resolvedModule === item.key ? 'neon-chip neon-chip-active' : 'neon-chip'} whitespace-nowrap px-4 py-3 text-sm`}
                  title={guideMap[item.key]?.moduleDescription || item.label}
                  onMouseEnter={(event) => handleModuleHover(item.key, event)}
                  onMouseMove={(event) => handleModuleHover(item.key, event)}
                  onMouseLeave={() => setHoverGuide((prev) => (prev?.module === item.key ? null : prev))}
                >
                  <span>{item.label}</span>
                </button>
              ))}
          </div>
          {quickGuideOpen && activeGuide && (
            <div className="rounded-2xl border border-yellow-300/30 bg-yellow-400/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-yellow-200">
                    {tx(safeLang, 'Quick Guide', 'Quick Guide', 'Quick Guide')}
                  </div>
                  <div className="mt-1 text-sm text-slate-200">{activeGuide.moduleDescription}</div>
                </div>
                <button className="neon-btn px-2 py-1" onClick={() => setQuickGuideOpen(false)} title={tx(safeLang, 'Bağla', 'Закрыть', 'Close')}>
                  <X size={14} />
                </button>
              </div>
              <div className="mt-3 rounded-xl border border-slate-700/70 bg-slate-900/45 p-3">
                <div className="text-sm font-semibold text-slate-100">
                  {activeGuide.steps[Math.min(quickGuideStepIndex, activeGuide.steps.length - 1)]?.title}
                </div>
                <div className="mt-1 text-sm text-slate-300">
                  {activeGuide.steps[Math.min(quickGuideStepIndex, activeGuide.steps.length - 1)]?.description}
                </div>
                {activeGuide.steps[Math.min(quickGuideStepIndex, activeGuide.steps.length - 1)]?.actionLabel &&
                  activeGuide.steps[Math.min(quickGuideStepIndex, activeGuide.steps.length - 1)]?.actionModule && (
                    <div className="mt-3">
                      <button
                        className="glossy-gold rounded-lg px-3 py-1.5 text-sm font-semibold"
                        onClick={() => {
                          const target = activeGuide.steps[Math.min(quickGuideStepIndex, activeGuide.steps.length - 1)]?.actionModule as ModuleKey;
                          if (canAccess(target)) setCurrentModule(target);
                        }}
                      >
                        {activeGuide.steps[Math.min(quickGuideStepIndex, activeGuide.steps.length - 1)]?.actionLabel}
                      </button>
                    </div>
                  )}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="text-xs text-slate-400">{quickGuideStepIndex + 1} / {activeGuide.steps.length}</div>
                <div className="flex items-center gap-2">
                  <button
                    className="neon-btn px-2 py-1"
                    onClick={() => setQuickGuideStepIndex((prev) => Math.max(0, prev - 1))}
                    disabled={quickGuideStepIndex <= 0}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    className="neon-btn px-2 py-1"
                    onClick={() => setQuickGuideStepIndex((prev) => Math.min(activeGuide.steps.length - 1, prev + 1))}
                    disabled={quickGuideStepIndex >= activeGuide.steps.length - 1}
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {quickGuideOpen && hoverGuide && guideMap[hoverGuide.module] && (
          <div
            className="pointer-events-none fixed z-[95] w-[320px] rounded-2xl border border-cyan-300/35 bg-slate-950/92 p-3 shadow-[0_14px_42px_rgba(0,0,0,0.45)] backdrop-blur"
            style={{ left: hoverGuide.x, top: hoverGuide.y }}
          >
            <div className="text-[11px] uppercase tracking-[0.14em] text-cyan-200">
              {tx(safeLang, 'Cursor Guide', 'Cursor Guide', 'Cursor Guide')}
            </div>
            <div className="mt-1 text-xs font-semibold text-slate-100">
              {guideMap[hoverGuide.module].steps[0]?.title}
            </div>
            <div className="mt-1 text-xs text-slate-300 line-clamp-3">
              {guideMap[hoverGuide.module].moduleDescription}
            </div>
          </div>
        )}

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <AppErrorBoundary>
            {resolvedModule === 'pos' && <POS key={moduleTenantKey} />}
            {resolvedModule === 'kds' && <KDS key={moduleTenantKey} />}
            {resolvedModule === 'tables' && <TablesPage key={moduleTenantKey} />}
            {!['pos', 'kds', 'tables'].includes(resolvedModule) && <AdminPanel key={moduleTenantKey} externalTab={resolvedModule as AdminView} />}
          </AppErrorBoundary>
        </div>

        <div className="shrink-0 border-t border-slate-700/40 bg-[#0e141d]/95 px-2 py-2 md:hidden">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {visibleModules.map((item) => (
              <button
                key={`mobile_${item.key}`}
                onClick={() => setCurrentModule(item.key)}
                className={`${resolvedModule === item.key ? 'neon-chip neon-chip-active' : 'neon-chip'} whitespace-nowrap`}
                title={guideMap[item.key]?.moduleDescription || item.label}
              >
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="hidden md:block shrink-0 border-t border-slate-700/40 px-4 py-2 text-center text-xs text-slate-400">
          iRonWaves POS
        </div>
      </div>
      {isPerfDebugEnabled() && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-[120] w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-cyan-400/25 bg-slate-950/88 p-3 text-xs text-slate-100 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-bold text-cyan-200">Perf Debug</div>
            <div className="text-[10px] text-slate-400">?perf=1</div>
          </div>
          <div className="space-y-2">
            {perfEvents.length === 0 ? (
              <div className="text-slate-400">No request timings yet.</div>
            ) : perfEvents.map((row, idx) => (
              <div key={`${row.at}_${idx}`} className="rounded-xl border border-white/8 bg-white/4 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="truncate font-medium text-slate-200">{row.label}</div>
                  <div className={`${row.duration_ms > 1200 ? 'text-rose-300' : row.duration_ms > 500 ? 'text-amber-300' : 'text-emerald-300'}`}>
                    {row.duration_ms} ms
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 text-[10px] text-slate-400">
                  <span>{row.status ? `HTTP ${row.status}` : row.ok ? 'OK' : 'ERR'}</span>
                  <span>{new Date(row.at).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <VirtualKeyboard lang={safeLang} enabled={virtualKeyboardEnabled} />
    </div>
  );
}
