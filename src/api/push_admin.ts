/**
 * P1.4d — admin panelinin push blokunun API cütləri.
 *
 * Backend güzgüsü: `operations.py::/push/{status,preview,test,broadcast,history}`
 * və `/settings/push-settings` (o, `settings.ts`-dədir, çünki `Settings` blobuna
 * yazır).
 *
 * **Lokal rejim dürüstdür, yalançı deyil.** Brauzerdən OneSignal-a göndərmək
 * REST açarını istifadəçinin cihazına çıxarardı, ona görə lokal rejim heç nə
 * göndərmir: seqment, saylar və konfiqurasiya yoxlanışı real işləyir, göndərmə
 * addımı isə `status: 'skipped'` sətri + açıq səbəb qaytarır. P0.7 dərsi budur —
 * səssiz "uğur" cavabı admini "bildiriş getdi" deyə aldadırdı.
 *
 * Ön baxış və göndərmə **eyni** funksiyadan (`resolvePushAudience`) keçir; bu,
 * P0.4 dürüstlük qaydasıdır: panel "412 alıcı" yazıb 30 nəfərə göndərməsin.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDB, setDB } from '../lib/db_sim';
import { logEvent } from '../lib/logger';
import { Customer, Sale } from '../types/pos';
import { filterTenantRecords, getActiveTenantId } from '../lib/tenant';
import { apiRequest, isBackendEnabled } from './client';
import { get_settings, normCustomerAppTiers } from './settings';
import {
  AUDIENCE_SEGMENTS,
  DEFAULT_DORMANT_DAYS,
  DEFAULT_NEW_DAYS,
  MAX_AUDIENCE_DAYS,
  MAX_BROADCAST_DAILY_LIMIT,
  MAX_BROADCAST_RECIPIENTS,
  MAX_PUSH_BODY,
  MAX_PUSH_TITLE,
  MAX_SCHEDULE_LEAD_DAYS,
  MIN_SCHEDULE_LEAD_SECONDS,
  PUSH_KINDS,
  PUSH_SECRET_SENTINEL,
  SEGMENT_LABELS,
  normalizeAudienceSpec,
  normalizePushSettings,
  pushAudienceSummary,
  pushConfigPublic,
  quietBlockMessage,
  quietWindowState,
  resolveClientAppId,
  resolvePushAudience,
  resolvePushConfig,
  sanitizePushText,
  buildFunnel,
  summarizeFunnels,
} from '../lib/push';
import type {
  PushAudienceRow,
  PushAudienceSpec,
  PushAudienceSummary,
  PushConfigPublic,
  PushFunnelSummary,
  PushTierRow,
  QuietWindowState,
} from '../lib/push';

const resolveTenant = (tenant_id?: string) => tenant_id || getActiveTenantId();

/** Tarixçə səhifəsi — backend `PUSH_HISTORY_LIMIT` / `MAX_PUSH_HISTORY_LIMIT`. */
export const PUSH_HISTORY_LIMIT = 50;
export const MAX_PUSH_HISTORY_LIMIT = 200;

export type PushKind = (typeof PUSH_KINDS)[number];

/** `push_deliveries` sətri — backend `get_push_history` cavabı ilə eyni sahələr. */
export interface PushHistoryItem {
  id: string;
  created_at: string | null;
  kind: string;
  event: string | null;
  title: string | null;
  body: string | null;
  segment: string | null;
  segment_value: string | null;
  card_id: string | null;
  /** P4.2 — bildiriş bağlı olduğu kampaniya (happy hour) id-si, yoxsa null. */
  campaign_id: string | null;
  status: string;
  config_source: string | null;
  recipients: number;
  accepted: number;
  failed: number;
  error: string | null;
  created_by: string | null;
}

export interface PushBroadcastState {
  enabled: boolean;
  /** `0` **bloklanıb** deməkdir (limitsiz deyil). */
  daily_limit: number;
  used_today: number;
  remaining: number;
  max_daily_limit: number;
  /** P4.3 — iki kütləvi bildiriş arasında minimum fasilə (dəqiqə). */
  cooldown_minutes: number;
  /** P4.3 — fasilə bitməsinə qalan dəqiqə (0 = fasilə yoxdur). */
  cooldown_remaining_minutes: number;
  /** P4.3 — növbəti icazəli vaxt (ISO), yoxsa `null`. */
  next_allowed_at: string | null;
  /** P4.3 — sükut saatı vəziyyəti. `inside` olanda dərhal göndərmə bloklanır. */
  quiet: QuietWindowState;
}

export interface PushSegmentInfo {
  key: string;
  label: string;
  needs_days: boolean;
  needs_value: boolean;
  needs_min_stars: boolean;
  default_days: number;
}

export interface PushStatus {
  config: PushConfigPublic;
  settings: {
    enabled: boolean;
    event_push_enabled: boolean;
    broadcast_enabled: boolean;
    onesignal_rest_api_key: string;
    broadcast_daily_limit: number;
    broadcast_cooldown_minutes: number;
    quiet_enabled: boolean;
    quiet_start: string;
    quiet_end: string;
    onesignal_rest_api_key_set?: boolean;
  };
  onesignal_app_id: string;
  subscribers: PushAudienceSummary;
  broadcast: PushBroadcastState;
  segments: PushSegmentInfo[];
  tiers: Array<{ key: string; label: unknown; threshold: number }>;
  secret_sentinel: string;
  limits: { title: number; body: number; max_recipients: number; max_days: number };
  /** Yalnız lokal rejimdə dolur — panel "göndərmə işləmir" xəbərdarlığı üçün. */
  local_mode?: boolean;
}

export interface PushPreview {
  audience: PushAudienceSummary;
  spec: PushAudienceSpec;
  config: PushConfigPublic;
  broadcast: PushBroadcastState;
}

export interface PushSendResult {
  success: boolean;
  result: {
    status: string;
    attempted: number;
    accepted: number;
    failed: number;
    provider_ids?: string[];
    invalid_count?: number;
    error: string;
  };
  config: PushConfigPublic;
  audience?: PushAudienceSummary;
  broadcast?: PushBroadcastState;
  /** P4.2 — göndərmə kampaniyaya bağlandısa onun id-si/adı. */
  campaign_id?: string | null;
  campaign_name?: string | null;
}

