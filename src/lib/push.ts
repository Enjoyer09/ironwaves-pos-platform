/**
 * P1.4d — `backend/app/services/push_service.py` + `push_audience.py` güzgüsü.
 *
 * ⚠️ Bu fayl **heç nə import etmir** — `src/lib/loyalty.ts` ilə eyni qayda.
 * Səbəb: `src/api/crm.ts` müştəri tətbiqinin yeganə API modulu olduğu üçün
 * `npm run build:customer` tək-fayl bundle-a nə gətirilsə, o da telefonun
 * paketinə düşür. `settings.ts`/`pos.ts` import etsək `db_sim`, `client` və
 * `decimal.js` (maliyyə kodu ilə birlikdə) dartılardı. Asılılıqsızlıq həm də
 * Node-da paritet testinə imkan verir: modulu birbaşa import edib Python
 * nəticələri ilə tutuşdurmaq olur.
 *
 * ⚠️ **Göndərici burada YOXDUR.** `send_onesignal` güzgüsü qəsdən yazılmır:
 * OneSignal REST açarı brauzerə heç vaxt çıxmır (`push_settings` GET-də maska
 * ilə boşalır). Bura yalnız normalizasiya + seqment hesabı düşür; real göndərmə
 * `POST /api/v1/ops/push/*` üzərindən serverdə olur.
 *
 * Server **avtoritetdir**: `_live` funksiyalar serverin qaytardığı bloku yazır,
 * bu güzgü isə lokal rejim və forma ön baxışı üçündür.
 */

/** OneSignal API — yalnız arayış üçün (brauzer bu ünvana müraciət etmir). */
export const ONESIGNAL_URL = 'https://onesignal.com/api/v1/notifications';

export const PUSH_BATCH_SIZE = 1000;

/** Bir broadcast-ın maksimum alıcı sayı (`push_service.MAX_BROADCAST_RECIPIENTS`). */
export const MAX_BROADCAST_RECIPIENTS = 20000;

export const MAX_PUSH_TITLE = 80;
export const MAX_PUSH_BODY = 240;

export const DEFAULT_BROADCAST_DAILY_LIMIT = 3;
export const MAX_BROADCAST_DAILY_LIMIT = 50;

/** Maskalananda boş gedən açarlar — panel `${key}_set` bayrağına baxır. */
export const PUSH_SECRET_KEYS = ['onesignal_rest_api_key'] as const;

export const PUSH_KINDS = ['event', 'test', 'broadcast'] as const;

/**
 * Formanın maskalanmış açarı geri göndərməsi mövcud açarı silməsin: bu sentinel
 * "olduğu kimi saxla" deməkdir. Boş sətir də silmir (round-trip qoruması) —
 * silmək üçün `clear_onesignal_rest_api_key` bayrağı lazımdır.
 */
export const PUSH_SECRET_SENTINEL = '__keep__';

export const MAX_PUSH_SECRET_LENGTH = 200;

export interface PushSettings {
  enabled: boolean;
  event_push_enabled: boolean;
  broadcast_enabled: boolean;
  onesignal_rest_api_key: string;
  broadcast_daily_limit: number;
}

/** GET cavabı: sirlər maskalanır, sxem dəyişmir, `_set` bayrağı əlavə olunur. */
export interface PushSettingsResponse extends PushSettings {
  onesignal_rest_api_key_set: boolean;
}

/**
 * `push_service.DEFAULT_PUSH_SETTINGS` güzgüsü.
 *
 * `enabled` və `event_push_enabled` **açıqdır**, çünki hadisə push-ları
 * (checkout, sifariş hazır, hədiyyə kodu, ad günü) P1.4-dən əvvəl də gedirdi —
 * onları söndürülü başlatmaq mövcud tenant-larda işləyən bildirişi kəsərdi.
 * `broadcast_enabled` isə söndürülüdür: kütləvi göndərmə açıq iradə tələb edir.
 */
export const DEFAULT_PUSH_SETTINGS: PushSettings = {
  enabled: true,
  event_push_enabled: true,
  broadcast_enabled: false,
  onesignal_rest_api_key: '',
  broadcast_daily_limit: DEFAULT_BROADCAST_DAILY_LIMIT,
};

