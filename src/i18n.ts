export const i18n = {
  az: {
    login: 'Sistemə Giriş',
    pin_prompt: 'PİN Kodunuzu daxil edin',
    admin_pin: '',
    staff_pin: '',
    clear: 'Təmizlə',
    pos: 'POS (Satış)',
    kds: 'Mətbəx Ekranı',
    admin: 'İdarəetmə Paneli',
    logout: 'Çıxış',
    search: 'Məhsul axtar...',
    all_categories: 'Bütün Kateqoriyalar',
    coffee: 'Qəhvə',
    tea: 'Çay',
    food: 'Qida',
    dessert: 'Şirniyyat',
    cart: 'Səbət',
    cart_empty: 'Səbət boşdur',
    discount: 'Endirim',
    total: 'Cəmi',
    pay: 'Ödəniş Et',
    offline: 'Offline Rejim',
    online: 'Online',
    new_order: 'Yeni Sifariş',
    preparing: 'Hazırlanır',
    done: 'Hazırdır',
    sales: 'Satışlar',
    revenue: 'Gəlir',
    menu_management: 'Menyu İdarəetməsi',
    add_item: 'Məhsul Əlavə Et',
    price: 'Qiymət',
    name_az: 'Ad (AZ)',
    name_ru: 'Ad (RU)',
    action: 'Əməliyyat',
    delete: 'Sil',
    cash: 'Nağd',
    card: 'Kart',
    refresh: 'Yenilə',
    modules: {
      pos: 'POS',
      tables: 'Masalar',
      kds: 'Mətbəx',
      dashboard: 'Dashboard',
      zreport: 'Z-Hesabat',
      finance: 'Maliyyə',
      inventory: 'Anbar',
      combos: 'Kombolar',
      analytics: 'Analitika',
      logs: 'Loqlar',
      crm: 'CRM',
      customerapp: 'Müştəri Tətbiqi',
      posbuilder: 'Dizayn & QR',
      ai: 'AI Menecer',
      menu: 'Menyu',
      recipes: 'Resept',
      tenants: 'Tenantlər',
      notes: 'Qeydlər',
      settings: 'Ayarlar',
      landing: 'Landing Studio',
      database: 'Backup/Restore'
    }
  },
  ru: {
    login: 'Вход в систему',
    pin_prompt: 'Введите свой PIN-код',
    admin_pin: '',
    staff_pin: '',
    clear: 'Очистить',
    pos: 'POS (Продажа)',
    kds: 'Экран Кухни',
    admin: 'Панель Управления',
    logout: 'Выйти',
    search: 'Поиск товаров...',
    all_categories: 'Все Категории',
    coffee: 'Кофе',
    tea: 'Чай',
    food: 'Еда',
    dessert: 'Десерты',
    cart: 'Корзина',
    cart_empty: 'Корзина пуста',
    discount: 'Скидка',
    total: 'Итого',
    pay: 'Оплатить',
    offline: 'Оффлайн Режим',
    online: 'Онлайн',
    new_order: 'Новый Заказ',
    preparing: 'Готовится',
    done: 'Готово',
    sales: 'Продажи',
    revenue: 'Выручка',
    menu_management: 'Управление Меню',
    add_item: 'Добавить товар',
    price: 'Цена',
    name_az: 'Название (AZ)',
    name_ru: 'Название (RU)',
    action: 'Действие',
    delete: 'Удалить',
    cash: 'Наличные',
    card: 'Карта',
    refresh: 'Обновить',
    modules: {
      pos: 'POS',
      tables: 'Столы',
      kds: 'Кухня',
      dashboard: 'Дашборд',
      zreport: 'Z-Отчёт',
      finance: 'Финансы',
      inventory: 'Склад',
      combos: 'Комбо',
      analytics: 'Аналитика',
      logs: 'Логи',
      crm: 'CRM',
      customerapp: 'Приложение клиента',
      posbuilder: 'Дизайн & QR',
      ai: 'AI Менеджер',
      menu: 'Меню',
      recipes: 'Рецепт',
      tenants: 'Тенанты',
      notes: 'Заметки',
      settings: 'Настройки',
      landing: 'Landing Studio',
      database: 'Backup/Restore'
    }
  },
  en: {
    login: 'Login',
    pin_prompt: 'Enter your PIN code',
    admin_pin: '',
    staff_pin: '',
    clear: 'Clear',
    pos: 'POS (Sales)',
    kds: 'Kitchen Screen',
    admin: 'Admin Panel',
    logout: 'Logout',
    search: 'Search products...',
    all_categories: 'All Categories',
    coffee: 'Coffee',
    tea: 'Tea',
    food: 'Food',
    dessert: 'Dessert',
    cart: 'Cart',
    cart_empty: 'Cart is empty',
    discount: 'Discount',
    total: 'Total',
    pay: 'Pay',
    offline: 'Offline Mode',
    online: 'Online',
    new_order: 'New Order',
    preparing: 'Preparing',
    done: 'Done',
    sales: 'Sales',
    revenue: 'Revenue',
    menu_management: 'Menu Management',
    add_item: 'Add Item',
    price: 'Price',
    name_az: 'Name (AZ)',
    name_ru: 'Name (RU)',
    action: 'Action',
    delete: 'Delete',
    cash: 'Cash',
    card: 'Card',
    refresh: 'Refresh',
    modules: {
      pos: 'POS',
      tables: 'Tables',
      kds: 'Kitchen',
      dashboard: 'Dashboard',
      zreport: 'Z-Report',
      finance: 'Finance',
      inventory: 'Inventory',
      combos: 'Combos',
      analytics: 'Analytics',
      logs: 'Logs',
      crm: 'CRM',
      customerapp: 'Customer App',
      posbuilder: 'Design & QR',
      ai: 'AI Manager',
      menu: 'Menu',
      recipes: 'Recipes',
      tenants: 'Tenants',
      notes: 'Notes',
      settings: 'Settings',
      landing: 'Landing Studio',
      database: 'Backup/Restore'
    }
  }
};

