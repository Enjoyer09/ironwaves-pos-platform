export type HelpLang = 'az' | 'ru' | 'en';

type HelpManualEntry = {
  id: string;
  module: string;
  title_az: string;
  title_ru: string;
  title_en: string;
  content_az: string;
  content_ru: string;
  content_en: string;
  keywords: string[];
};

export type HelpAnswer = {
  answer: string;
  sources: string[];
};

const MANUAL: HelpManualEntry[] = [
  {
    id: 'pos_sale',
    module: 'pos',
    title_az: 'POS Satış Axını',
    title_ru: 'Поток продаж POS',
    title_en: 'POS Sales Flow',
    content_az: 'POS-da məhsul seç, səbətə əlavə et, endirim və ödəniş növünü yoxla, sonra satışı tamamla. Offline rejimdə satışlar növbədə saxlanılır və internet bərpa olunanda sync edilir.',
    content_ru: 'В POS выберите товар, добавьте в корзину, проверьте скидку и способ оплаты, затем завершите продажу. В офлайн-режиме продажи ставятся в очередь и синхронизируются после восстановления интернета.',
    content_en: 'In POS, select items, add to cart, verify discount and payment method, then complete the sale. In offline mode sales are queued and synced when connection returns.',
    keywords: ['pos', 'satış', 'sale', 'səbət', 'cart', 'ödəniş', 'payment', 'offline', 'sync'],
  },
  {
    id: 'tables_kitchen',
    module: 'tables',
    title_az: 'Masa və Mətbəx',
    title_ru: 'Столы и кухня',
    title_en: 'Tables and Kitchen',
    content_az: 'Masada sifariş açıldıqda item-ləri mətbəxə göndər. Statuslar NEW/SENT/PREPARING/READY ardıcıllığı ilə izlənir. Gecikən sifarişlər üçün KDS və masa statusunu yoxla.',
    content_ru: 'После открытия заказа за столом отправляйте позиции на кухню. Статусы отслеживаются как NEW/SENT/PREPARING/READY. При задержках проверьте KDS и статус стола.',
    content_en: 'When a table order is open, send items to kitchen. Track statuses as NEW/SENT/PREPARING/READY. For delays, check KDS and table status.',
    keywords: ['masa', 'table', 'mətbəx', 'kitchen', 'kds', 'new', 'sent', 'ready', 'preparing'],
  },
  {
    id: 'finance_shift',
    module: 'finance',
    title_az: 'Maliyyə və Shift Bağlanışı',
    title_ru: 'Финансы и закрытие смены',
    title_en: 'Finance and Shift Closing',
    content_az: 'Shift açılış/bağlanışında faktiki kassanı daxil et. Böyük fərqlərdə approval gözlənir. Investor repayment və kritik cash adjustment əməliyyatları təsdiqlə tamamlanmalıdır.',
    content_ru: 'При открытии/закрытии смены указывайте фактическую кассу. При больших расхождениях требуется approval. Investor repayment и критические cash adjustment должны завершаться через подтверждение.',
    content_en: 'Enter actual cash on shift open/close. Large variances require approval. Investor repayment and critical cash adjustments must go through approval.',
    keywords: ['maliyyə', 'finance', 'shift', 'z-report', 'x-report', 'approval', 'cash', 'investor'],
  },
  {
    id: 'inventory_recipe',
    module: 'inventory',
    title_az: 'Anbar və Resept',
    title_ru: 'Склад и рецепты',
    title_en: 'Inventory and Recipes',
    content_az: 'Anbara mədaxil/məxaric yazanda maliyyə və COGS təsirləri yoxlanmalıdır. Reseptdə ingredient bağlılığı düzgün qurulanda satış zamanı xammal sərfi avtomatik çıxılır.',
    content_ru: 'При приходе/расходе на складе проверяйте влияние на финансы и COGS. При корректных связях рецепта расход сырья списывается автоматически во время продажи.',
    content_en: 'When adding stock in/out, verify finance and COGS impact. With proper recipe links, ingredient consumption is deducted automatically on sale.',
    keywords: ['anbar', 'inventory', 'resept', 'recipe', 'cogs', 'xammal', 'stock', 'ingredient'],
  },
  {
    id: 'tenant_domain',
    module: 'settings',
    title_az: 'Tenant və Domain Problemləri',
    title_ru: 'Проблемы tenant и домена',
    title_en: 'Tenant and Domain Issues',
    content_az: '“Tenant not configured” xətasında domain mapping və tenant statusunu yoxla. Backend request-id ilə logları müqayisə et. Bəzən ilk refresh-də gecikmə ola bilər, ikinci yoxlama ilə bərpa olunur.',
    content_ru: 'При ошибке “Tenant not configured” проверьте domain mapping и статус tenant. Сопоставьте логи по request-id на backend. Иногда на первом refresh бывает задержка, на втором восстанавливается.',
    content_en: 'For “Tenant not configured”, verify domain mapping and tenant status. Correlate backend logs by request-id. Sometimes first refresh can lag and recover on second check.',
    keywords: ['tenant', 'domain', 'not configured', 'request-id', 'mapping', 'super', 'socialbee'],
  },
];

