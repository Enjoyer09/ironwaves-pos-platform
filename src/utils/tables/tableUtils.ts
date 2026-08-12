/**
 * Pure utility functions for the Tables module.
 * No React, no side effects, no DOM access — fully unit-testable.
 */

export type WaiterColor = {
  bg: string;
  border: string;
  text: string;
  dot: string;
};

const WAITER_COLORS: WaiterColor[] = [
  { bg: 'bg-rose-500/15', border: 'border-rose-400/40', text: 'text-rose-200', dot: 'bg-rose-400' },
  { bg: 'bg-blue-500/15', border: 'border-blue-400/40', text: 'text-blue-200', dot: 'bg-blue-400' },
  { bg: 'bg-violet-500/15', border: 'border-violet-400/40', text: 'text-violet-200', dot: 'bg-violet-400' },
  { bg: 'bg-amber-500/15', border: 'border-amber-400/40', text: 'text-amber-200', dot: 'bg-amber-400' },
  { bg: 'bg-cyan-500/15', border: 'border-cyan-400/40', text: 'text-cyan-200', dot: 'bg-cyan-400' },
  { bg: 'bg-pink-500/15', border: 'border-pink-400/40', text: 'text-pink-200', dot: 'bg-pink-400' },
  { bg: 'bg-indigo-500/15', border: 'border-indigo-400/40', text: 'text-indigo-200', dot: 'bg-indigo-400' },
  { bg: 'bg-orange-500/15', border: 'border-orange-400/40', text: 'text-orange-200', dot: 'bg-orange-400' },
  { bg: 'bg-teal-500/15', border: 'border-teal-400/40', text: 'text-teal-200', dot: 'bg-teal-400' },
  { bg: 'bg-fuchsia-500/15', border: 'border-fuchsia-400/40', text: 'text-fuchsia-200', dot: 'bg-fuchsia-400' },
];

/**
 * Returns a deterministic color set for a waiter name (hash-based).
 */