export type Lang = keyof typeof i18n;

export function tx(lang: Lang, az: string, ru: string, en?: string): string {
  if (lang === 'ru') return ru;
  if (lang === 'en') return en || az;
  return az;
}

export function formatFriendlyFinanceNote(note: string | null | undefined, lang: any): string {
  if (!note) return '-';
  const clean = note.trim();
  
  // 1. Matches "POS sale COGS <uuid or code>"
  const cogsRegex = /^POS sale COGS\s+([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{8,12})$/i;
  const cogsMatch = clean.match(cogsRegex);
  if (cogsMatch) {
    const shortId = cogsMatch[1].length > 12 ? cogsMatch[1].slice(0, 8).toUpperCase() : cogsMatch[1].toUpperCase();
    return tx(lang, `Satışın maya dəyəri (Çek: #${shortId})`, `Себестоимость продажи (Чек: #${shortId})`, `Sale COGS (Receipt: #${shortId})`);
  }
  
  // 2. Matches "POS Sale <uuid or code>"
  const saleRegex = /^POS Sale\s+([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{8,12})$/i;
  const saleMatch = clean.match(saleRegex);
  if (saleMatch) {
    const shortId = saleMatch[1].length > 12 ? saleMatch[1].slice(0, 8).toUpperCase() : saleMatch[1].toUpperCase();
    return tx(lang, `POS Satış (Çek: #${shortId})`, `POS Продажа (Чек: #${shortId})`, `POS Sale (Receipt: #${shortId})`);
  }
  
  // 3. Matches "Reversal request for <uuid or code>"
  const revReqRegex = /^Reversal request for\s+([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{8,12})$/i;
  const revReqMatch = clean.match(revReqRegex);
  if (revReqMatch) {
    const shortId = revReqMatch[1].length > 12 ? revReqMatch[1].slice(0, 8).toUpperCase() : revReqMatch[1].toUpperCase();
    return tx(lang, `Geri qaytarma sorğusu (Əməliyyat: #${shortId})`, `Запрос на возврат (Операция: #${shortId})`, `Reversal request (Tx: #${shortId})`);
  }
  
  // 4. Matches "Reversal auto-post for <uuid or code>"
  const revAutoRegex = /Reversal auto-post.*for\s+([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{8,12})/i;
  const revAutoMatch = clean.match(revAutoRegex);
  if (revAutoMatch) {
    const shortId = revAutoMatch[1].length > 12 ? revAutoMatch[1].slice(0, 8).toUpperCase() : revAutoMatch[1].toUpperCase();
    return tx(lang, `Geri qaytarma (Əməliyyat: #${shortId})`, `Возврат (Операция: #${shortId})`, `Reversal (Tx: #${shortId})`);
  }
  
  // 5. General UUID shortener in notes if present
  const uuidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
  if (uuidRegex.test(clean)) {
    return clean.replace(uuidRegex, (match) => match.slice(0, 8).toUpperCase());
  }
  
  return clean;
}