/* ==========================================================================
 * Lokal rejim — məlumat mənbələri
 * ========================================================================== */

const deliveriesKey = (tenantId: string) => `${tenantId}_push_deliveries`;

const getDeliveriesLocal = (tenantId: string): PushHistoryItem[] => {
  const scoped = getDB<PushHistoryItem>(deliveriesKey(tenantId));
  if (scoped.length > 0) return scoped;
  return filterTenantRecords(getDB<any>('push_deliveries'), tenantId) as PushHistoryItem[];
};

const saveDeliveryLocal = (tenantId: string, row: PushHistoryItem) => {
  const scoped = [{ ...row, tenant_id: tenantId }, ...getDeliveriesLocal(tenantId)].slice(
    0,
    MAX_PUSH_HISTORY_LIMIT * 4,
  );
  const shared = getDB<any>('push_deliveries').filter((r) => String(r?.tenant_id || '') !== tenantId);
  setDB('push_deliveries', [...shared, ...scoped]);
  setDB(deliveriesKey(tenantId), scoped);
};

const getCustomersLocal = (tenantId: string): Customer[] => {
  const tenantRows = getDB<Customer>(`${tenantId}_customers`) || [];
  if (tenantRows.length > 0) return tenantRows;
  return filterTenantRecords(getDB<Customer>('customers'), tenantId);
};

/**
 * P4.2 — kampaniya adı (lokal rejim). Backend `HappyHour.name`-i birbaşa qaytarır;
 * burada `happy_hours` cədvəlindən oxunur. Tapılmasa boş sətir: silinmiş kampaniya
 * tarixçədə adsız qalır, panel isə id-ni göstərir.
 */
const campaignNameLocal = (tenantId: string, campaignId: string): string => {
  const row = filterTenantRecords(getDB<any>('happy_hours'), tenantId).find(
    (r: any) => String(r?.id || '') === campaignId,
  );
  return String(row?.name || '');
};

const getSalesLocal = (tenantId: string): Sale[] => {  const scoped = getDB<Sale>(`${tenantId}_sales`);
  if (scoped.length > 0) return scoped.filter((s) => s.tenant_id === tenantId);
  return getDB<Sale>('sales').filter((s) => s.tenant_id === tenantId);
};

/**
 * Ləğv edilmiş satış statusları — backend `finance_service.VOID_SALE_STATUSES`
 * ilə **eyni** siyahı (`analytics.ts`-dəki qısa nüsxə deyil, orada 3 sətir azdır).
 *
 * Niyə vacib: ləğv olunmuş çeki "aktivlik" saymaq "yatmış müştəri" seqmentini
 * yanlış daraldar, yəni geri qazanma kampaniyası ən lazımlı adamlara getməz.
 */
const VOID_SALE_STATUSES = new Set([
  'VOIDED', 'VOID', 'CANCELLED', 'CANCELED', 'CANCELLED SALE', 'CANCELED SALE',
  'LƏĞV', 'LƏĞV EDILDI', 'LƏĞV EDİLDİ', 'LEĞV', 'LEĞV EDILDI', 'LEĞV EDİLDİ',
  'LAGV', 'LAGV EDILDI',
]);

/**
 * Seqment sətirləri — `push_dispatch.load_audience_rows` güzgüsü.
 *
 * `Customer`-də "son gəliş" sahəsi yoxdur (backend-də də yoxdur), ona görə son
 * aktivlik satışlardan hesablanır: ləğv olunmayan çeklərin **maksimum** tarixi.
 * Abunəliyi olmayan müştəri də qaytarılır — panel "uyğun müştəri" və "abunəçi"
 * saylarını ayrı göstərir, itki hər pillədə görünməlidir.
 */
const buildAudienceRowsLocal = (tenantId: string): PushAudienceRow[] => {
  const lastSale = new Map<string, string>();
  for (const sale of getSalesLocal(tenantId)) {
    const card = String(sale.customer_card_id || '').trim();
    if (!card) continue;
    if (VOID_SALE_STATUSES.has(String(sale.status || '').trim().toUpperCase())) continue;
    const createdAt = String(sale.created_at || '');
    if (!createdAt) continue;
    const previous = lastSale.get(card);
    if (!previous || new Date(createdAt).getTime() > new Date(previous).getTime()) {
      lastSale.set(card, createdAt);
    }
  }
  return getCustomersLocal(tenantId).map((customer) => {
    const anyCustomer = customer as any;
    return {
      card_id: customer.card_id,
      push_token: anyCustomer.push_token || null,
      created_at: customer.created_at || null,
      last_sale_at: lastSale.get(String(customer.card_id || '').trim()) || null,
      stars: customer.stars,
      // Lokal bazada `lifetime_stars` həmişə yoxdur; o zaman cari balans işlədilir
      // (`crm.ts`-dəki tier hesabı ilə eyni fallback).
      lifetime_stars: anyCustomer.lifetime_stars ?? customer.stars,
      // P4.1 — kanal razılığı. Sütun yoxdursa `undefined` qalır və süzgəc onu
      // "razılıq verilmiş" sayır (backend `server_default=true` ilə eyni).
      push_opt_in: anyCustomer.push_opt_in,
    };
  });
};

const localTiers = (tenantId: string): PushTierRow[] => {
  const settings = get_settings(tenantId) as any;
  return normCustomerAppTiers(settings?.customer_app_settings?.tiers) as PushTierRow[];
};

/**
 * Lokal konfiqurasiya. Platforma cütü **qəsdən boşdur**: env brauzerdə yoxdur,
 * uydurmaq isə "hazırdır" deyib göndərməmək olardı.
 */
const localConfig = (tenantId: string) => {
  const settings = get_settings(tenantId) as any;
  const push = settings?.push_settings || {};
  const appId = String(settings?.customer_app_settings?.onesignal_app_id || '').trim();
  return {
    push,
    appId,
    config: resolvePushConfig({ tenantAppId: appId, tenantRestKey: push.onesignal_rest_api_key }),
  };
};