export const PUSH_SETTING_KEYS = [
  'enabled',
  'event_push_enabled',
  'broadcast_enabled',
  'onesignal_rest_api_key',
  'broadcast_daily_limit',
] as const;

/** Python `isinstance(value, Mapping)` — massiv Mapping deyil, yəni `{}` sayılır. */
const isBlob = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const asBlob = (value: unknown): Record<string, unknown> => (isBlob(value) ? { ...value } : {});

/**
 * Python `float()` yalnız onluq say sətrini qəbul edir. JS `Number()` daha
 * səxavətlidir (`Number('0x10') === 16`, `Number('') === 0`), ona görə sətir
 * əvvəlcə bu şablondan keçir — yoxsa iki rejim fərqli rəqəm göstərərdi.
 */
const DECIMAL_LIKE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/**
 * `push_service._norm_int` güzgüsü. `0` **qanuni dəyərdir** (broadcast-ı
 * bloklamaq üçün), ona görə `value || fallback` işlədilmir.
 *
 * `Math.trunc` = Python `int()`: `150.7 → 150`. `Math.round` 151 verib iki
 * rejimi ayırardı. `Number.isFinite` yoxlaması Python-un `int(float('inf'))`
 * → `OverflowError` yolunun güzgüsüdür (server tərəfdə də tutulur).
 * Massiv/obyekt üçün Python `float()` `TypeError` atır, JS `Number([])` isə `0`
 * verir — ona görə yalnız `number`/`string` parse olunur.
 */
export const pushInt = (value: unknown, fallback: number, minimum = 0, maximum?: number): number => {
  const blank =
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    (typeof value === 'string' && !value.trim());

  let parsed: number;
  if (blank) {
    parsed = Math.trunc(fallback);
  } else if (typeof value === 'number') {
    parsed = Number.isFinite(value) ? Math.trunc(value) : Math.trunc(fallback);
  } else if (typeof value === 'string' && DECIMAL_LIKE.test(value.trim())) {
    const numeric = Number(value.trim());
    parsed = Number.isFinite(numeric) ? Math.trunc(numeric) : Math.trunc(fallback);
  } else {
    parsed = Math.trunc(fallback);
  }

  if (parsed < minimum) parsed = minimum;
  return maximum === undefined ? parsed : Math.min(parsed, maximum);
};

/** Python `str(value or '').strip()[:limit]` güzgüsü (`?? ''` YOX — bax loyalty.ts).
 *
 * ⚠️ Bilinən fərq: massiv/obyekt üçün Python `str([1, 2])` → `"[1, 2]"`, JS
 * `String([1, 2])` → `"1,2"` verir. Bu sahələr (REST açarı, seqment dəyəri) yalnız
 * formadan — yəni sətir kimi — gəlir; xarab blobda hər iki tərəf onsuz da zibil
 * saxlayır, ona görə fərq qəsdən düzəldilmir.
 */
const pushText = (value: unknown, limit: number): string => String(value || '').trim().slice(0, limit);

/**
 * Python `bool(...)` güzgüsü. JS-də `Boolean([])` və `Boolean({})` **true**-dur,
 * Python-da isə boş konteyner **False**. Bu bayraqlar push-un ümumi açarıdır
 * (`enabled`, `event_push_enabled`), yəni xarab blobda iki rejim əks qərar verə
 * bilərdi — biri göndərər, biri susardı.
 */
const pyBool = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.length > 0;
  if (isBlob(value)) return Object.keys(value).length > 0;
  return Boolean(value);
};

/** Python `bool(raw.get(key, default))`: açar varsa dəyərə baxılır, yoxsa default. */
const pushFlag = (raw: Record<string, unknown>, key: string, fallback: boolean): boolean =>
  Object.prototype.hasOwnProperty.call(raw, key) ? pyBool(raw[key]) : fallback;

/**
 * `push_service.normalize_push_settings` güzgüsü. **Heç vaxt atmır.**
 *
 * `current` verilibsə REST açarı üçün sentinel işləyir: gələn dəyər
 * `__keep__`-dirsə köhnə açar saxlanılır.
 */
