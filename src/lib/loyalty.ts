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

/* ------------------------------------------------------------------ *
 * P1.2 — səviyyə (tier) nərdivanının kanonik defaultu
 *
 * Niyə burada: audit §4.2 nərdivanın **dörd fərqli nüsxəsini** sayırdı
 * (`settings.ts`, `crm.ts`, `operations.py`, HomeTab/ProfileTab fallback-ları).
 * `crm.ts` customer app-ın tək API modulu-dur və `settings.ts`-i import edə
 * bilməz (`db_sim` + `client` + finance kodunu tək-fayl customer bundle-ına
 * dartardı), ona görə paylaşılan yer bu yüngül fayldır — `normalizeRewardThreshold`
 * P0.3-də eyni səbəbdən buraya gəlmişdi.
 *
 * Backend güzgüsü: `operations.py::DEFAULT_TIERS`. Rəqəmlər dəyişsə hər iki
 * tərəf dəyişməlidir, yoxsa lokal rejim ilə canlı rejim fərqli nərdivan göstərər.
 * `discount_percent` burada 0-dır: sahə saxlanılır, amma **kassada hələ tətbiq
 * olunmur** (satış endirimi `customer.discount_percent`-dən gəlir) — yığılma
 * qaydası P1.6-dır.
 * ------------------------------------------------------------------ */

export interface LoyaltyTier {
  key: string;
  label: { az: string; ru: string; en: string };
  threshold: number;
  color: string;
  multiplier: number;
  discount_percent?: number;
}

export const DEFAULT_LOYALTY_TIERS: readonly LoyaltyTier[] = [
  { key: 'bronze', label: { az: 'Bürünc', ru: 'Бронза', en: 'Bronze' }, threshold: 0, color: '#cd7f32', multiplier: 1, discount_percent: 0 },
  { key: 'silver', label: { az: 'Gümüş', ru: 'Серебро', en: 'Silver' }, threshold: 100, color: '#c0c0c0', multiplier: 1, discount_percent: 0 },
  { key: 'gold', label: { az: 'Qızıl', ru: 'Золото', en: 'Gold' }, threshold: 300, color: '#d8b156', multiplier: 1.5, discount_percent: 0 },
];

/** Nərdivanın maksimum sətir sayı — `operations.py::_norm_customer_app_tiers` ilə eynidir. */
export const MAX_LOYALTY_TIERS = 12;

/** Tier tapılmayanda işlənən rəng/ad — HomeTab və ProfileTab eyni dəyəri işlətməlidir. */
export const FALLBACK_TIER_COLOR = DEFAULT_LOYALTY_TIERS[0].color;

/**
 * Tier tapılmayanda göstərilən ad — ən aşağı default pillənin adı.
 *
 * Əvvəl HomeTab `'Member'`, ProfileTab isə `'Golden Member'` yazırdı: eyni müştəri
 * iki ekranda iki fərqli ad görürdü və `'Golden'` bir tenant-ın pillə adıdır.
 */
export const fallbackTierLabel = (lang: string): string => {
  const label = DEFAULT_LOYALTY_TIERS[0].label as Record<string, string>;
  return label[lang] || label.en;
};

/** Dərin kopya — `label` obyekti paylaşılsa çağıran tərəf modul defaultunu dəyişə bilər. */
export const cloneDefaultLoyaltyTiers = (): LoyaltyTier[] =>
  DEFAULT_LOYALTY_TIERS.map((t) => ({ ...t, label: { ...t.label } }));

/* ------------------------------------------------------------------ *
 * P1.3 — hədiyyə kataloqu (backend güzgüsü)
 *
 * Backend güzgüsü: `operations.py::_norm_customer_app_rewards` + `_reward_catalog`.
 * Niyə `lib/loyalty.ts`-də, `api/settings.ts`-də deyil: kataloqu HƏM panel
 * (`settings.ts` vasitəsilə), HƏM də customer app-ın lokal sessiyası (`crm.ts`)
 * normalizə edir, `crm.ts` isə `settings.ts`-i import edə bilməz (tək-fayl
 * customer bundle-ı `db_sim` + `client` + finance kodunu dartardı).
 *
 * Nərdivandan (`tiers`) İKİ fərq — hər ikisi qəsdən:
 *   1. **Boş massiv defaultla əvəz olunmur** → `[]` qaytarır ("kataloq yoxdur",
 *      köhnə tək hədiyyə işləyir). `normCustomerAppTiers` isə defaulta qaytarır.
 *   2. **Təkrar `id` səssizcə atılır** (ilk sətir qalır), çünki claim `id` ilə
 *      tapılır — iki sətir eyni id ilə qalsa müştəri 5 xallıq hədiyyəyə basıb
 *      50 xal ödəyə bilər. Nərdivanda təkrar açar yalnız görüntü problemidir.
 * ------------------------------------------------------------------ */