/** `count_broadcasts_today` güzgüsü — `skipped` sətirlər həddi yemir. */
const countBroadcastsTodayLocal = (tenantId: string): number => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = start.getTime() + 86400000;
  return getDeliveriesLocal(tenantId).filter((row) => {
    if (row.kind !== 'broadcast') return false;
    if (!['sent', 'partial', 'failed'].includes(String(row.status || ''))) return false;
    const ms = new Date(String(row.created_at || '')).getTime();
    return Number.isFinite(ms) && ms >= start.getTime() && ms < end;
  }).length;
};

/** P4.3 — son broadcast cəhdinin vaxtı (ms). `null` = heç vaxt. */
const lastBroadcastMsLocal = (tenantId: string): number | null => {
  let best: number | null = null;
  for (const row of getDeliveriesLocal(tenantId)) {
    if (row.kind !== 'broadcast') continue;
    if (!['sent', 'partial', 'failed'].includes(String(row.status || ''))) continue;
    const ms = new Date(String(row.created_at || '')).getTime();
    if (!Number.isFinite(ms)) continue;
    if (best === null || ms > best) best = ms;
  }
  return best;
};

/**
 * `operations._push_broadcast_state` güzgüsü.
 *
 * P4.3 — `cooldown` "nə qədər tez-tez" sualına cavab verir: gündəlik hədd beş
 * bildirişi 10 dəqiqə içində göndərməyə icazə verir, bu isə spamdır.
 */
const broadcastStateLocal = (tenantId: string, push: any): PushBroadcastState => {
  const limit = Number(push?.broadcast_daily_limit || 0);
  const used = countBroadcastsTodayLocal(tenantId);
  const cooldown = Number(push?.broadcast_cooldown_minutes || 0);
  const lastMs = lastBroadcastMsLocal(tenantId);
  let remainingMin = 0;
  let nextAllowedAt: string | null = null;
  if (cooldown > 0 && lastMs !== null) {
    const nextMs = lastMs + cooldown * 60000;
    if (nextMs > Date.now()) {
      remainingMin = Math.floor((nextMs - Date.now()) / 60000) + 1;
      nextAllowedAt = new Date(nextMs).toISOString();
    }
  }
  return {
    enabled: !!push?.broadcast_enabled,
    daily_limit: limit,
    used_today: used,
    remaining: Math.max(0, limit - used),
    max_daily_limit: MAX_BROADCAST_DAILY_LIMIT,
    cooldown_minutes: cooldown,
    cooldown_remaining_minutes: remainingMin,
    next_allowed_at: nextAllowedAt,
    // Lokal rejimdə tenant saat qurşağı məlum deyil → brauzerin yerli saatı
    // işlədilir. Backend tenant-ın `time_settings.timezone`-unu oxuyur, yəni iki
    // rejim eyni saatda fərqli cavab verə bilər; fərq yalnız panelə göndərməni
    // **əvvəlcədən** bloklamaqdadır, yekun qərar həmişə serverdədir.
    quiet: quietWindowState(push, new Date().getHours() * 60 + new Date().getMinutes()),
  };
};

const SEGMENT_INFO: PushSegmentInfo[] = AUDIENCE_SEGMENTS.map((key) => ({
  key,
  label: SEGMENT_LABELS[key] || key,
  needs_days: key === 'new' || key === 'dormant',
  needs_value: key === 'tier',
  needs_min_stars: key === 'has_balance',
  default_days: key === 'new' ? DEFAULT_NEW_DAYS : DEFAULT_DORMANT_DAYS,
}));

/* ==========================================================================
 * Status və ön baxış
 * ========================================================================== */

export function get_push_status(tenant_id?: string): PushStatus {
  const tenantId = resolveTenant(tenant_id);
  const { push, appId, config } = localConfig(tenantId);
  const tiers = localTiers(tenantId);
  // Abunəçi sayı ön baxışla **eyni** funksiyadan gəlir; ayrı sayğac panelə iki
  // fərqli rəqəm göstərər ("1 240 abunəçi" / "412 alıcı") və heç biri izah olunmaz.
  const audience = resolvePushAudience(buildAudienceRowsLocal(tenantId), { segment: 'all' }, { tiers });
  return {
    config: pushConfigPublic(config),
    // Lokal blob `push_settings` xam saxlanılır; panelin gözlədiyi tam sxemi
    // (P4.3 açarları daxil) normalizer verir — backend `/push/status` də onu qaytarır.
    settings: normalizePushSettings(push) as any,
    // Lokal rejimdə platforma app id-si yoxdur, yəni bu, tenant dəyəridir.
    onesignal_app_id: resolveClientAppId(appId),
    subscribers: pushAudienceSummary(audience),
    broadcast: broadcastStateLocal(tenantId, push),
    segments: SEGMENT_INFO,
    tiers: tiers.map((t) => ({
      key: String(t.key || ''),
      label: t.label,
      threshold: Number(t.threshold || 0),
    })),
    secret_sentinel: PUSH_SECRET_SENTINEL,
    limits: {
      title: MAX_PUSH_TITLE,
      body: MAX_PUSH_BODY,
      max_recipients: MAX_BROADCAST_RECIPIENTS,
      max_days: MAX_AUDIENCE_DAYS,
    },
    local_mode: true,
  };
}

export async function get_push_status_live(): Promise<PushStatus> {
  if (!isBackendEnabled()) return get_push_status();
  return apiRequest<PushStatus>('/api/v1/ops/push/status', { tenantId: null });
}

export interface PushAudienceInput {
  segment?: string;
  value?: string;
  days?: number | null;
  min_stars?: number | null;
}

export function preview_push_audience(spec?: PushAudienceInput, tenant_id?: string): PushPreview {
  const tenantId = resolveTenant(tenant_id);
  const { push, config } = localConfig(tenantId);
  const tiers = localTiers(tenantId);
  const normalized = normalizeAudienceSpec(spec);
  const audience = resolvePushAudience(buildAudienceRowsLocal(tenantId), normalized, { tiers });
  return {
    audience: pushAudienceSummary(audience),
    spec: normalized,
    config: pushConfigPublic(config),
    broadcast: broadcastStateLocal(tenantId, push),
  };
}

