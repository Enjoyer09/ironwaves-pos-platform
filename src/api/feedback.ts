import { apiRequest, isBackendEnabled } from './client';

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

const FEEDBACK_STORAGE_KEY = 'iw_feedback_submissions_v1';

type FeedbackStore = Record<string, FeedbackSubmission[]>;

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
  return { success: true };
}
