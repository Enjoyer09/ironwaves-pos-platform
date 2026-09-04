/**
 * Loyalty proqramının paylaşılan normalizasiyası (P0.3).
 *
 * Niyə ayrı fayl: `reward_threshold` üç yerdə oxunur — POS satış axını
 * (`src/api/pos.ts`), customer-app lokal sessiyası (`src/api/crm.ts`) və
 * customer-app UI-ı. Əvvəl hər biri öz düsturunu işlədirdi (`|| 10`,
 * `Math.max(1, ...)`, hardcoded `10`) və nəticələr fərqlənirdi.
 *
 * Bu modul qəsdən yüngüldür (heç bir import yoxdur), çünki `crm.ts` customer
 * app-ın tək API modulu-dur — `pos.ts`-i ona bağlamaq `decimal.js` və finance
 * kodunu customer bundle-ına dartardı (`npm run build:customer` tək fayldır).
 */

/** `customer_app_settings.reward_threshold` üçün default — bir hədiyyəyə neçə ulduz. */
export const DEFAULT_REWARD_THRESHOLD = 10;

/** Ağıllı yuxarı hədd; backend `operations.py::_norm_int(..., 1, 1000)` ilə eynidir. */
export const MAX_REWARD_THRESHOLD = 1000;

/**
 * Hədiyyə həddini normalizə edir.
 *
 * Backend güzgüsü: `operations.py::_norm_int(raw, 10, 1, 1000)` və
 * `pos.py::_reward_threshold`. Vacib detal: **0, mənfi və format xətası
 * default 10-a düşür, 1-ə DEYİL** — hədd 1 olsa hər qəhvə pulsuz olardı,
 * yəni səhv oxuma kassanı dağıdar. 10-a düşmək sadəcə köhnə davranışdır.
 *
 * Satış axınında işlədiyi üçün heç bir halda exception atmır.
 */
export const normalizeRewardThreshold = (raw: unknown): number => {
  if (raw === null || raw === undefined || typeof raw === 'boolean') return DEFAULT_REWARD_THRESHOLD;
  if (typeof raw === 'string' && !raw.trim()) return DEFAULT_REWARD_THRESHOLD;
  const parsed = Math.trunc(Number(raw));
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_REWARD_THRESHOLD;
  return Math.min(parsed, MAX_REWARD_THRESHOLD);
};