export async function preview_push_audience_live(spec?: PushAudienceInput): Promise<PushPreview> {
  if (!isBackendEnabled()) return preview_push_audience(spec);
  const normalized = normalizeAudienceSpec(spec);
  return apiRequest<PushPreview>('/api/v1/ops/push/preview', {
    method: 'POST',
    tenantId: null,
    // Normalizasiya olunmuş spec göndərilir: serverin `PushAudienceIn` sxemi
    // `days`/`min_stars` üçün `None` qəbul edir, amma normalizer hər iki tərəfdə
    // eynidir, ona görə açıq dəyər göndərmək panelin göstərdiyi rəqəmi qorur.
    body: {
      segment: normalized.segment,
      value: normalized.value,
      days: normalized.days,
      min_stars: normalized.min_stars,
    },
  });
}

/* ==========================================================================
 * Göndərmə — test və broadcast
 * ========================================================================== */

/**
 * Lokal rejimin göndərmə səbəbi. Bu sətir `push_deliveries.error`-a yazılır və
 * panelə göstərilir; "uğurlu" cavab qaytarmaq P0.7-də düzəldilən səhv idi.
 */
const LOCAL_SKIP_REASON =
  'Lokal rejimdə göndərmə yoxdur: OneSignal REST açarı brauzerə çıxarılmır, ' +
  'ona görə bildiriş yalnız jurnala "skipped" kimi yazılır. Backend qoşulanda ' +
  '(VITE_USE_BACKEND) həmin sorğu real göndərilir.';

/** `send_bulk_push` güzgüsü — açar yoxlanışı, sonra lokal "göndərmə yoxdur" səbəbi. */
const localSendResult = (
  push: any,
  kind: PushKind,
  attempted: number,
): PushSendResult['result'] => {
  let error = LOCAL_SKIP_REASON;
  if (!(push?.enabled ?? true)) error = 'Push bildirişləri söndürülüb.';
  else if (kind === 'broadcast' && !push?.broadcast_enabled) {
    error = 'Kütləvi bildiriş söndürülüb (Ayarlar → Bildirişlər).';
  }
  return { status: 'skipped', attempted, accepted: 0, failed: 0, error };
};

const recordLocalDelivery = (
  tenantId: string,
  args: {
    kind: PushKind;
    title: string;
    body: string;
    segment?: string | null;
    segment_value?: string | null;
    card_id?: string | null;
    campaign_id?: string | null;
    config_source: string;
    result: PushSendResult['result'];
  },
) => {
  saveDeliveryLocal(tenantId, {
    id: uuidv4(),
    created_at: new Date().toISOString(),
    kind: args.kind,
    event: 'manual',
    title: args.title || null,
    body: args.body || null,
    segment: args.segment || null,
    segment_value: args.segment_value || null,
    card_id: args.card_id || null,
    campaign_id: args.campaign_id || null,
    status: args.result.status,
    config_source: args.config_source,
    recipients: args.result.attempted,
    accepted: args.result.accepted,
    failed: args.result.failed,
    error: args.result.error || null,
    created_by: 'local',
  });
};

export interface PushTestInput {
  title?: string;
  body?: string;
  card_id?: string;
  token?: string;
}

/**
 * Test bildirişi. `broadcast_enabled` **tələb olunmur** — test məhz o açarı
 * yandırmadan konfiqurasiyanı yoxlamaq üçündür (backend ilə eyni qayda).
 *
 * Xətalar `Error` kimi atılır, çünki backend cütü 404/400 qaytarır və panel hər
 * iki rejimdə eyni `catch` bloku ilə işləməlidir.
 */
export function send_push_test(payload: PushTestInput, tenant_id?: string): PushSendResult {
  const tenantId = resolveTenant(tenant_id);
  const { push, config } = localConfig(tenantId);
  let token = String(payload?.token || '').trim();
  const cardId = String(payload?.card_id || '').trim();
  if (!token && cardId) {
    const customer = getCustomersLocal(tenantId).find((c) => String(c.card_id || '').trim() === cardId);
    if (!customer) throw new Error('Müştəri tapılmadı');
    token = String((customer as any).push_token || '').trim();
    if (!token) throw new Error('Bu müştəridə bildiriş abunəliyi yoxdur');
  }
  if (!token) throw new Error('Test üçün kart nömrəsi və ya abunəlik id-si lazımdır');

  const { title, body } = sanitizePushText(
    payload?.title || 'Test bildirişi',
    payload?.body || 'Bu, admin panelindən göndərilən test bildirişidir.',
  );
  const result = localSendResult(push, 'test', 1);
  recordLocalDelivery(tenantId, {
    kind: 'test',
    title,
    body,
    segment: 'test',
    segment_value: cardId || null,
    card_id: cardId || null,
    config_source: config.source,
    result,
  });
  return { success: false, result, config: pushConfigPublic(config) };
}

export async function send_push_test_live(payload: PushTestInput): Promise<PushSendResult> {
  if (!isBackendEnabled()) return send_push_test(payload);
  return apiRequest<PushSendResult>('/api/v1/ops/push/test', {
    method: 'POST',
    tenantId: null,
    body: {
      title: String(payload?.title || ''),
      body: String(payload?.body || ''),
      card_id: String(payload?.card_id || '') || null,
      token: String(payload?.token || '') || null,
    },
  });
}

export interface PushBroadcastInput {
  title?: string;
  body: string;
  url?: string | null;
  audience?: PushAudienceInput | null;
  /** P4.2 — kampaniyaya bağlanırsa onun id-si (atribusiya üçün). */
  campaign_id?: string | null;
}

/**
 * Kütləvi bildiriş. Şərtlər **göndərmədən əvvəl** yoxlanır və səbəb atılır:
 * söndürülü açar ucbatından yaranan `skipped` sətri panelə "getdi" kimi görünərdi.
 *
 * Yoxlama nərdivanı `operations.py::send_push_broadcast` ilə **eyni sıradadır**,
 * çünki panel eyni mətni gözləyir və iki rejimdə fərqli səbəb göstərmək admini
 * səhv yerə yönləndirər.
 */