export function normalizePushSettings(
  value: unknown,
  options: { current?: unknown } = {},
): PushSettings {
  const raw = asBlob(value);
  const prev = asBlob(options.current);
  const d = DEFAULT_PUSH_SETTINGS;

  const incomingKey = raw.onesignal_rest_api_key;
  const restKey =
    String(incomingKey || '').trim() === PUSH_SECRET_SENTINEL
      ? pushText(prev.onesignal_rest_api_key, MAX_PUSH_SECRET_LENGTH)
      : pushText(incomingKey, MAX_PUSH_SECRET_LENGTH);

  return {
    enabled: pushFlag(raw, 'enabled', d.enabled),
    event_push_enabled: pushFlag(raw, 'event_push_enabled', d.event_push_enabled),
    broadcast_enabled: pushFlag(raw, 'broadcast_enabled', d.broadcast_enabled),
    onesignal_rest_api_key: restKey,
    broadcast_daily_limit: pushInt(
      raw.broadcast_daily_limit,
      d.broadcast_daily_limit,
      0,
      MAX_BROADCAST_DAILY_LIMIT,
    ),
  };
}

/**
 * `push_service.push_settings_response` güzgüsü.
 *
 * Cavabın **şəkli roldan asılı deyil**: hər iki halda `_set` bayrağı var, ona
 * görə panel açarın mövcudluğunu göstərə bilir (yoxsa manager "konfiqurasiya
 * yoxdur" deyə səhv diaqnoz qoyar) və frontend iki sxem saxlamır.
 */
export function pushSettingsResponse(value: unknown, options: { reveal?: boolean } = {}): PushSettingsResponse {
  const normalized = normalizePushSettings(value);
  const out: PushSettingsResponse = {
    ...normalized,
    onesignal_rest_api_key_set: !!normalized.onesignal_rest_api_key.trim(),
  };
  if (!options.reveal) out.onesignal_rest_api_key = '';
  return out;
}

/**
 * `push_service.sanitize_push_text` güzgüsü — başlıq/mətn kəsilir və bir sətrə
 * yığılır. OneSignal uzun mətni özü kəsir, amma kəsim **cihazdan asılı** olur;
 * burada kəsmək panelin ön baxışını real bildirişlə uyğunlaşdırır.
 */
export function sanitizePushText(title: unknown, body: unknown): { title: string; body: string } {
  const squash = (value: unknown, limit: number) =>
    String(value || '')
      .trim()
      .split(/\s+/)
      .join(' ')
      .slice(0, limit);
  return { title: squash(title, MAX_PUSH_TITLE), body: squash(body, MAX_PUSH_BODY) };
}

/** `push_service.mask_token` — tam abunəlik id-si nə loga, nə ekrana yazılmır. */
export function maskToken(token: unknown): string {
  const raw = String(token || '').trim();
  if (!raw) return '';
  return raw.length <= 8 ? '***' : `${raw.slice(0, 4)}…${raw.slice(-4)}`;
}

/**
 * `push_service.dedupe_tokens` — boşları atır, təkrarı silir, sıranı saxlayır.
 *
 * Təkrar real haldır: müştəri həm brauzerdən, həm tətbiqdən qeydiyyatdan
 * keçəndə seqment sorğusu birləşmiş sətirlər qaytara bilir — təkrar göndərmə isə
 * istifadəçiyə iki bildiriş deməkdir.
 */