export interface LoyaltyReward {
  id: string;
  title: { az: string; ru: string; en: string };
  description: { az: string; ru: string; en: string };
  points_cost: number;
  menu_item_id: string;
  active: boolean;
  stock_limit: number;
}

/** `operations.py::MAX_CUSTOMER_APP_REWARDS` güzgüsü. */
export const MAX_LOYALTY_REWARDS = 20;
/** `operations.py::MAX_REWARD_POINTS_COST` güzgüsü. */
export const MAX_REWARD_POINTS_COST = 1_000_000;
/** `operations.py::MAX_REWARD_STOCK_LIMIT` güzgüsü. */
export const MAX_REWARD_STOCK_LIMIT = 1_000_000;

/**
 * Kataloq boş olanda müştəri tətbiqinə göndərilən sintetik sətrin id-si.
 * `operations.py::LEGACY_REWARD_ID` ilə eynidir — dəyişsə köhnə tətbiqin
 * göndərdiyi claim tanınmaz.
 */
export const LEGACY_REWARD_ID = 'default-reward';

/** Tier açarından fərqli: defis qəbul edilir (köhnə id `default-reward`). */
const REWARD_ID_RE = /[^a-z0-9_-]/g;

/** `operations.py::_norm_reward_id` güzgüsü. */
export const normRewardId = (value: unknown): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(REWARD_ID_RE, '')
    .slice(0, 32);

/*
 * `String(value || '')` — `?? ''` YOX. Python `str(value or "")` yazır, yəni `0`
 * və `false` boş sayılır və fallback-a düşür (bax: `settings.ts::normText`
 * üzərindəki P1.2d şərhi). Hədiyyə adı ixtiyari JSON-dan gəlir, ona görə rəqəm
 * ad real haldır.
 */
const rewardText = (value: unknown, fallback: string, limit: number): string => {
  const candidate = String(value || '').trim();
  return candidate ? candidate.slice(0, limit) : fallback;
};

/** `operations.py::_norm_i18n_text` güzgüsü: ru/en boşdursa az-a düşür. */
export const normRewardI18n = (
  value: unknown,
  fallback: string,
  limit: number,
): { az: string; ru: string; en: string } => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const src = value as Record<string, unknown>;
    const az = rewardText(src.az, fallback, limit);
    return { az, ru: rewardText(src.ru, az, limit), en: rewardText(src.en, az, limit) };
  }
  const single = rewardText(value, fallback, limit);
  return { az: single, ru: single, en: single };
};

/*
 * `_norm_int(value, fallback, minimum, maximum)` güzgüsü — `settings.ts::normNum`
 * `integer=true` halının eynisi, amma bu fayl dependency-siz qalmalıdır (crm.ts
 * onu import edir), ona görə burada təkrarlanır. `Math.trunc` = Python `int()`:
 * `150.7 → 150`, `Math.round` isə 151 verib iki rejimi ayırardı.
 */
const rewardInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed =
    value === '' || value === null || value === undefined || typeof value === 'boolean' ? NaN : Number(value);
  let next = Number.isFinite(parsed) ? parsed : fallback;
  if (next < min) next = min > 0 ? Math.max(min, fallback) : min;
  return Math.trunc(Math.min(next, max));
};

/**
 * Hədiyyə kataloqunu normalizə edir — `operations.py::_norm_customer_app_rewards`.
 *
 * Qaydalar (backend ilə eyni sıra): 20 **təmizlənmiş** sətir kəsimi → obyekt
 * olmayan sətir atılır → `id` slug (boş / təkrar → atılır) → ad az → ru/en
 * fallback → `points_cost` 1..1 000 000 (**0 və mənfi default 10-a düşür, 1-ə
 * DEYİL** — `normalizeRewardThreshold` ilə eyni səbəb: 1 xallıq hədiyyə səhvən
 * qoyulsa hər şey pulsuz olardı) → `active` açarı yoxdursa `true` → sonda
 * **qiymət üzrə sıralama** (ucuzdan bahaya).
 *
 * Kəsim `slice(0, 20)`-dən fərqlidir: backend `len(cleaned) >= MAX` yoxlayır,
 * yəni atılan (xarab/təkrar) sətirlər limitə sayılmır — girişdə 25 sətir olub
 * 6-sı təkrar olsa hər iki tərəf 19 sətir qaytarır.
 */