export function send_push_broadcast(payload: PushBroadcastInput, tenant_id?: string): PushSendResult {
  const tenantId = resolveTenant(tenant_id);
  const { push, config } = localConfig(tenantId);
  if (!(push?.enabled ?? true)) throw new Error('Push bildirişləri söndürülüb (Ayarlar → Bildirişlər).');
  if (!push?.broadcast_enabled) throw new Error('Kütləvi bildiriş söndürülüb (Ayarlar → Bildirişlər).');

  const state = broadcastStateLocal(tenantId, push);
  if (state.daily_limit <= 0) {
    throw new Error('Gündəlik broadcast həddi 0-dır — göndərmə bloklanıb. Ayarlarda həddi artırın.');
  }
  if (state.remaining <= 0) {
    throw new Error(
      `Gündəlik hədd doldu (${state.used_today}/${state.daily_limit}). ` +
        'Sayğac tenant-ın gecə yarısında sıfırlanır.',
    );
  }
  // P4.3 — sükut saatı və fasilə. Backend nərdivanı ilə **eyni sıra**: sükut
  // sonra fasilə, çünki sükut daha güclü səbəbdir (vaxt bitəndə özü keçir).
  if (state.quiet?.inside) throw new Error(quietBlockMessage(state.quiet));
  if (state.cooldown_remaining_minutes > 0) {
    throw new Error(
      `İki kütləvi bildiriş arasında fasilə gözlənilir (${state.cooldown_minutes} dəqiqə). ` +
        `Yenidən cəhd: ${state.cooldown_remaining_minutes} dəqiqə sonra.`,
    );
  }
  if (!config.ok) throw new Error(config.reason || 'Push konfiqurasiyası tamamlanmayıb.');

  const { title, body } = sanitizePushText(payload?.title, payload?.body);
  if (!body) throw new Error('Bildiriş mətni boşdur.');
  const url = String(payload?.url || '').trim();
  if (url && !url.startsWith('https://')) throw new Error('Keçid ünvanı https:// ilə başlamalıdır.');

  const tiers = localTiers(tenantId);
  const spec = normalizeAudienceSpec(payload?.audience);
  // Ön baxışın çağırdığı **eyni** funksiya — P0.4 qaydası.
  const audience = resolvePushAudience(buildAudienceRowsLocal(tenantId), spec, { tiers });
  if (audience.tokens.length === 0) {
    // Boş göndərmə jurnalda "failed" sətri yaratmasın — bu, seqmentin nəticəsidir,
    // provayderin xətası deyil. Səbəb hər pillənin sayı ilə qaytarılır.
    throw new Error(
      `Seçilmiş seqmentdə çatdırıla bilən abunəçi yoxdur (uyğun müştəri: ` +
        `${audience.matched}, abunəliyi olan: ${audience.with_token}, çatdırılmayan ` +
        `cihaz tokeni: ${audience.undeliverable}, razılığı geri götürən: ` +
        `${audience.no_consent}).`,
    );
  }

  const result = localSendResult(push, 'broadcast', audience.tokens.length);
  const campaignId = String(payload?.campaign_id || '').trim() || null;
  recordLocalDelivery(tenantId, {
    kind: 'broadcast',
    title,
    body,
    segment: spec.segment,
    segment_value: audience.label,
    campaign_id: campaignId,
    config_source: config.source,
    result,
  });
  logEvent('admin', 'PUSH_BROADCAST_SENT', {
    tenant_id: tenantId,
    segment: spec,
    recipients: audience.recipients,
    matched: audience.matched,
    status: result.status,
    accepted: result.accepted,
    failed: result.failed,
    title,
    campaign_id: campaignId,
  });
  return {
    success: false,
    result,
    audience: pushAudienceSummary(audience),
    config: pushConfigPublic(config),
    // `skipped` sətir həddi yemir, ona görə vəziyyət yenidən hesablanır.
    broadcast: broadcastStateLocal(tenantId, push),
    campaign_id: campaignId,
    campaign_name: campaignId ? campaignNameLocal(tenantId, campaignId) : null,
  };
}

export async function send_push_broadcast_live(payload: PushBroadcastInput): Promise<PushSendResult> {
  if (!isBackendEnabled()) return send_push_broadcast(payload);
  const spec = normalizeAudienceSpec(payload?.audience);
  return apiRequest<PushSendResult>('/api/v1/ops/push/broadcast', {
    method: 'POST',
    tenantId: null,
    body: {
      title: String(payload?.title || ''),
      body: String(payload?.body || ''),
      url: String(payload?.url || '') || null,
      campaign_id: String(payload?.campaign_id || '') || null,
      audience: {
        segment: spec.segment,
        value: spec.value,
        days: spec.days,
        min_stars: spec.min_stars,
      },
    },
  });
}

/* ==========================================================================
 * P4.2 — kampaniya üzrə göndərmə xülasəsi
 * ========================================================================== */

export interface CampaignPushStat {
  campaign_id: string;
  sends: number;
  recipients: number;
  accepted: number;
  failed: number;
  last_sent_at: string | null;
}

/**
 * Kampaniya başına göndərmə sayı. Tarixçə səhifəsindən say çıxarmaq **yanlış**
 * olardı: o siyahı `limit` ilə kəsilir. Lokal rejimdə saxlanan bütün
 * `push_deliveries` sətirləri üzərində hesablanır (lokal bazada həcm kiçikdir və
 * `MAX_PUSH_HISTORY_LIMIT * 4` ilə sərhədlidir).
 */
export function get_push_campaign_stats(tenant_id?: string): Record<string, CampaignPushStat> {
  const tenantId = resolveTenant(tenant_id);
  const stats: Record<string, CampaignPushStat> = {};
  for (const row of getDeliveriesLocal(tenantId)) {
    const campaignId = String(row.campaign_id || '').trim();
    if (!campaignId) continue;
    const entry = stats[campaignId] || {
      campaign_id: campaignId,
      sends: 0,
      recipients: 0,
      accepted: 0,
      failed: 0,
      last_sent_at: null,
    };
    entry.sends += 1;
    entry.recipients += Number(row.recipients || 0);
    entry.accepted += Number(row.accepted || 0);
    entry.failed += Number(row.failed || 0);
    const createdAt = String(row.created_at || '');
    if (createdAt && (!entry.last_sent_at || createdAt > entry.last_sent_at)) entry.last_sent_at = createdAt;
    stats[campaignId] = entry;
  }
  return stats;
}

