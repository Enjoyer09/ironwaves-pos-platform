import { apiRequest, isBackendEnabled } from './client';
import { get_settings } from './settings';

export type FeedbackSubmission = {
  tenant_id: string;
  sale_id?: string;
  receipt_id?: string;
  source?: string;
  score: number;
  comment?: string;
  contact?: string;
  created_at?: string;
};

export type FeedbackCoupon = {
  id: string;
  tenant_id: string;
  code: string;
  percent: number;
  status: 'PENDING' | 'REDEEMED';
  issued_at: string;
  redeemed_at?: string;
  source?: string;
  sale_id?: string;
  receipt_id?: string;
  feedback_created_at?: string;
  redeemed_sale_id?: string;
};

const FEEDBACK_STORAGE_KEY = 'iw_feedback_submissions_v1';
const FEEDBACK_COUPON_STORAGE_KEY = 'iw_feedback_coupons_v1';

type FeedbackStore = Record<string, FeedbackSubmission[]>;
type CouponStore = Record<string, FeedbackCoupon[]>;

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(1, Math.min(5, Math.round(value)));
}

function readStore(): FeedbackStore {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(FEEDBACK_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as FeedbackStore;
  } catch {
    return {};
  }
}

function writeStore(store: FeedbackStore) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // no-op
  }
}

function readCouponStore(): CouponStore {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(FEEDBACK_COUPON_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as CouponStore;
  } catch {
    return {};
  }
}

function writeCouponStore(store: CouponStore) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FEEDBACK_COUPON_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // no-op
  }
}

function randomCodeChunk(size = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < size; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function normalizeFeedbackCouponCode(raw: string) {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function isFeedbackCouponCode(raw: string) {
  return /^FB-[A-Z0-9]{6,12}$/.test(normalizeFeedbackCouponCode(raw));
}

function issueFeedbackCoupon(payload: FeedbackSubmission): FeedbackCoupon {
  const tenantId = String(payload.tenant_id || 'tenant_default');
  const store = readCouponStore();
  const existing = Array.isArray(store[tenantId]) ? store[tenantId] : [];
  const now = new Date().toISOString();
  const code = `FB-${randomCodeChunk(8)}`;
  const configuredPercent = Number(get_settings(tenantId)?.feedback_settings?.coupon_percent || 5);
  const couponPercent = Math.max(1, Math.min(100, Number.isFinite(configuredPercent) ? configuredPercent : 5));
  const coupon: FeedbackCoupon = {
    id: `${tenantId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tenant_id: tenantId,
    code,
    percent: couponPercent,
    status: 'PENDING',
    issued_at: now,
    source: payload.source || 'feedback',
    sale_id: payload.sale_id,
    receipt_id: payload.receipt_id,
    feedback_created_at: payload.created_at || now,
  };
  store[tenantId] = [coupon, ...existing].slice(0, 1000);
  writeCouponStore(store);
  return coupon;
}

export function find_feedback_coupon_live(tenantId: string, code: string): FeedbackCoupon | null {
  const safeTenant = String(tenantId || 'tenant_default');
  const safeCode = normalizeFeedbackCouponCode(code);
  if (!isFeedbackCouponCode(safeCode)) return null;
  const store = readCouponStore();
  const list = Array.isArray(store[safeTenant]) ? store[safeTenant] : [];
  const row = list.find((item) => normalizeFeedbackCouponCode(item.code) === safeCode);
  return row || null;
}

export function redeem_feedback_coupon_live(tenantId: string, code: string, saleId: string): { success: boolean; coupon?: FeedbackCoupon } {
  const safeTenant = String(tenantId || 'tenant_default');
  const safeCode = normalizeFeedbackCouponCode(code);
  const store = readCouponStore();
  const list = Array.isArray(store[safeTenant]) ? store[safeTenant] : [];
  const idx = list.findIndex((item) => normalizeFeedbackCouponCode(item.code) === safeCode);
  if (idx < 0) return { success: false };
  const coupon = list[idx];
  if (coupon.status !== 'PENDING') return { success: false, coupon };
  const updated: FeedbackCoupon = {
    ...coupon,
    status: 'REDEEMED',
    redeemed_at: new Date().toISOString(),
    redeemed_sale_id: String(saleId || '').trim() || undefined,
  };
  const nextList = [...list];
  nextList[idx] = updated;
  store[safeTenant] = nextList;
  writeCouponStore(store);
  return { success: true, coupon: updated };
}

function saveLocally(payload: FeedbackSubmission) {
  const store = readStore();
  const tenantId = String(payload.tenant_id || 'tenant_default');
  const existing = Array.isArray(store[tenantId]) ? store[tenantId] : [];
  store[tenantId] = [
    {
      ...payload,
      score: clampScore(payload.score),
      created_at: payload.created_at || new Date().toISOString(),
    },
    ...existing,
  ].slice(0, 500);
  writeStore(store);
}

export async function submit_feedback_live(payload: FeedbackSubmission) {
  const safePayload: FeedbackSubmission = {
    ...payload,
    tenant_id: String(payload.tenant_id || 'tenant_default'),
    score: clampScore(payload.score),
    comment: String(payload.comment || '').trim(),
    contact: String(payload.contact || '').trim(),
    created_at: payload.created_at || new Date().toISOString(),
  };

  if (!safePayload.score) {
    throw new Error('Feedback score is required');
  }

  if (isBackendEnabled()) {
    try {
      await apiRequest('/api/v1/ops/feedback/submit', {
        method: 'POST',
        auth: false,
        tenantId: null,
        body: safePayload,
      });
    } catch {
      // Endpoint may not exist yet; keep local persistence as fallback.
    }
  }

  saveLocally(safePayload);
  const coupon = issueFeedbackCoupon(safePayload);
  return { success: true, coupon_code: coupon.code, coupon_percent: coupon.percent };
}