export const normCustomerAppRewards = (value: unknown): LoyaltyReward[] => {
  const rows = Array.isArray(value) ? value : null;
  if (!rows || rows.length === 0) return [];
  const cleaned: LoyaltyReward[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (cleaned.length >= MAX_LOYALTY_REWARDS) break;
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const src = row as Record<string, unknown>;
    const id = normRewardId(src.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    cleaned.push({
      id,
      // Ad boş qala bilməz (fallback id), açıqlama qala bilər (fallback '').
      title: normRewardI18n(src.title, id, 60),
      description: normRewardI18n(src.description, '', 240),
      points_cost: rewardInt(src.points_cost, DEFAULT_REWARD_THRESHOLD, 1, MAX_REWARD_POINTS_COST),
      menu_item_id: String(src.menu_item_id || '').trim().slice(0, 64),
      // `'active' in src` — Python `row.get("active", True)` güzgüsü: açar yoxdursa
      // aktiv, `null` isə AÇIQ şəkildə deaktivdir (`bool(None) === false`).
      active: 'active' in src ? Boolean(src.active) : true,
      stock_limit: rewardInt(src.stock_limit, 0, 0, MAX_REWARD_STOCK_LIMIT),
    });
  }
  cleaned.sort((a, b) => a.points_cost - b.points_cost);
  return cleaned;
};

/**
 * Effektiv kataloq — **oxu yolunun tək mənbəyi** (`operations.py::_reward_catalog`).
 *
 * Kataloq boşdursa köhnə tək hədiyyə bir sətir kimi qaytarılır (`LEGACY_REWARD_ID`),
 * beləliklə müştəri tətbiqi və claim yolu hər iki halda eyni strukturu oxuyur.
 * Köhnə sətrin qiyməti `reward_threshold`-dur, ona görə həddi **1..1000**-dədir
 * (kataloq sətirlərinin həddi isə 1 000 000) — `normalizeRewardThreshold` ilə eyni.
 */
export const resolveRewardCatalog = (settings: AccrualSettings): LoyaltyReward[] => {
  const cfg = (settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>;
  const rows = normCustomerAppRewards(cfg.rewards);
  if (rows.length) return rows;
  const name = rewardText(cfg.reward_name, 'Reward', 60);
  const desc = rewardText(cfg.reward_description, '10 ulduza 1 pulsuz içki', 240);
  return [
    {
      id: LEGACY_REWARD_ID,
      title: { az: name, ru: name, en: name },
      description: { az: desc, ru: desc, en: desc },
      points_cost: normalizeRewardThreshold(cfg.reward_threshold),
      menu_item_id: '',
      active: true,
      stock_limit: 0,
    },
  ];
};

/**
 * Kataloq → müştəri tətbiqinin oxuduğu sətirlər (`_reward_catalog_payload` güzgüsü).
 *
 * `spendable` PENDING claim-lərin `points_cost` cəmi çıxılmış balansdır, ona görə
 * `spendable // points_cost` köhnə `stars // threshold - pending_count` düsturunun
 * ümumiləşdirilmiş halıdır (bütün sətirlər eyni qiymətdə olanda ikisi eynidir).
 */
export interface RewardWalletRow {
  id: string;
  title: string;
  description: string;
  title_i18n: { az: string; ru: string; en: string };
  description_i18n: { az: string; ru: string; en: string };
  /** Köhnə ad — `points_cost` ilə eyni dəyər. */
  threshold: number;
  points_cost: number;
  menu_item_id: string;
  menu_item_name: string;
  stock_limit: number;
  /** `null` = limitsiz. */
  stock_remaining: number | null;
  available_count: number;
  locked: boolean;
}

export const buildRewardWalletRows = (
  rows: readonly LoyaltyReward[],
  opts: {
    spendable: number;
    stockUsed?: Record<string, number>;
    menuNames?: Record<string, string>;
    lang?: string;
  },
): RewardWalletRow[] => {
  const used = opts.stockUsed || {};
  const names = opts.menuNames || {};
  const lang = opts.lang || 'az';
  const spendable = Math.max(0, Math.trunc(Number(opts.spendable) || 0));
  const out: RewardWalletRow[] = [];
  for (const row of rows) {
    if (!row || row.active === false) continue;
    const cost = Math.max(1, Math.trunc(Number(row.points_cost) || 1));
    const byPoints = Math.floor(spendable / cost);
    const limit = Math.max(0, Math.trunc(Number(row.stock_limit) || 0));
    const remaining = limit > 0 ? Math.max(0, limit - (Number(used[row.id]) || 0)) : null;
    const count = remaining === null ? byPoints : Math.min(byPoints, remaining);
    const title = row.title || { az: '', ru: '', en: '' };
    const desc = row.description || { az: '', ru: '', en: '' };
    const pick = (obj: Record<string, unknown>) => String(obj[lang] || obj.az || '');
    out.push({
      id: String(row.id || ''),
      title: pick(title as any),
      description: pick(desc as any),
      title_i18n: { az: String(title.az || ''), ru: String(title.ru || ''), en: String(title.en || '') },
      description_i18n: { az: String(desc.az || ''), ru: String(desc.ru || ''), en: String(desc.en || '') },
      threshold: cost,
      points_cost: cost,
      menu_item_id: String(row.menu_item_id || ''),
      menu_item_name: row.menu_item_id ? String(names[row.menu_item_id] || '') : '',
      stock_limit: limit,
      stock_remaining: remaining,
      available_count: count,
      locked: count <= 0,
    });
  }
  return out;
};

/* ------------------------------------------------------------------ *
 * P1.1 — qazanma mühərriki (backend güzgüsü)
 *
 * Bu blok `backend/app/services/loyalty_accrual.py`-in birə-bir güzgüsüdür.
 * İkisi ayrılsa lokal rejim ilə canlı rejim fərqli sayar, ona görə hesablama
 * sırası və yuvarlaqlaşdırma qaydası eyni saxlanmalıdır:
 *
 *   minimum → baza (içki sayı | AZN × dərəcə) → 2x gün → tier çarpanı →
 *   ilk alış bonusu (çoxaldılmır) → MAX_EARN_PER_SALE ilə kəsilir
 *
 * **Float tələsi:** Python tərəf `Decimal` işlədir. `0.3 * 10` JS-də
 * 2.9999999999999996 verir və `floor` 2-yə düşür, Decimal isə 3 verir. Ona görə
 * bütün vurmalar tam ədəd miqyasında aparılır (məbləğ → qəpik, dərəcə/çarpan →
 * 4 onluq rəqəmə qədər tam ədəd). Ayar normalizeri onsuz da 4 onluğa
 * yuvarlaqlaşdırır (`_norm_float` / `normNum`), ona görə miqyas kifayətdir.
 * ------------------------------------------------------------------ */

export type EarnBasis = 'per_drink' | 'per_azn';

export const DEFAULT_EARN_BASIS: EarnBasis = 'per_drink';
export const EARN_BASIS_CHOICES: readonly EarnBasis[] = ['per_drink', 'per_azn'];

/** Bir satışda maksimum ulduz — səhv ayarın balansı partlatmasının qarşısını alır. */
export const MAX_EARN_PER_SALE = 10000;

/**
 * Tier çarpanının yuxarı həddi.
 *
 * Backend güzgüsü: `loyalty_accrual.py::MAX_TIER_MULTIPLIER`. Hədd üç yerdə
 * lazımdır — accrual (`computePointsEarned`), ayar normalizeri
 * (`settings.ts::normCustomerAppTiers`) və customer app-ın tier oxuması
 * (`crm.ts::computeTier`) — və üçü fərqlənsə tətbiq "×25" göstərib kassa ×10
 * sayar.
 */
export const MAX_TIER_MULTIPLIER = 10;

const SCALE = 10000;

/** Sonlu ədəd və ya rəqəmli sətir → number; bool qəsdən rədd edilir. */
const toNumber = (raw: unknown, fallback = 0): number => {
  if (raw === null || raw === undefined || typeof raw === 'boolean') return fallback;
  if (typeof raw === 'string' && !raw.trim()) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Dəyəri 4 onluq rəqəmli tam ədədə çevirir (Python `Decimal(str(x))` ekvivalenti). */
const scale4 = (value: number): number => Math.round(value * SCALE);

const isFlagOn = (raw: unknown): boolean => {
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase();
    return v !== '' && v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
  }
  return Boolean(raw);
};

/** Ayar blobunun bizə lazım olan hissəsi — hamısı optional, hamısı "hər cür dəyər". */
type AccrualSettings = Record<string, unknown> | null | undefined;

export const resolveEarnBasis = (settings: AccrualSettings): EarnBasis => {
  const raw = String((settings as any)?.earn_basis ?? '').trim().toLowerCase();
  return (EARN_BASIS_CHOICES as readonly string[]).includes(raw) ? (raw as EarnBasis) : DEFAULT_EARN_BASIS;
};

/**
 * 2x günlər — **B.E=1 … Bazar=7**.
 *
 * Köhnə `0` dəyəri 7-yə çevrilir: lokal `HappyHour` tipindəki "0=Sunday" şərhi
 * yanlışdır (P0.7) və `0..6` filtri Bazarı səssizcə atırdı.
 */
export const normalizeDoublePointsDays = (raw: unknown): number[] => {
  if (!Array.isArray(raw)) return [];
  const days = new Set<number>();
  for (const item of raw) {
    if (typeof item === 'boolean') continue;
    const parsed = Number(item);
    if (!Number.isFinite(parsed)) continue;
    let day = Math.trunc(parsed);
    if (day === 0) day = 7;
    if (day >= 1 && day <= 7) days.add(day);
  }
  return Array.from(days).sort((a, b) => a - b);
};

/**
 * `tiers` nərdivanında `lifetimeStars`-a uyğun pillənin xam `multiplier`-i.
 *
 * Backend güzgüsü: `loyalty_accrual.py::find_tier_multiplier` (o da
 * `operations.py::_compute_tier` qaydasının eynidir): sıralanmış pillələrdə
 * `lifetimeStars`-dan böyük olmayan sonuncu pillə, heç biri uyğun gəlməsə ən
 * aşağı pillə. Keçidi (`tier_multiplier_enabled`) yoxlamır — onu
 * `computePointsEarned` yoxlayır.
 */
export const findTierMultiplier = (settings: AccrualSettings, lifetimeStars: unknown): number => {
  const raw = (settings as any)?.tiers;
  if (!Array.isArray(raw)) return 1;
  const rows = raw.filter((r: any) => r && typeof r === 'object' && String(r.key ?? '').trim());
  if (!rows.length) return 1;
  const threshold = (r: any): number => Math.max(0, Math.trunc(toNumber(r?.threshold, 0)));
  const stars = Math.max(0, Math.trunc(toNumber(lifetimeStars, 0)));
  const ordered = [...rows].sort((a: any, b: any) => threshold(a) - threshold(b));
  let current = ordered[0];
  for (const row of ordered) {
    if (stars >= threshold(row)) current = row;
    else break;
  }
  return toNumber((current as any)?.multiplier, 1);
};

export interface AccrualBreakdown {
  earned: number;
  base: number;
  doubleDayApplied: boolean;
  tierBonus: number;
  firstPurchaseBonus: number;
  blockedByMinimum: boolean;
  capped: boolean;
  basis: EarnBasis;
}

export interface AccrualContext {
  /** "Qəhvəyəbənzər" içki sayı — `per_drink` bazasının girişi. */
  drinkQty?: number;
  /** Endirimlərdən sonra, pulsuz içki güzəştindən **əvvəl** olan çek məbləği. */
  eligibleTotal?: unknown;
  /** B.E=1 … Bazar=7. `undefined` = 2x gün yoxlanmır. */
  weekday?: number | null;
  isFirstPurchase?: boolean;
  /** Müştərinin tier sətrindəki `multiplier`. */
  tierMultiplier?: unknown;
}

/**
 * Bu satışda qazanılan ulduz sayı.
 *
 * Backend güzgüsü: `app/services/loyalty_accrual.py::compute_points_earned`.
 * Heç bir halda exception atmır — satış axını bir ayar sətrinə görə dayanmamalıdır.
 */
export const computePointsEarned = (settings: AccrualSettings, ctx: AccrualContext = {}): AccrualBreakdown => {
  const cfg = (settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>;
  const basis = resolveEarnBasis(cfg);
  const empty: AccrualBreakdown = {
    earned: 0,
    base: 0,
    doubleDayApplied: false,
    tierBonus: 0,
    firstPurchaseBonus: 0,
    blockedByMinimum: false,
    capped: false,
    basis,
  };

  // Məbləğ qəpiyə çevrilir ki, Python `Decimal` tərəfi ilə eyni nəticə çıxsın.
  const totalCents = Math.max(0, Math.round(toNumber(ctx.eligibleTotal, 0) * 100));
  const minimumCents = Math.max(0, Math.round(Math.min(toNumber(cfg.min_purchase_for_earn, 0), 100000) * 100));
  if (minimumCents > 0 && totalCents < minimumCents) {
    return { ...empty, blockedByMinimum: true };
  }

  let base: number;
  if (basis === 'per_azn') {
    const rate = Math.min(Math.max(toNumber(cfg.earn_rate_per_azn, 0), 0), 1000);
    // (qəpik × dərəcə₄) / (100 × 10⁴) — tam ədəd vurma, sonra aşağıya yuvarlaqlaşdırma.
    base = Math.floor((totalCents * scale4(rate)) / (100 * SCALE));
  } else {
    base = Math.max(0, Math.trunc(toNumber(ctx.drinkQty, 0)));
  }

  if (base <= 0) return { ...empty, base: 0 };

  let earned = base;
  const doubleDays = normalizeDoublePointsDays(cfg.double_points_days);
  const weekday = ctx.weekday === null || ctx.weekday === undefined ? null : Math.trunc(Number(ctx.weekday));
  const doubleDayApplied = weekday !== null && Number.isFinite(weekday) && doubleDays.includes(weekday);
  if (doubleDayApplied) earned *= 2;

  let tierBonus = 0;
  if (isFlagOn(cfg.tier_multiplier_enabled)) {
    const raw = toNumber(ctx.tierMultiplier, 1);
    const multiplier = Math.min(raw < 0 ? 1 : raw, MAX_TIER_MULTIPLIER);
    if (multiplier !== 1) {
      const afterTier = Math.floor((earned * scale4(multiplier)) / SCALE);
      tierBonus = afterTier - earned;
      earned = afterTier;
    }
  }

  let firstPurchaseBonus = 0;
  if (ctx.isFirstPurchase && isFlagOn(cfg.first_purchase_bonus_enabled)) {
    firstPurchaseBonus = Math.min(Math.max(Math.floor(toNumber(cfg.first_purchase_bonus, 0)), 0), 1000);
    earned += firstPurchaseBonus;
  }

  const capped = earned > MAX_EARN_PER_SALE;
  if (capped) earned = MAX_EARN_PER_SALE;

  return {
    earned: Math.max(0, earned),
    base,
    doubleDayApplied,
    tierBonus,
    firstPurchaseBonus,
    blockedByMinimum: false,
    capped,
    basis,
  };
};

/** Bugünün gün nömrəsi — B.E=1 … Bazar=7 (`getDay()` 0=Bazar verir). */
export const weekdayIso = (date: Date = new Date()): number => date.getDay() || 7;

/**
 * `AccrualBreakdown` → ledger təsviri.
 *
 * Backend güzgüsü: `AccrualBreakdown.describe()`. Mətn audit üçündür (İngilis
 * dilində, `LoyaltyLedgerEntry.description` sütunu ilə eyni format), ona görə
 * tərcümə olunmur — iki rejimin sətirləri fərqlənsə hesabat qruplaşdırması pozular.
 */
export const describeAccrual = (b: AccrualBreakdown): string => {
  if (b.blockedByMinimum) return 'Points earn skipped (below minimum purchase)';
  const parts = [b.basis === 'per_drink' ? 'per drink' : 'per AZN', `base ${b.base}`];
  if (b.doubleDayApplied) parts.push('2x day');
  if (b.tierBonus) parts.push(`tier +${b.tierBonus}`);
  if (b.firstPurchaseBonus) parts.push(`first purchase +${b.firstPurchaseBonus}`);
  if (b.capped) parts.push(`capped at ${MAX_EARN_PER_SALE}`);
  return 'Points earn (' + parts.join(', ') + ')';
};