export async function get_push_campaign_stats_live(days?: number): Promise<Record<string, CampaignPushStat>> {
  if (!isBackendEnabled()) return get_push_campaign_stats();
  const params = new URLSearchParams();
  params.set('days', String(Number(days) > 0 ? Math.trunc(Number(days)) : 90));
  const res = await apiRequest<{ days: number; stats: Record<string, CampaignPushStat> }>(
    `/api/v1/ops/push/campaign-stats?${params.toString()}`,
    { tenantId: null },
  );
  return res?.stats || {};
}

/* ==========================================================================
 * P4.4 — ölçmə və atribusiya (göndərmə → istifadə hunisi)
 *
 * **Açılma (open) siqnalı P4.5-dən sonra VAR, lakin QİSMƏNDİR**: tətbiq özü
 * bildirir (`pushNotificationActionPerformed` → `data.delivery_id` →
 * `POST /customer-app/push-engagement`). Bildirişi panel-dən silən müştəri
 * görünmür; `clicked` yoxdur (düymə yoxdur). Ona görə `open_rate` "ən azı"
 * kimi oxunmalıdır və `open_tracking: false` olanda panel "izlənmir" yazır —
 * "0 açılma" deyil. Əsas rəqəm yenə `redemption_rate`-dir (kassa kampaniya
 * endirimini TƏTBİQ edəndə), `conversion_rate` adı isə sübutsuz iddia olardı —
 * müştəri bildirişi görüb gəldi, yoxsa onsuz da gələcəkdi, satış sətrindən
 * bilinmir.
 * ========================================================================== */

export interface PushFunnelRow {
  campaign_id: string;
  campaign_name: string;
  sends: number;
  recipients: number;
  accepted: number;
  failed: number;
  delivery_rate: number;
  /** P4.5 — tətbiqdən gələn toxunma. Qismən ölçü, "ən azı" kimi oxu. */
  opened: number;
  openers: number;
  open_rate: number;
  orders: number;
  customers: number;
  revenue: number;
  discount: number;
  avg_order_value: number;
  discount_per_order: number;
  redemption_rate: number;
  attribution: string;
  open_tracking: boolean;
}

export interface PushFunnelResponse {
  days: number;
  since: string;
  funnels: PushFunnelRow[];
  summary: PushFunnelSummary;
}

/**
 * Lokal rejimdə huni. **Nəticə backend ilə eyni olmaya bilər** və səbəbi
 * dürüstdür: brauzer bazası son satışların bir hissəsini saxlayır
 * (`analytics.ts` köhnə çekləri təmizləyir), server isə hamısını. Panel bunu
 * `local_mode` xəbərdarlığı ilə deyir — uydurma bərabərlik göstərmirik.
 *
 * Açılma (P4.5) lokal rejimdə **heç vaxt** göstərilmir: hadisə serverdəki
 * `push_engagement` cədvəlinə yazılır, brauzerdə qeydi yoxdur. `open_tracking`
 * `false` qalır, yəni panel "izlənmir" yazır — "0 açılma" deyil. Server
 * rejimində real rəqəm gəlir.
 */
export function get_push_funnel(days?: number, tenant_id?: string): PushFunnelResponse {
  const tenantId = resolveTenant(tenant_id);
  const windowDays = Number(days) > 0 ? Math.trunc(Number(days)) : 90;
  const cutoffMs = Date.now() - windowDays * 86400_000;

  const deliveries = getDeliveriesLocal(tenantId).filter(
    (row) => row.campaign_id && new Date(String(row.created_at || '')).getTime() >= cutoffMs,
  );
  const sales = getSalesLocal(tenantId).filter(
    (row) =>
      row.campaign_id &&
      !VOID_SALE_STATUSES.has(String(row.status || '').toUpperCase()) &&
      new Date(String(row.created_at || '')).getTime() >= cutoffMs,
  );

  const byCampaign = new Map<string, { d: any; s: any[] }>();
  const bucket = (campaignId: string) => {
    const key = String(campaignId);
    if (!byCampaign.has(key)) byCampaign.set(key, { d: null, s: [] });
    return byCampaign.get(key)!;
  };
  for (const row of deliveries) {
    const b = bucket(String(row.campaign_id));
    b.d = b.d || { sends: 0, recipients: 0, accepted: 0, failed: 0 };
    b.d.sends += 1;
    b.d.recipients += Number(row.recipients || 0);
    b.d.accepted += Number(row.accepted || 0);
    b.d.failed += Number(row.failed || 0);
  }
  for (const row of sales) {
    // Təkrarsız müştəri: kassa `customer_card_id`-ni həmişə doldurmur (qonaq
    // çeki), ona görə boş kartlar ayrı sayılmır — `analytics.ts` ilə eyni qayda.
    bucket(String(row.campaign_id)).s.push(row);
  }

  const funnels: PushFunnelRow[] = [];
  for (const [campaignId, group] of byCampaign.entries()) {
    const cards = new Set(
      group.s.map((s) => String(s.customer_card_id || '').trim()).filter(Boolean),
    );
    const funnel = buildFunnel({
      ...(group.d || {}),
      orders: group.s.length,
      customers: cards.size,
      revenue: group.s.reduce((sum, s) => sum + Number(s.total || 0), 0),
      discount: group.s.reduce((sum, s) => sum + Number(s.discount_amount || 0), 0),
    });
    funnels.push({
      ...funnel,
      campaign_id: campaignId,
      campaign_name: campaignNameLocal(tenantId, campaignId),
    });
  }
  // Ən çox istifadə olunan əvvəldə — backend ilə eyni sıra.
  funnels.sort((a, b) => b.orders - a.orders || b.recipients - a.recipients);
  return {
    days: windowDays,
    since: new Date(cutoffMs).toISOString(),
    funnels,
    summary: summarizeFunnels(funnels),
  };
}

export async function get_push_funnel_live(
  days?: number,
  campaign_id?: string,
): Promise<PushFunnelResponse> {
  if (!isBackendEnabled()) return get_push_funnel(days);
  const params = new URLSearchParams();
  params.set('days', String(Number(days) > 0 ? Math.trunc(Number(days)) : 90));
  const cleanCampaign = String(campaign_id || '').trim();
  if (cleanCampaign) params.set('campaign_id', cleanCampaign);
  return apiRequest<PushFunnelResponse>(`/api/v1/ops/push/funnel?${params.toString()}`, {
    tenantId: null,
  });
}

/* ==========================================================================
 * Tarixçə
 * ========================================================================== */