export function dedupeTokens(tokens: unknown[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tokens || []) {
    const value = String(raw || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function chunkTokens(tokens: string[], size: number = PUSH_BATCH_SIZE): string[][] {
  const step = Math.max(1, Math.trunc(Number(size) || PUSH_BATCH_SIZE));
  const out: string[][] = [];
  for (let i = 0; i < tokens.length; i += step) out.push(tokens.slice(i, i + step));
  return out;
}

/**
 * `push_service.is_onesignal_subscription_id` güzgüsü.
 *
 * Niyə lazımdır: `Customer.push_token` **iki fərqli** şey saxlayır. Brauzer
 * SDK-sı OneSignal abunəlik id-si (UUID) yazır, native tətbiq isə
 * `@capacitor/push-notifications` ilə APNs/FCM **cihaz tokeni** (64+ simvol)
 * yazır. OneSignal `include_subscription_ids` ikinci formanı qəbul etmir — yəni
 * belə tokenlər çatdırıla bilməz.
 *
 * Bu funksiya **heç nə silmir**; panel dürüst say göstərsin deyə təsnifat verir.
 */
export function isOneSignalSubscriptionId(token: unknown): boolean {
  const raw = String(token || '').trim();
  if (raw.length !== 36) return false;
  const parts = raw.split('-');
  if (parts.length !== 5) return false;
  const lengths = parts.map((part) => part.length).join(',');
  if (lengths !== '8,4,4,4,12') return false;
  return /^[0-9a-f]+$/i.test(raw.replace(/-/g, ''));
}

/** (çatdırıla bilən abunəliklər, çatdırıla bilməyən cihaz tokenləri). */
export function splitDeliverableTokens(tokens: unknown[] | null | undefined): {
  deliverable: string[];
  undeliverable: string[];
} {
  const deliverable: string[] = [];
  const undeliverable: string[] = [];
  for (const token of dedupeTokens(tokens)) {
    if (isOneSignalSubscriptionId(token)) deliverable.push(token);
    else undeliverable.push(token);
  }
  return { deliverable, undeliverable };
}

/* ==========================================================================
 * Seqment (audience) — `backend/app/services/push_audience.py` güzgüsü.
 *
 * Süzgəc burada **tam** təkrarlanır (yalnız spec normalizeri deyil), çünki lokal
 * rejimdə ön baxış real rəqəm göstərməlidir və klientdə də ön baxış ilə göndərmə
 * **eyni** funksiyadan keçməlidir — P0.4 dürüstlük qaydası.
 * ========================================================================== */

export const AUDIENCE_SEGMENTS = ['all', 'new', 'dormant', 'tier', 'has_balance'] as const;
export type PushAudienceSegment = (typeof AUDIENCE_SEGMENTS)[number];

/** "Yeni müştəri" pəncərəsi (gün). */
export const DEFAULT_NEW_DAYS = 30;
/** "Yatmış müştəri" pəncərəsi (gün). */
export const DEFAULT_DORMANT_DAYS = 60;
export const MAX_AUDIENCE_DAYS = 3650;

/** `has_balance` üçün minimum balans. `0` mənasızdır (hamı keçər) → aşağı hədd 1. */
export const DEFAULT_MIN_STARS = 1;
export const MAX_MIN_STARS = 1000000;

export const SEGMENT_LABELS: Record<string, string> = {
  all: 'Bütün abunəçilər',
  new: 'Yeni müştərilər',
  dormant: 'Yatmış müştərilər',
  tier: 'Səviyyə',
  has_balance: 'Balansı olanlar',
};

export interface PushAudienceSpec {
  segment: PushAudienceSegment;
  value: string;
  days: number;
  min_stars: number;
}

/** Seqment üçün müştəri sətri — hamısı optional, tipi səhv olsa da atmır. */
export interface PushAudienceRow {
  card_id?: string | null;
  push_token?: string | null;
  created_at?: string | Date | null;
  last_sale_at?: string | Date | null;
  stars?: unknown;
  lifetime_stars?: unknown;
}

export interface PushTierRow {
  key?: unknown;
  label?: unknown;
  threshold?: unknown;
}

/**
 * Seqmentin **dürüst** nəticəsi (`push_audience.PushAudience`).
 *
 * `matched` seqmentə uyğun müştəri sayıdır (token olsun-olmasın), `tokens` isə
 * yalnız real göndərilə bilənlər. Panel hər iki rəqəmi göstərir: "412 uyğun
 * müştəri, 128-i bildirişə abunədir" — tək rəqəm 412 nəfərə çatacağı illüziyasını
 * verərdi.
 */
export interface PushAudienceResult {
  tokens: string[];
  recipients: number;
  matched: number;
  with_token: number;
  undeliverable: number;
  capped: boolean;
  total: number;
  label: string;
  note: string;
}

/** `PushAudience.as_dict()` — **token siyahısı YOX** (paneldə lazım deyil). */
export type PushAudienceSummary = Omit<PushAudienceResult, 'tokens'>;

export function pushAudienceSummary(audience: PushAudienceResult): PushAudienceSummary {
  const { tokens: _tokens, ...summary } = audience;
  return summary;
}

/**
 * `push_audience.normalize_audience_spec` güzgüsü. Heç vaxt atmır.
 *
 * `days` seqmentdən asılı defaultla doldurulur (`new` → 30, qalanları → 60),
 * çünki panel sahəni boş göndərə bilər və "0 gün" heç bir seqment üçün mənalı
 * deyil (hamısını və ya heç kimi seçərdi).
 */
export function normalizeAudienceSpec(value: unknown): PushAudienceSpec {
  const raw = asBlob(value);
  let segment = String(raw.segment || 'all').trim().toLowerCase();
  if (!(AUDIENCE_SEGMENTS as readonly string[]).includes(segment)) segment = 'all';
  const defaultDays = segment === 'new' ? DEFAULT_NEW_DAYS : DEFAULT_DORMANT_DAYS;
  return {
    segment: segment as PushAudienceSegment,
    value: pushText(raw.value, 32),
    days: pushInt(raw.days, defaultDays, 1, MAX_AUDIENCE_DAYS),
    min_stars: pushInt(raw.min_stars, DEFAULT_MIN_STARS, 1, MAX_MIN_STARS),
  };
}

/**
 * `push_audience._as_naive_utc` güzgüsü — epoch millisaniyə qaytarır.
 *
 * Backend sütunları naive UTC-dir (`default=datetime.utcnow`) və Python onları
 * `utcnow()` ilə tutuşdurur. JS-də isə saat qurşağı olmayan ISO sətri **lokal**
 * vaxt kimi oxunur (spesifikasiya belədir), yəni Bakıda 4 saat fərq yaranardı və
 * "son 7 gün" seqmenti sərhəddə fərqli müştəri tutardı. Ona görə qurşaq
 * göstərilməyibsə sətrə `Z` əlavə olunur — Python-un naive dəyəri UTC kimi
 * müqayisə etməsinin eynisi.
 */
const parseNaiveUtcMs = (value: unknown): number | null => {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value !== 'string') return null;  // Python: `datetime`/`str` deyilsə `None` (say da daxil).
  const trimmed = value.trim();
  if (!trimmed) return null;
  const raw = trimmed.replace(' ', 'T');
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const ms = Date.parse(hasOffset || dateOnly ? raw : `${raw}Z`);
  return Number.isFinite(ms) ? ms : null;
};

const tierThreshold = (row: unknown): number =>
  pushInt(isBlob(row) ? row.threshold : null, 0, 0, 1000000);

/**
 * Müştərinin cari pilləsi — `operations._compute_tier` / `push_audience`
 * qaydasının eynisi: sətirlər həddə görə sıralanır, `lifetime_stars >= threshold`
 * olan **sonuncu** pillə seçilir, mənfi ulduz 0 sayılır.
 */
export function currentTierKey(lifetimeStars: unknown, tiers: PushTierRow[] | null | undefined): string {
  const rows = (tiers || []).filter((row) => isBlob(row) && !!String(row.key || '').trim());
  if (!rows.length) return '';
  const sorted = [...rows].sort((a, b) => tierThreshold(a) - tierThreshold(b));
  const stars = pushInt(lifetimeStars, 0, 0);
  let current = sorted[0];
  for (const row of sorted) {
    if (stars >= tierThreshold(row)) current = row;
    else break;
  }
  return String(current.key || '').trim().toLowerCase();
}

/** Panelə və `push_deliveries.segment_value`-a yazılan insan-oxunaqlı ad. */
export function audienceLabel(spec: unknown, tiers?: PushTierRow[] | null): string {
  const normalized = normalizeAudienceSpec(spec);
  const segment = normalized.segment;
  const base = SEGMENT_LABELS[segment] || segment;
  if (segment === 'new') return `${base} (son ${normalized.days} gün)`;
  if (segment === 'dormant') return `${base} (${normalized.days} gündən çox aktivlik yoxdur)`;
  if (segment === 'has_balance') return `${base} (≥ ${normalized.min_stars})`;
  if (segment === 'tier') {
    const key = normalized.value.toLowerCase();
    for (const row of tiers || []) {
      if (!isBlob(row) || String(row.key || '').trim().toLowerCase() !== key) continue;
      const label = row.label;
      const name = isBlob(label)
        ? String(label.az || label.en || key).trim()
        : String(label || key).trim();
      return `${base}: ${name || key}`;
    }
    return `${base}: ${key || '—'}`;
  }
  return base;
}

const matchesSegment = (
  row: Record<string, unknown>,
  spec: PushAudienceSpec,
  nowMs: number,
  tiers: PushTierRow[] | null | undefined,
): boolean => {
  const dayMs = 86400000;
  if (spec.segment === 'all') return true;

  if (spec.segment === 'new') {
    const created = parseNaiveUtcMs(row.created_at);
    if (created === null) return false;
    return created >= nowMs - spec.days * dayMs;
  }

  if (spec.segment === 'dormant') {
    const cutoff = nowMs - spec.days * dayMs;
    const lastSale = parseNaiveUtcMs(row.last_sale_at);
    if (lastSale !== null) return lastSale <= cutoff;
    // Heç vaxt alış etməyib: qeydiyyat tarixi baza kimi işlənir, yoxsa dünən
    // qeydiyyatdan keçən müştəri dərhal "yatmış" sayılıb spam alardı.
    const created = parseNaiveUtcMs(row.created_at);
    return created !== null && created <= cutoff;
  }

  if (spec.segment === 'tier') {
    const wanted = String(spec.value || '').trim().toLowerCase();
    if (!wanted) return false;
    return currentTierKey(row.lifetime_stars, tiers) === wanted;
  }

  if (spec.segment === 'has_balance') return pushInt(row.stars, 0, 0) >= spec.min_stars;

  return false;
};

/**
 * `push_audience.resolve_push_audience` güzgüsü — seqmenti tətbiq edir və
 * göndəriləcək token siyahısını qaytarır. **Heç vaxt atmır**: xarab sətir sadəcə
 * uyğunsuz sayılır.
 *
 * Süzgəc sırası **qəsdən** belədir: seqment → token varlığı → çatdırıla bilmə →
 * təkrarların silinməsi → hədd. Beləliklə panel hər pillədə itkini görür
 * ("412 uyğun, 128-i abunə, 9-u native cihaz tokeni").
 */
export function resolvePushAudience(
  rows: PushAudienceRow[] | null | undefined,
  spec?: unknown,
  options: { now?: unknown; tiers?: PushTierRow[] | null; limit?: number } = {},
): PushAudienceResult {
  const normalized = normalizeAudienceSpec(spec);
  // `now` çağıranın parametridir (test/ön baxış), ona görə epoch say da qəbul
  // olunur; sətir sahələri isə Python-un qatı qaydasından keçir.
  const nowMs =
    typeof options.now === 'number' && Number.isFinite(options.now)
      ? options.now
      : parseNaiveUtcMs(options.now) ?? Date.now();
  const requested = Math.max(0, Math.trunc(Number(options.limit) || 0));
  const cap = requested || MAX_BROADCAST_RECIPIENTS;

  let total = 0;
  let matched = 0;
  const tokens: string[] = [];
  for (const row of rows || []) {
    total += 1;
    if (!isBlob(row)) continue;
    let hit = false;
    try {
      hit = matchesSegment(row, normalized, nowMs, options.tiers);
    } catch {
      hit = false;
    }
    if (!hit) continue;
    matched += 1;
    const token = String(row.push_token || '').trim();
    if (token) tokens.push(token);
  }

  const { deliverable, undeliverable } = splitDeliverableTokens(tokens);
  const capped = deliverable.length > cap;
  const notes: string[] = [];
  if (undeliverable.length) {
    notes.push(
      `${undeliverable.length} token OneSignal abunəliyi deyil (mobil tətbiqin cihaz tokeni) — ` +
        'onlara çatdırılma mümkün deyil.',
    );
  }
  if (capped) notes.push(`Alıcı sayı ${cap} həddinə qədər kəsildi.`);

  const picked = deliverable.slice(0, cap);
  return {
    tokens: picked,
    recipients: picked.length,
    matched,
    with_token: deliverable.length + undeliverable.length,
    undeliverable: undeliverable.length,
    capped,
    total,
    label: audienceLabel(normalized, options.tiers),
    note: notes.join(' '),
  };
}

/* ==========================================================================
 * Konfiqurasiya (`push_service.resolve_push_config` güzgüsü)
 *
 * Niyə brauzerdə lazımdır: panel "niyə göndərilmir?" sualına cavab verməlidir,
 * lokal rejimdə isə cavab verəcək server yoxdur. Funksiya **saf**dır — açarı
 * özü heç yerdən oxumur, arqument kimi alır, ona görə burada olması sirri
 * heç bir yeni yerə çıxarmır. Göndəricinin özü (`send_onesignal`) qəsdən
 * güzgülənmir: REST açarı brauzerdən OneSignal-a getməməlidir.
 *
 * Lokal rejimdə platforma cütü **həmişə boşdur** (env brauzerdə yoxdur), yəni
 * `source` yalnız "tenant" ya "none" ola bilər. Bu dürüstdür: lokal rejim
 * onsuz da real bildiriş göndərmir.
 * ========================================================================== */

export interface PushConfig {
  app_id: string;
  rest_api_key: string;
  /** "tenant" | "platform" | "none" */
  source: 'tenant' | 'platform' | 'none';
  /** Azərbaycanca, panelə birbaşa göstərilə bilən səbəb (boş = problem yox). */
  reason: string;
  ok: boolean;
}

/** `operations._push_config_public` güzgüsü — **REST açarı YOX**, yalnız bayraq. */
export interface PushConfigPublic {
  ok: boolean;
  source: string;
  reason: string;
  app_id_set: boolean;
  rest_key_set: boolean;
}

export function pushConfigPublic(config: PushConfig): PushConfigPublic {
  return {
    ok: config.ok,
    source: config.source,
    reason: config.reason,
    app_id_set: !!config.app_id,
    rest_key_set: !!config.rest_api_key,
  };
}

/**
 * `app_id` və REST açarını **bir mənbədən** götürür.
 *
 * Qadağa: tenant app id + platforma REST açarı (və ya tərsi). Belə cüt
 * OneSignal-da `invalid_player_ids` verir — abunəlik id-si başqa app-a aiddir —
 * və köhnə göndərici bu səhvi udub susurdu. Ona görə qarışıq cüt **heç vaxt**
 * qurulmur; əvəzinə `source="none"` və insan-oxunaqlı səbəb qaytarılır.
 */
export function resolvePushConfig(options: {
  tenantAppId?: unknown;
  tenantRestKey?: unknown;
  platformAppId?: unknown;
  platformRestKey?: unknown;
}): PushConfig {
  const tApp = String(options.tenantAppId || '').trim();
  const tKey = String(options.tenantRestKey || '').trim();
  const pApp = String(options.platformAppId || '').trim();
  const pKey = String(options.platformRestKey || '').trim();

  if (tApp && tKey) {
    return { app_id: tApp, rest_api_key: tKey, source: 'tenant', reason: '', ok: true };
  }
  if (tApp && !tKey) {
    return {
      app_id: '',
      rest_api_key: '',
      source: 'none',
      ok: false,
      reason:
        'OneSignal App ID yazılıb, amma bu tenant üçün REST API açarı boşdur. ' +
        'Platforma açarı ilə cütləşdirilmir — abunəliklər sizin app-da olduğu üçün ' +
        'belə göndərmə OneSignal tərəfindən rədd edilir.',
    };
  }
  if (pApp && pKey) {
    return {
      app_id: pApp,
      rest_api_key: pKey,
      source: 'platform',
      ok: true,
      reason: tKey
        ? 'REST API açarı yazılıb, amma OneSignal App ID boşdur — açar nəzərə alınmır. ' +
          'Platforma konfiqurasiyası işlədilir. Öz app-ınızı işlətmək üçün App ID-ni də doldurun.'
        : '',
    };
  }
  return {
    app_id: '',
    rest_api_key: '',
    source: 'none',
    ok: false,
    reason:
      'Push konfiqurasiya edilməyib: nə tenant, nə platforma səviyyəsində ' +
      'OneSignal App ID + REST API açarı cütü tamamlanmır.',
  };
}

/**
 * Brauzer/mobil SDK-nın init edəcəyi app id — `resolve_push_config` ilə **eyni
 * prioritet** (tenant → platforma). İki tərəf ayrı qərar versə abunəlik bir
 * app-da yaranıb göndərmə başqasına gedər.
 */
export function resolveClientAppId(tenantAppId: unknown, platformAppId?: unknown): string {
  const tApp = String(tenantAppId || '').trim();
  return tApp || String(platformAppId || '').trim();
}