const GLOBAL_HINTS: Record<string, { az: string; ru: string; en: string }> = {
  pin: {
    az: 'PIN/login problemlərində əvvəlcə klaviatura dili, PIN uzunluğu və istifadəçi rolu uyğunluğunu yoxlayın.',
    ru: 'При проблемах с PIN/login сначала проверьте язык клавиатуры, длину PIN и соответствие роли пользователя.',
    en: 'For PIN/login issues, first verify keyboard language, PIN length, and user role alignment.',
  },
  network: {
    az: 'Şəbəkə qeyri-sabitdirsə satışları dayandırmayın: offline queue işləyir, sonra sync statusunu nəzarət edin.',
    ru: 'При нестабильной сети не останавливайте продажи: офлайн-очередь работает, затем контролируйте статус синхронизации.',
    en: 'If network is unstable, keep selling: offline queue works, then monitor sync status.',
  },
  ops: {
    az: 'Əməliyyat sabitliyi üçün: shift intizamı, günlük Z-report və approval pending siyahısını sıfır saxlamaq tövsiyə olunur.',
    ru: 'Для операционной стабильности: дисциплина смен, ежедневный Z-report и нулевой список approval pending.',
    en: 'For operational stability: shift discipline, daily Z-report, and keeping approval pending at zero.',
  },
};

function normalize(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[ə]/g, 'e')
    .replace(/[ı]/g, 'i')
    .replace(/[ö]/g, 'o')
    .replace(/[ü]/g, 'u')
    .replace(/[ç]/g, 'c')
    .replace(/[ş]/g, 's')
    .replace(/[ğ]/g, 'g');
}

function localizedTitle(entry: HelpManualEntry, lang: HelpLang): string {
  if (lang === 'ru') return entry.title_ru;
  if (lang === 'en') return entry.title_en;
  return entry.title_az;
}

function localizedContent(entry: HelpManualEntry, lang: HelpLang): string {
  if (lang === 'ru') return entry.content_ru;
  if (lang === 'en') return entry.content_en;
  return entry.content_az;
}

function scoreEntry(entry: HelpManualEntry, query: string, currentModule: string): number {
  const q = normalize(query);
  let score = 0;
  if (entry.module === currentModule) score += 2;
  for (const key of entry.keywords) {
    if (q.includes(normalize(key))) score += 3;
  }
  if (q.includes(normalize(entry.title_az)) || q.includes(normalize(entry.title_en)) || q.includes(normalize(entry.title_ru))) score += 2;
  return score;
}

function pickGlobalHints(query: string, lang: HelpLang): string[] {
  const q = normalize(query);
  const hints: string[] = [];
  if (q.includes('pin') || q.includes('login') || q.includes('sifre') || q.includes('şifrə')) {
    hints.push(GLOBAL_HINTS.pin[lang]);
  }
  if (q.includes('network') || q.includes('internet') || q.includes('offline') || q.includes('sync')) {
    hints.push(GLOBAL_HINTS.network[lang]);
  }
  hints.push(GLOBAL_HINTS.ops[lang]);
  return Array.from(new Set(hints)).slice(0, 2);
}

export function buildHelpAnswer(question: string, lang: HelpLang, currentModule: string): HelpAnswer {
  const raw = String(question || '').trim();
  if (!raw) {
    return {
      answer:
        lang === 'ru'
          ? 'Вопрос пустой. Напишите коротко, что именно не работает.'
          : lang === 'en'
            ? 'Your question is empty. Please describe what is not working.'
            : 'Sual boşdur. Qısa yazın: konkret nə işləmir?',
      sources: [],
    };
  }

  const ranked = MANUAL
    .map((entry) => ({ entry, score: scoreEntry(entry, raw, currentModule) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  const manualLines = ranked.map(({ entry }) => `• ${localizedContent(entry, lang)}`);
  const sourceTitles = ranked.map(({ entry }) => localizedTitle(entry, lang));
  const globalHints = pickGlobalHints(raw, lang).map((line) => `• ${line}`);

  let lead = '';
  if (lang === 'ru') {
    lead = 'Kраткий ответ ассистента:';
  } else if (lang === 'en') {
    lead = 'Assistant quick answer:';
  } else {
    lead = 'Assistant qısa cavabı:';
  }

  const sections: string[] = [lead];
  if (manualLines.length) {
    sections.push(...manualLines);
  } else {
    sections.push(
      lang === 'ru'
        ? '• По ручной базе точного совпадения нет, но ниже — безопасные операционные рекомендации.'
        : lang === 'en'
          ? '• No exact manual match found; below are safe operational recommendations.'
          : '• Manual bazada tam uyğunluq tapılmadı, amma aşağıda təhlükəsiz əməliyyat tövsiyələri var.',
    );
  }
  sections.push(...globalHints);

  return {
    answer: sections.join('\n'),
    sources: sourceTitles,
  };
}

