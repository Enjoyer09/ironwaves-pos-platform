const BAKU_TIME_ZONE = 'Asia/Baku';

const hasTimezoneSuffix = (value: string) => /z$/i.test(value) || /[+-]\d{2}:\d{2}$/.test(value);

const pad2 = (value: number) => String(value).padStart(2, '0');

export const localeForLang = (lang?: string | null) => (lang === 'ru' ? 'ru-RU' : 'az-AZ');

// Backend generated timestamps are stored as UTC but often returned without a
// timezone suffix. Treat timezone-less server timestamps as UTC explicitly.
export const parseServerUtcTimestamp = (value?: string | null) => {
  if (!value) return null;
  const normalized = hasTimezoneSuffix(value) ? value : `${value}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// Reservations are operator-entered restaurant-local times. Do not shift them
// as UTC, otherwise a 18:30 booking appears as 14:30 in Baku.
export const parseRestaurantLocalTimestamp = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatServerUtcTime = (value?: string | null, lang?: string | null) => {
  const parsed = parseServerUtcTimestamp(value);
  return parsed
    ? parsed.toLocaleTimeString(localeForLang(lang), { hour: '2-digit', minute: '2-digit', timeZone: BAKU_TIME_ZONE })
    : '-';
};

export const formatServerUtcDateTime = (value?: string | null, lang?: string | null) => {
  const parsed = parseServerUtcTimestamp(value);
  return parsed ? parsed.toLocaleString(localeForLang(lang), { timeZone: BAKU_TIME_ZONE }) : '-';
};

export const formatRestaurantLocalTime = (value?: string | null, lang?: string | null) => {
  const parsed = parseRestaurantLocalTimestamp(value);
  return parsed ? parsed.toLocaleTimeString(localeForLang(lang), { hour: '2-digit', minute: '2-digit' }) : '-';
};

export const localDateInputValue = (date = new Date()) => {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

export const localDateTimeStart = (dateValue?: string | null) => {
  const date = String(dateValue || localDateInputValue()).slice(0, 10);
  return `${date}T00:00:00`;
};

export const localDateTimeNextStart = (dateValue?: string | null) => {
  const raw = String(dateValue || localDateInputValue()).slice(0, 10);
  const [year, month, day] = raw.split('-').map((part) => Number(part));
  if (!year || !month || !day) {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + 1);
    return localDateTimeStart(localDateInputValue(fallback));
  }
  const next = new Date(year, month - 1, day + 1);
  return localDateTimeStart(localDateInputValue(next));
};