export interface PushHistoryResponse {
  items: PushHistoryItem[];
  count: number;
  kinds: string[];
}

/**
 * Göndərmə tarixçəsi, yeni sətir əvvəldə. `details` qaytarılmır (backend də
 * qaytarmır) — içindəki `provider_ids` panelə heç nə demir.
 */
export function get_push_history(
  limit?: number,
  kind?: string,
  tenant_id?: string,
  campaign_id?: string,
): PushHistoryResponse {
  const tenantId = resolveTenant(tenant_id);
  const raw = Number(limit);
  const clamped = Number.isFinite(raw) && raw > 0
    ? Math.min(Math.trunc(raw), MAX_PUSH_HISTORY_LIMIT)
    : PUSH_HISTORY_LIMIT;
  const cleanKind = String(kind || '').trim().toLowerCase();
  // Tanınmayan `kind` **süzmür** (backend də belədir): panel yeni bir növ göndərsə,
  // boş cədvəl yerinə tam tarixçə görünür.
  const filterKind = (PUSH_KINDS as readonly string[]).includes(cleanKind) ? cleanKind : '';
  // P4.2 — kampaniya süzgəci. Verilibsə yalnız o kampaniyanın bildirişləri.
  const filterCampaign = String(campaign_id || '').trim();
  const rows = getDeliveriesLocal(tenantId)
    .filter((row) => !filterKind || row.kind === filterKind)
    .filter((row) => !filterCampaign || String(row.campaign_id || '') === filterCampaign)
    .sort((a, b) => new Date(String(b.created_at || '')).getTime() - new Date(String(a.created_at || '')).getTime())
    .slice(0, clamped);
  return { items: rows, count: rows.length, kinds: [...PUSH_KINDS] };
}

export async function get_push_history_live(
  limit?: number,
  kind?: string,
  campaign_id?: string,
): Promise<PushHistoryResponse> {
  if (!isBackendEnabled()) return get_push_history(limit, kind, undefined, campaign_id);
  const params = new URLSearchParams();
  params.set('limit', String(limit || PUSH_HISTORY_LIMIT));
  const cleanKind = String(kind || '').trim().toLowerCase();
  if ((PUSH_KINDS as readonly string[]).includes(cleanKind)) params.set('kind', cleanKind);
  const cleanCampaign = String(campaign_id || '').trim();
  if (cleanCampaign) params.set('campaign_id', cleanCampaign);
  return apiRequest<PushHistoryResponse>(`/api/v1/ops/push/history?${params.toString()}`, { tenantId: null });
}

/* ==========================================================================
 * P4.3 — planlanmış kütləvi bildiriş
 *
 * Lokal rejim **dürüstdür**: plan saxlanılır (cədvəl görünür), lakin göndərilmir —
 * brauzer bağlananda "scheduler" də dayanır. Ona görə `get_push_schedules` lokal
 * planların `status`-unu `pending` saxlayır və panelin `local_mode` xəbərdarlığı
 * istifadəçini real göndərmənin backend tələb etdiyini bilir.
 * ========================================================================== */

export interface PushScheduleItem {
  id: string;
  title: string;
  body: string;
  url: string | null;
  audience: PushAudienceSpec;
  campaign_id: string | null;
  /** "pending" | "sent" | "canceled" | "failed" */
  status: string;
  scheduled_at: string | null;
  executed_at: string | null;
  error: string | null;
  delivery_id: string | null;
  created_by: string | null;
  created_at: string | null;
}

export interface PushScheduleResponse {
  items: PushScheduleItem[];
  count: number;
  statuses: string[];
}

export interface PushScheduleInput {
  title?: string;
  body: string;
  url?: string | null;
  /** ISO 8601 — ofset verilərsə UTC-yə çevrilir. */
  scheduled_at: string;
  audience?: PushAudienceInput | null;
  campaign_id?: string | null;
}

const schedulesKey = (tenantId: string) => `${tenantId}_push_schedules`;

const getSchedulesLocal = (tenantId: string): PushScheduleItem[] => {
  const scoped = getDB<PushScheduleItem>(schedulesKey(tenantId));
  if (scoped.length > 0) return scoped;
  return filterTenantRecords(getDB<any>('push_schedules'), tenantId) as PushScheduleItem[];
};

const saveSchedulesLocal = (tenantId: string, rows: PushScheduleItem[]) => {
  const scoped = rows.slice(0, 200);
  const shared = getDB<any>('push_schedules').filter((r) => String(r?.tenant_id || '') !== tenantId);
  setDB('push_schedules', [...shared, ...scoped]);
  setDB(schedulesKey(tenantId), scoped);
};

/** `push_schedules.validate_schedule_window` güzgüsü. Boş sətir = qaydasındadır. */
export function validateScheduleWindow(scheduledAt: unknown, now: number = Date.now()): string {
  const raw = String(scheduledAt || '').trim();
  if (!raw) return 'Planlanmış vaxt düzgün deyil (ISO 8601 formatı gözlənilir).';
  const ms = new Date(raw).getTime();
  if (!Number.isFinite(ms)) return 'Planlanmış vaxt düzgün deyil (ISO 8601 formatı gözlənilir).';
  const deltaSec = (ms - now) / 1000;
  if (deltaSec < MIN_SCHEDULE_LEAD_SECONDS) {
    return (
      'Planlanmış vaxt ən azı 1 dəqiqə sonra olmalıdır. ' +
      'Dərhal göndərmək üçün adi göndərmə düyməsini işlədin.'
    );
  }
  if (deltaSec > MAX_SCHEDULE_LEAD_DAYS * 86400) {
    return `Planlanmış vaxt ${MAX_SCHEDULE_LEAD_DAYS} gündən uzaq ola bilməz — ili yoxlayın.`;
  }
  return '';
}

export function get_push_schedules(
  limit?: number,
  status?: string,
  tenant_id?: string,
): PushScheduleResponse {
  const tenantId = resolveTenant(tenant_id);
  const clamped = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Math.min(Math.trunc(Number(limit)), 200)
    : PUSH_HISTORY_LIMIT;
  const cleanStatus = String(status || '').trim().toLowerCase();
  const rows = getSchedulesLocal(tenantId)
    .filter((row) => !cleanStatus || String(row.status || '') === cleanStatus)
    .sort((a, b) => new Date(String(a.scheduled_at || '')).getTime() - new Date(String(b.scheduled_at || '')).getTime())
    .slice(0, clamped);
  return { items: rows, count: rows.length, statuses: ['pending', 'sent', 'canceled', 'failed'] };
}