export function getWaiterColor(waiter: string): WaiterColor | null {
  if (!waiter) return null;
  let hash = 0;
  for (let i = 0; i < waiter.length; i++) {
    hash = waiter.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % WAITER_COLORS.length;
  return WAITER_COLORS[index];
}

export type KitchenBadge = {
  label: string;
  className: string;
};

/**
 * Returns a badge label + CSS class for a kitchen round status.
 * Pass translated strings via the labels parameter.
 */
export function kitchenBadge(
  status: string | null | undefined,
  labels: { sent: string; preparing: string; ready: string },
): KitchenBadge | null {
  switch (String(status || '').toUpperCase()) {
    case 'NEW':
    case 'SENT':
      return { label: labels.sent, className: 'bg-blue-400/20 text-blue-200 border border-blue-300/40' };
    case 'PREPARING':
      return { label: labels.preparing, className: 'bg-orange-400/20 text-orange-200 border border-orange-300/40' };
    case 'READY':
      return { label: labels.ready, className: 'bg-emerald-400/20 text-emerald-200 border border-emerald-300/40' };
    default:
      return null;
  }
}

/**
 * Normalizes backend order item status to a canonical set.
 */
export function normalizeOrderItemStatus(status: string | null | undefined): string {
  const raw = String(status || 'DRAFT').toUpperCase();
  if (raw === 'NEW') return 'SENT';
  if (raw === 'IN_PREP') return 'PREPARING';
  return raw;
}

/**
 * Canonical kitchen/order-item status palette — single source of truth
 * (UI_COMPETITIVE_AUDIT §6.3). One hue per status, shared by KDS, TablesPage
 * and SentItemsSlideUp: NEW/SENT=blue · PREPARING/REMAKE/CORRECTION=orange ·
 * READY=emerald · VOID_REQUESTED=yellow · VOIDED=rose · COMPED=sky · WASTE=slate ·
 * SERVED=violet. All class strings are full literals so Tailwind generates them.
 */
export type OrderItemStatusTheme = {
  card: string; // KDS order-card border/bg (getStatusColor)
  badge: string; // KDS status label chip (getStatusBadge)
  dot: string; // small status dot (TablesPage / SentItemsSlideUp)
  row: string; // KDS item-row border/bg (kitchenItemTone)
  qty: string; // KDS item qty badge (kitchenItemTone)
  label: { az: string; ru: string; en: string }; // short badge label
};

const ORDER_STATUS_NEUTRAL_ROW = 'border-slate-700/50 bg-slate-950/25 text-slate-100';
const ORDER_STATUS_NEUTRAL_QTY = 'bg-slate-700 text-slate-100';

export const ORDER_STATUS_THEME: Record<string, OrderItemStatusTheme> = {
  SENT: {
    card: 'border-blue-300/60 bg-blue-900/20',
    badge: 'bg-blue-400/20 text-blue-200 border border-blue-300/40',
    dot: 'bg-blue-400',
    row: ORDER_STATUS_NEUTRAL_ROW,
    qty: ORDER_STATUS_NEUTRAL_QTY,
    label: { az: 'GÖNDƏRİLDİ', ru: 'ОТПРАВЛЕНО', en: 'SENT' },
  },
  NEW: {
    card: 'border-blue-300/60 bg-blue-900/20',
    badge: 'bg-blue-400/20 text-blue-200 border border-blue-300/40',
    dot: 'bg-blue-400',
    row: ORDER_STATUS_NEUTRAL_ROW,
    qty: ORDER_STATUS_NEUTRAL_QTY,
    label: { az: 'YENİ', ru: 'НОВЫЙ', en: 'NEW' },
  },
  PREPARING: {
    card: 'border-orange-300/60 bg-orange-900/20',
    badge: 'bg-orange-400/20 text-orange-200 border border-orange-300/40',
    dot: 'bg-orange-400',
    row: ORDER_STATUS_NEUTRAL_ROW,
    qty: ORDER_STATUS_NEUTRAL_QTY,
    label: { az: 'HAZIRLANIR', ru: 'ГОТОВИТСЯ', en: 'PREPARING' },
  },
  READY: {
    card: 'border-emerald-300/70 bg-emerald-900/20',
    badge: 'bg-emerald-400/20 text-emerald-200 border border-emerald-300/40',
    dot: 'bg-emerald-400',
    row: ORDER_STATUS_NEUTRAL_ROW,
    qty: ORDER_STATUS_NEUTRAL_QTY,
    label: { az: 'HAZIRDIR', ru: 'ГОТОВО', en: 'READY' },
  },
  VOID_REQUESTED: {
    card: 'border-yellow-300/90 bg-yellow-900/30',
    badge: 'bg-yellow-400/25 text-yellow-100 border border-yellow-300/60',
    dot: 'bg-yellow-400',
    row: 'border-yellow-300/70 bg-yellow-500/15 text-yellow-50',
    qty: 'bg-yellow-500/30 text-yellow-50',
    label: { az: 'LƏĞV TƏLƏBİ', ru: 'ЗАПРОС ОТМЕНЫ', en: 'CANCEL REQUEST' },
  },
  VOIDED: {
    card: 'border-rose-300/70 bg-rose-900/20',
    badge: 'bg-rose-400/20 text-rose-200 border border-rose-300/40',
    dot: 'bg-rose-400',
    row: 'border-rose-300/60 bg-rose-500/15 text-rose-50',
    qty: 'bg-rose-500/25 text-rose-50',
    label: { az: 'LƏĞV EDİLDİ', ru: 'ОТМЕНЕНО', en: 'VOIDED' },
  },
  COMPED: {
    card: 'border-sky-300/70 bg-sky-900/20',
    badge: 'bg-sky-400/20 text-sky-200 border border-sky-300/40',
    dot: 'bg-sky-400',
    row: 'border-sky-300/50 bg-sky-500/15 text-sky-50',
    qty: 'bg-sky-500/25 text-sky-50',
    label: { az: 'HESABDAN SİLİNİB', ru: 'СПИСАНО СО СЧЕТА', en: 'Comped' },
  },
  WASTE: {
    card: 'border-slate-300/40 bg-slate-800/40',
    badge: 'bg-slate-400/20 text-slate-200 border border-slate-300/40',
    dot: 'bg-slate-400',
    row: 'border-slate-400/50 bg-slate-700/35 text-slate-100',
    qty: 'bg-slate-600/60 text-slate-100',
    label: { az: 'İSRAF', ru: 'СПИСАНО', en: 'Waste' },
  },
  REMAKE: {
    card: 'border-orange-300/80 bg-orange-900/25',
    badge: 'bg-orange-400/20 text-orange-200 border border-orange-300/40',
    dot: 'bg-orange-400',
    row: 'border-orange-300/70 bg-orange-500/15 text-orange-50',
    qty: 'bg-orange-500/30 text-orange-50',
    label: { az: 'YENİDƏN DÜZƏLT', ru: 'ПЕРЕДЕЛАТЬ', en: 'Remake' },
  },
  CORRECTION: {
    card: 'border-orange-300/80 bg-orange-900/25',
    badge: 'bg-orange-400/20 text-orange-200 border border-orange-300/40',
    dot: 'bg-orange-400',
    row: 'border-orange-300/70 bg-orange-500/15 text-orange-50',
    qty: 'bg-orange-500/30 text-orange-50',
    label: { az: 'YENİ DÜZƏLİŞ', ru: 'НОВОЕ ИСПРАВЛЕНИЕ', en: 'NEW CORRECTION' },
  },
  SERVED: {
    card: 'border-slate-600 bg-slate-800/30',
    badge: '',
    dot: 'bg-violet-400',
    row: ORDER_STATUS_NEUTRAL_ROW,
    qty: ORDER_STATUS_NEUTRAL_QTY,
    label: { az: 'Servis', ru: 'Подано', en: 'Served' },
  },
};

export const ORDER_STATUS_THEME_DEFAULT: OrderItemStatusTheme = {
  card: 'border-slate-600 bg-slate-800/30',
  badge: '',
  dot: 'bg-slate-400',
  row: ORDER_STATUS_NEUTRAL_ROW,
  qty: ORDER_STATUS_NEUTRAL_QTY,
  label: { az: '', ru: '', en: '' },
};

/**
 * Returns available actions for a sent order item based on its status.
 */
export function sentItemActions(item: { status?: string | null }): string[] {
  const status = normalizeOrderItemStatus(item?.status);
  if (['SENT', 'PREPARING'].includes(status)) return ['DECREASE', 'VOID', 'COMP', 'WASTE', 'REMAKE'];
  if (status === 'READY') return ['VOID', 'COMP', 'WASTE', 'REMAKE'];
  if (status === 'SERVED') return ['COMP', 'WASTE'];
  if (status === 'VOID_REQUESTED') return ['VOID'];
  return [];
}

/**
 * Determines if a given action on a given status requires manager password.
 */
export function itemActionNeedsManager(action: string | null | undefined, status: string | null | undefined): boolean {
  const normalizedAction = String(action || '').toUpperCase();
  const normalizedStatus = normalizeOrderItemStatus(status);
  if (normalizedStatus === 'DRAFT' || normalizedStatus === 'SENT' || normalizedStatus === 'NEW') return false;
  if (normalizedAction === 'DECREASE' && normalizedStatus === 'PREPARING') return false;
  return true;
}

/**
 * Formats a UUID for display (first segment, uppercased).
 */
export function formatDisplayId(id: string): string {
  return id ? id.split('-')[0].toUpperCase() : '-';
}

/**
 * Returns a localized label for an item action code.
 */
export function itemActionLabel(
  action: string | null | undefined,
  labels: { decrease: string; void_: string; comp: string; waste: string; remake: string },
): string {
  switch (String(action || '').toUpperCase()) {
    case 'DECREASE': return labels.decrease;
    case 'VOID': return labels.void_;
    case 'COMP': return labels.comp;
    case 'WASTE': return labels.waste;
    case 'REMAKE': return labels.remake;
    default: return String(action || '-');
  }
}
