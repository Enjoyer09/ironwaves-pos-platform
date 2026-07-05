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