export async function get_push_schedules_live(
  limit?: number,
  status?: string,
  campaign_id?: string,
): Promise<PushScheduleResponse> {
  if (!isBackendEnabled()) return get_push_schedules(limit, status);
  const params = new URLSearchParams();
  params.set('limit', String(limit || PUSH_HISTORY_LIMIT));
  const cleanStatus = String(status || '').trim().toLowerCase();
  if (cleanStatus) params.set('status', cleanStatus);
  const cleanCampaign = String(campaign_id || '').trim();
  if (cleanCampaign) params.set('campaign_id', cleanCampaign);
  return apiRequest<PushScheduleResponse>(`/api/v1/ops/push/schedule?${params.toString()}`, { tenantId: null });
}

/**
 * Plan yaradır. Lokal rejimdə sətir yalnız **siyahıda** görünür (göndərilmir) —
 * brauzerdə scheduler yoxdur, ona görə "göndərildi" demək P0.7-nin pozulması olardı.
 */
export function create_push_schedule(payload: PushScheduleInput, tenant_id?: string): PushScheduleItem {
  const tenantId = resolveTenant(tenant_id);
  const body = String(payload?.body || '').trim();
  if (!body) throw new Error('Bildiriş mətni boşdur.');
  const url = String(payload?.url || '').trim();
  if (url && !url.startsWith('https://')) throw new Error('Keçid ünvanı https:// ilə başlamalıdır.');
  const reason = validateScheduleWindow(payload?.scheduled_at);
  if (reason) throw new Error(reason);

  const row: PushScheduleItem = {
    id: uuidv4(),
    title: String(payload?.title || '').trim().slice(0, MAX_PUSH_TITLE),
    body: body.slice(0, MAX_PUSH_BODY),
    url: url || null,
    // Seqment **dondurulur** (backend `create_schedule` ilə eyni səbəb): göndərmə
    // anında yenidən hesablamaq adminin təsdiqlədiyi dəsti dəyişərdi.
    audience: normalizeAudienceSpec(payload?.audience),
    campaign_id: String(payload?.campaign_id || '').trim() || null,
    status: 'pending',
    scheduled_at: new Date(String(payload?.scheduled_at)).toISOString(),
    executed_at: null,
    error: null,
    delivery_id: null,
    created_by: 'local',
    created_at: new Date().toISOString(),
  };
  saveSchedulesLocal(tenantId, [row, ...getSchedulesLocal(tenantId)]);
  logEvent('admin', 'PUSH_SCHEDULE_CREATED', {
    tenant_id: tenantId,
    schedule_id: row.id,
    scheduled_at: row.scheduled_at,
    audience: row.audience,
    campaign_id: row.campaign_id,
  });
  return row;
}

export async function create_push_schedule_live(payload: PushScheduleInput): Promise<PushScheduleItem> {
  if (!isBackendEnabled()) return create_push_schedule(payload);
  const spec = normalizeAudienceSpec(payload?.audience);
  // `<input type="datetime-local">` **ofsetsiz** sətir verir ("2026-10-11T18:30") və
  // brauzer onu yerli vaxt kimi oxuyur, backend isə naive sətri UTC sayır —
  // Bakıda (UTC+4) plan 4 saat gec göndərilərdi. Ona görə burada ISO UTC-yə
  // çevrilir (lokal yolda da eyni çevrilmə var: `create_push_schedule`).
  // Xarab dəyər `toISOString()`-də `RangeError` atardı — əvvəlcə yoxlayırıq.
  const reason = validateScheduleWindow(payload?.scheduled_at);
  if (reason) throw new Error(reason);
  const scheduledAt = new Date(String(payload?.scheduled_at)).toISOString();
  const res = await apiRequest<{ success: boolean; schedule: PushScheduleItem }>(
    '/api/v1/ops/push/schedule',
    {
      method: 'POST',
      tenantId: null,
      body: {
        title: String(payload?.title || ''),
        body: String(payload?.body || ''),
        url: String(payload?.url || '') || null,
        scheduled_at: scheduledAt,
        campaign_id: String(payload?.campaign_id || '') || null,
        audience: {
          segment: spec.segment,
          value: spec.value,
          days: spec.days,
          min_stars: spec.min_stars,
        },
      },
    },
  );
  return res.schedule;
}

/**
 * Gözləyən planı ləğv edir. Artıq göndərilmiş plan üçün **atır**: bildiriş
 * telefonlardadır, geri alınmır — panel bunu `409` kimi göstərir.
 */
export function cancel_push_schedule(schedule_id: string, tenant_id?: string): PushScheduleItem {
  const tenantId = resolveTenant(tenant_id);
  const id = String(schedule_id || '').trim();
  const rows = getSchedulesLocal(tenantId);
  const row = rows.find((r) => String(r.id) === id);
  if (!row) throw new Error('Plan tapılmadı');
  if (String(row.status) !== 'pending') {
    throw new Error(`Bu plan artıq '${row.status}' statusundadır — ləğv edilə bilməz.`);
  }
  const next: PushScheduleItem = {
    ...row,
    status: 'canceled',
    executed_at: new Date().toISOString(),
    error: 'local istifadəçisi tərəfindən ləğv edildi',
  };
  saveSchedulesLocal(tenantId, rows.map((r) => (String(r.id) === id ? next : r)));
  logEvent('admin', 'PUSH_SCHEDULE_CANCELED', { tenant_id: tenantId, schedule_id: id });
  return next;
}

export async function cancel_push_schedule_live(schedule_id: string): Promise<PushScheduleItem> {
  if (!isBackendEnabled()) return cancel_push_schedule(schedule_id);
  const id = String(schedule_id || '').trim();
  const res = await apiRequest<{ success: boolean; schedule: PushScheduleItem }>(
    `/api/v1/ops/push/schedule/${encodeURIComponent(id)}`,
    { method: 'DELETE', tenantId: null },
  );
  return res.schedule;
}
