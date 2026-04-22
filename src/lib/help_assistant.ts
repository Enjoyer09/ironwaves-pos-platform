import handbookAzRaw from '../content/user_handbook_az.md?raw';

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

function slugify(value: string): string {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function inferModuleFromText(title: string, content: string): string {
  const text = normalize(`${title} ${content}`);
  if (/(z-hesabat|z report|x-hesabat|x report|smen)/.test(text)) return 'zreport';
  if (/(kds|metbex|kitchen)/.test(text)) return 'kds';
  if (/(masa|tables)/.test(text)) return 'tables';
  if (/(maliyye|finance|depozit)/.test(text)) return 'finance';
  if (/(analytics)/.test(text)) return 'analytics';
  if (/(logs|log)/.test(text)) return 'logs';
  if (/(crm|loyalliq|loyalty)/.test(text)) return 'crm';
  if (/(menu|qr menu|menyu)/.test(text)) return 'menu';
  if (/(anbar|inventory|resept|recipe|stock)/.test(text)) return 'inventory';
  if (/(dashboard)/.test(text)) return 'analytics';
  return 'pos';
}

function buildKeywords(title: string, content: string): string[] {
  const base = `${title} ${content}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((part) => part.length >= 3);
  const unique = Array.from(new Set(base));
  return unique.slice(0, 16);
}

function parseHandbookMarkdownToEntries(raw: string): HelpManualEntry[] {
  const lines = String(raw || '').split(/\r?\n/);
  const sections: Array<{ title: string; content: string }> = [];

  let currentTitle = '';
  let currentContent: string[] = [];

  const flush = () => {
    if (!currentTitle) return;
    const content = currentContent.join('\n').trim();
    sections.push({ title: currentTitle.trim(), content });
  };

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      flush();
      currentTitle = heading[1].trim();
      currentContent = [];
      continue;
    }
    if (!currentTitle) continue;
    currentContent.push(line);
  }
  flush();

  return sections
    .filter((section) => section.title && section.content)
    .map((section, index) => {
      const module = inferModuleFromText(section.title, section.content);
      return {
        id: slugify(section.title) || `manual_${index + 1}`,
        module,
        title_az: section.title,
        title_ru: section.title,
        title_en: section.title,
        content_az: section.content,
        content_ru: section.content,
        content_en: section.content,
        keywords: buildKeywords(section.title, section.content),
      };
    });
}

const MANUAL: HelpManualEntry[] = parseHandbookMarkdownToEntries(handbookAzRaw);

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

export function getManualEntries(lang: HelpLang): Array<{
  id: string;
  module: string;
  title: string;
  content: string;
}> {
  return MANUAL.map((entry) => ({
    id: entry.id,
    module: entry.module,
    title: localizedTitle(entry, lang),
    content: localizedContent(entry, lang),
  }));
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

  const lead =
    lang === 'ru'
      ? 'Kраткий ответ ассистента:'
      : lang === 'en'
        ? 'Assistant quick answer:'
        : 'Assistant qısa cavabı:';

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

