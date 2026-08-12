/**
 * Pure utility functions for floor plan calculations.
 * No React, no side effects — fully unit-testable.
 */

export interface FloorTableMin {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  capacity: number;
  status: string;
  assigned_table_id?: string | null;
}

export interface MergedGroup {
  id: string;
  tables: FloorTableMin[];
}

export interface GroupOutline {
  id: string;
  label: string;
  left: string;
  width: string;
  top: string;
  height: string;
}

export interface FloorSummary {
  AVAILABLE: number;
  RESERVED: number;
  SEATED: number;
  ACTIVE_CHECK: number;
  DIRTY: number;
}

/**
 * Canonical table-status palette — single source of truth (UI_COMPETITIVE_AUDIT §6.3).
 * One hue per status, shared by FloorView (legend chips + map cells) and TableGrid (list cards):
 *   AVAILABLE = emerald · RESERVED = amber · SEATED = rose · ACTIVE_CHECK = violet · DIRTY = slate
 * All class strings are full literals so Tailwind's scanner generates them.
 */
export const TABLE_STATUS_THEME: Record<
  string,
  {
    chip: string; // FloorView manager legend chip
    cell: string; // FloorView floor-map table cell
    listBorder: string; // TableGrid card border
    listGlow: string; // TableGrid card glow shadow
    dot: string; // status dot (TableGrid card)
    text: string; // status label text color (TableGrid card)
    gradient: string; // TableGrid inline card background rgba
  }
> = {
  AVAILABLE: {
    chip: 'border-emerald-300/40 bg-emerald-500/10 text-emerald-100',
    cell: 'bg-emerald-500/15 border-emerald-300/40 text-emerald-100 hover:bg-emerald-500/25',
    listBorder: 'border-emerald-400/25',
    listGlow: '',
    dot: 'bg-emerald-400',
    text: '#6ee7b7',
    gradient: 'rgba(16,185,129,0.06)',
  },
  RESERVED: {
    chip: 'border-amber-300/40 bg-amber-500/10 text-amber-100',
    cell: 'bg-amber-500/15 border-amber-300/40 text-amber-100 hover:bg-amber-500/25',
    listBorder: 'border-amber-400/30',
    listGlow: 'shadow-[0_0_20px_rgba(245,158,11,0.08)]',
    dot: 'bg-amber-400',
    text: '#fcd34d',
    gradient: 'rgba(245,158,11,0.07)',
  },
  SEATED: {
    chip: 'border-rose-300/40 bg-rose-500/10 text-rose-100',
    cell: 'bg-rose-500/15 border-rose-300/40 text-rose-100 hover:bg-rose-500/25',
    listBorder: 'border-rose-400/25',
    listGlow: '',
    dot: 'bg-rose-400',
    text: '#fda4af',
    gradient: 'rgba(244,63,94,0.07)',
  },
  ACTIVE_CHECK: {
    chip: 'border-violet-300/40 bg-violet-500/10 text-violet-100',
    cell: 'bg-violet-500/15 border-violet-300/40 text-violet-100 hover:bg-violet-500/25',
    listBorder: 'border-violet-400/30',
    listGlow: 'shadow-[0_0_24px_rgba(139,92,246,0.1)]',
    dot: 'bg-violet-400',
    text: '#c4b5fd',
    gradient: 'rgba(139,92,246,0.08)',
  },
  DIRTY: {
    chip: 'border-slate-300/30 bg-slate-500/20 text-slate-100',
    cell: 'bg-slate-500/20 border-slate-300/30 text-slate-100 hover:bg-slate-500/30',
    listBorder: 'border-slate-400/20',
    listGlow: '',
    dot: 'bg-slate-400',
    text: '#94a3b8',
    gradient: 'rgba(100,116,139,0.06)',
  },
};

/** i18n labels for table statuses (az / ru / en) — pass through tx(lang, l.az, l.ru, l.en). */
export const TABLE_STATUS_LABELS: Record<string, { az: string; ru: string; en: string }> = {
  AVAILABLE: { az: 'Boş', ru: 'Свободен', en: 'Free' },
  RESERVED: { az: 'Rezerv', ru: 'Забронирован', en: 'Reserved' },
  SEATED: { az: 'Dolu', ru: 'Занят', en: 'Seated' },
  ACTIVE_CHECK: { az: 'Aktiv', ru: 'Активен', en: 'Active' },
  DIRTY: { az: 'Təmizlik', ru: 'Уборка', en: 'Dirty' },
};

export interface ReservationTimelineEntry {
  reservation: any;
  lane: number;
  startMinutes: number;
  duration: number;
  top: number;
  height: number;
}

export interface ReservationTimeline {
  hourStart: number;
  hourEnd: number;
  minuteHeight: number;
  lanes: Array<{ id: string; label: string }>;
  laneWidth: number;
  entries: ReservationTimelineEntry[];
  totalHeight: number;
  totalWidth: number;
}

