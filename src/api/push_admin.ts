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
  PUSH_KINDS,
  PUSH_SECRET_SENTINEL,
  SEGMENT_LABELS,
  normalizeAudienceSpec,
  pushAudienceSummary,
  pushConfigPublic,
  resolveClientAppId,
  resolvePushAudience,
  resolvePushConfig,
  sanitizePushText,
} from '../lib/push';
import type {
  PushAudienceRow,
  PushAudienceSpec,
  PushAudienceSummary,
  PushConfigPublic,
  PushTierRow,
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

const getSalesLocal = (tenantId: string): Sale[] => {
  const scoped = getDB<Sale>(`${tenantId}_sales`);
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

const broadcastStateLocal = (tenantId: string, push: any): PushBroadcastState => {
  const limit = Number(push?.broadcast_daily_limit || 0);
  const used = countBroadcastsTodayLocal(tenantId);
  return {
    enabled: !!push?.broadcast_enabled,
    daily_limit: limit,
    used_today: used,
    remaining: Math.max(0, limit - used),
    max_daily_limit: MAX_BROADCAST_DAILY_LIMIT,
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
    settings: push,
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
        `cihaz tokeni: ${audience.undeliverable}).`,
    );
  }

  const result = localSendResult(push, 'broadcast', audience.tokens.length);
  recordLocalDelivery(tenantId, {
    kind: 'broadcast',
    title,
    body,
    segment: spec.segment,
    segment_value: audience.label,
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
  });
  return {
    success: false,
    result,
    audience: pushAudienceSummary(audience),
    config: pushConfigPublic(config),
    // `skipped` sətir həddi yemir, ona görə vəziyyət yenidən hesablanır.
    broadcast: broadcastStateLocal(tenantId, push),
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
export function get_push_history(limit?: number, kind?: string, tenant_id?: string): PushHistoryResponse {
  const tenantId = resolveTenant(tenant_id);
  const raw = Number(limit);
  const clamped = Number.isFinite(raw) && raw > 0
    ? Math.min(Math.trunc(raw), MAX_PUSH_HISTORY_LIMIT)
    : PUSH_HISTORY_LIMIT;
  const cleanKind = String(kind || '').trim().toLowerCase();
  // Tanınmayan `kind` **süzmür** (backend də belədir): panel yeni bir növ göndərsə,
  // boş cədvəl yerinə tam tarixçə görünür.
  const filterKind = (PUSH_KINDS as readonly string[]).includes(cleanKind) ? cleanKind : '';
  const rows = getDeliveriesLocal(tenantId)
    .filter((row) => !filterKind || row.kind === filterKind)
    .sort((a, b) => new Date(String(b.created_at || '')).getTime() - new Date(String(a.created_at || '')).getTime())
    .slice(0, clamped);
  return { items: rows, count: rows.length, kinds: [...PUSH_KINDS] };
}

export async function get_push_history_live(limit?: number, kind?: string): Promise<PushHistoryResponse> {
  if (!isBackendEnabled()) return get_push_history(limit, kind);
  const params = new URLSearchParams();
  params.set('limit', String(limit || PUSH_HISTORY_LIMIT));
  const cleanKind = String(kind || '').trim().toLowerCase();
  if ((PUSH_KINDS as readonly string[]).includes(cleanKind)) params.set('kind', cleanKind);
  return apiRequest<PushHistoryResponse>(`/api/v1/ops/push/history?${params.toString()}`, { tenantId: null });
}