/**
 * Computes floor summary statistics from floor tables.
 */
export function computeFloorSummary(floorTables: FloorTableMin[]): FloorSummary {
  const counts: FloorSummary = { AVAILABLE: 0, RESERVED: 0, SEATED: 0, ACTIVE_CHECK: 0, DIRTY: 0 };
  floorTables.forEach((row) => {
    const status = String(row.status || 'AVAILABLE').toUpperCase() as keyof FloorSummary;
    if (status in counts) counts[status] += 1;
  });
  return counts;
}

/**
 * Suggests best-fit tables for a reservation based on party size.
 */
export function suggestReservationTables(
  candidates: FloorTableMin[],
  partySize: number,
  limit = 3,
): FloorTableMin[] {
  const size = Math.max(1, partySize);
  return [...candidates]
    .filter((row) => Number(row.capacity || 0) >= size)
    .sort((a, b) => {
      const gapA = Math.abs(Number(a.capacity || 0) - size);
      const gapB = Math.abs(Number(b.capacity || 0) - size);
      if (gapA !== gapB) return gapA - gapB;
      return String(a.label || '').localeCompare(String(b.label || ''));
    })
    .slice(0, limit);
}

/**
 * Groups floor tables by merged_group_id.
 */
export function computeMergedGroups(floorTables: any[]): MergedGroup[] {
  const groups = new Map<string, any[]>();
  floorTables.forEach((table) => {
    const mergedGroupId = String((table as any).merged_group_id || '').trim();
    if (!mergedGroupId) return;
    groups.set(mergedGroupId, [...(groups.get(mergedGroupId) || []), table]);
  });
  return Array.from(groups.entries()).map(([id, tablesInGroup]) => ({ id, tables: tablesInGroup }));
}

/**
 * Computes visual outlines for merged table groups.
 */
export function computeMergedGroupOutlines(
  mergedGroups: MergedGroup[],
  maxCols: number,
): GroupOutline[] {
  const cols = Math.max(6, maxCols);
  return mergedGroups.map((group) => {
    const minX = Math.min(...group.tables.map((t) => Number(t.x || 0)));
    const minY = Math.min(...group.tables.map((t) => Number(t.y || 0)));
    const maxX = Math.max(...group.tables.map((t) => Number(t.x || 0) + Number(t.w || 1)));
    const maxY = Math.max(...group.tables.map((t) => Number(t.y || 0) + Number(t.h || 1)));
    return {
      id: group.id,
      label: group.tables.map((t) => t.label).join(' + '),
      left: `${(minX / cols) * 100}%`,
      width: `${((maxX - minX) / cols) * 100}%`,
      top: `${minY * 70}px`,
      height: `${(maxY - minY) * 70}px`,
    };
  });
}

/**
 * Computes reservation timeline layout for the timeline view.
 */
export function computeReservationTimeline(params: {
  reservations: any[];
  floorTables: Array<{ id: string; label: string }>;
  reservationDurationDrafts: Record<string, number>;
  reservationZoom: 15 | 30;
  unassignedLabel: string;
  parseTimestamp: (ts: string) => Date | null;
}): ReservationTimeline {
  const { reservations, floorTables, reservationDurationDrafts, reservationZoom, unassignedLabel, parseTimestamp } = params;
  const hourStart = 8;
  const hourEnd = 24;
  const minuteHeight = reservationZoom === 15 ? 1.25 : 0.8;
  const laneDefinitions = [
    { id: '', label: unassignedLabel },
    ...[...floorTables]
      .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')))
      .map((table) => ({ id: table.id, label: table.label })),
  ];
  const laneWidth = 220;
  const entries: ReservationTimelineEntry[] = [...reservations]
    .sort((a, b) => a.reservation_at.localeCompare(b.reservation_at))
    .map((reservation) => {
      const startAt = parseTimestamp(reservation.reservation_at) || new Date(reservation.reservation_at);
      const startMinutes = startAt.getHours() * 60 + startAt.getMinutes();
      const duration = Math.max(30, Number(reservationDurationDrafts[reservation.id] ?? (reservation.duration_minutes || 90)));
      const lane = Math.max(0, laneDefinitions.findIndex((laneRow) => laneRow.id === String(reservation.assigned_table_id || '')));
      return {
        reservation,
        lane,
        startMinutes,
        duration,
        top: Math.max(0, startMinutes - hourStart * 60) * minuteHeight,
        height: Math.max(62, duration * minuteHeight),
      };
    });
  return {
    hourStart,
    hourEnd,
    minuteHeight,
    lanes: laneDefinitions,
    laneWidth,
    entries,
    totalHeight: (hourEnd - hourStart) * 60 * minuteHeight,
    totalWidth: laneDefinitions.length * laneWidth,
  };
}
